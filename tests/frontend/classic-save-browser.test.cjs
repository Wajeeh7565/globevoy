const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { frontendSourcePath } = require('../../ops/frontend/source-layout.cjs');
const { chromium } = require('../../web/node_modules/playwright');
const { generatedTours } = require('./generated-tour-fixtures.cjs');
const saved = require('../../backend/services/accounts/saved-trips/staging-saved-trips-705c');
const origin = 'https://globevoy.com';
const artifactRoot=process.env.GLOBEVOY_TEST_FRONTEND_ROOT ? path.resolve(process.env.GLOBEVOY_TEST_FRONTEND_ROOT) : null;
const sessionKey = 'globevoy.auth.session.705b-r3';
const mockRelease = { environment: 'production', target: 'globevoy.com', apiBaseUrl: 'https://offline-test.lambda-url.us-east-2.on.aws', reactEnabled: true, accountsEnabled: true,
  auth: { region: 'us-east-2', userPoolId: 'us-east-2_OfflineTest1', clientId: 'offlineclient1234567890', issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_OfflineTest1', domainBaseUrl: 'https://globevoy-offline-test.auth.us-east-2.amazoncognito.com' } };
const release=artifactRoot ? JSON.parse(fs.readFileSync(path.join(artifactRoot,'runtime/environment-policy.js'),'utf8').match(/Object\.freeze\((\{[^\n]+\})\);/)[1]) : mockRelease;
const api=release.apiBaseUrl;
let browser, tours;
test.before(async()=> {
  assert.ok(fs.existsSync(artifactRoot ? path.join(artifactRoot,'react/my-trips/index.html') : 'web/out/my-trips/index.html'), 'Run npm run build:web before browser tests');
  tours = await generatedTours();
  browser = await chromium.launch({ headless:true, ...(process.env.GLOBEVOY_TEST_BROWSER_PATH ? {executablePath:process.env.GLOBEVOY_TEST_BROWSER_PATH} : {}) });
});
test.after(async()=>{ await browser?.close(); });

async function site(tour, signedIn=true) {
  const context = await browser.newContext({serviceWorkers:'block'});
  const rows = new Map(), postBodies = [], statuses = [], missing = [];
  let failure = '', gate;
  const options = { env:{GLOBEVOY_SAVED_TRIPS_TABLE:'offline-test-table'}, commandFactory:(name,input)=>({name,input}), ddb:{send:async ({name,input})=>{
    if(name==='PutItem'){rows.set(input.Item.SK.S,input.Item);return {}}
    if(name==='DeleteItem'){const item=rows.get(input.Key.SK.S);rows.delete(input.Key.SK.S);return {Attributes:item}}
    throw Error('Unexpected offline DB command');
  }}};
  await context.addInitScript(({release,sessionKey,signedIn})=>{
    window.GLOBEVOY_PRODUCTION_RELEASE=release;
    if(signedIn&&!sessionStorage.getItem(sessionKey))sessionStorage.setItem(sessionKey,JSON.stringify({version:'GV-ACCOUNT-705B-R3',accessToken:'offline-browser-test-token',expiresAt:Date.now()+3600000,verifiedAt:Date.now(),user:{sub:'synthetic-offline-owner'}}));
  },{release,sessionKey,signedIn});
  await context.route('**/*',async route=>{
    const request=route.request(),u=new URL(request.url()),method=request.method();
    if(u.origin===api){
      const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};
      let status=200,data;
      try{
        if(method==='OPTIONS')return route.fulfill({status:204,headers});
        if(u.pathname==='/api/generated-tour')data={ok:true,supported:true,tour,tours:[tour]};
        else if(u.pathname==='/api/account/session')data={ok:true,authenticated:true,user:{sub:'synthetic-offline-owner'}};
        else if(u.pathname==='/api/saved-trips'){
          assert.equal(request.headers().authorization,'Bearer offline-browser-test-token');
          if(method==='GET')data={trips:[...rows.values()].map(saved._internal.toPublicItem)};
          else if(method==='POST'){
            postBodies.push(request.postData());
            if(gate)await gate;
            if(failure==='network')return route.abort('failed');
            if(failure==='413'){status=413;data={ok:false,error:'request-body-too-large'}}
            else if(failure==='malformed'){status=201;data={ok:true}}
            else {status=201;const body=saved._internal.parseBody({body:request.postData()});data={ok:true,trip:await saved._internal.createTrip('synthetic-offline-owner',body,options)}}
          }else if(method==='DELETE'){await saved._internal.deleteTrip('synthetic-offline-owner',u.searchParams.get('tripId'),options);data={ok:true}}
          else throw Error('Unexpected private method');
        }else {status=404;data={ok:false,error:'offline-route-not-found'}}
      }catch(e){status=e.statusCode||500;data={ok:false,error:e.code||'offline-test-error'}}
      statuses.push({method,path:u.pathname,status});
      return route.fulfill({status,headers,body:JSON.stringify(data)});
    }
    if(u.origin===origin){
      const isReact=u.pathname.startsWith('/react/');
      const root=artifactRoot ? (isReact?path.join(artifactRoot,'react'):artifactRoot) : path.resolve(isReact?'web/out':'frontend');
      let file=path.resolve(root,'.'+(isReact?u.pathname.slice(6):u.pathname));
      if(u.pathname.endsWith('/'))file=path.join(file,'index.html');
      if(!artifactRoot&&!isReact)file=frontendSourcePath(root,path.relative(root,file));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){missing.push(u.pathname);return route.fulfill({status:404,body:'Missing offline asset'})}
      const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain'};
      return route.fulfill({status:200,contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
    }
    // Zero live network access, including maps, images, Cognito and AWS.
    return route.abort();
  });
  const page=await context.newPage();
  async function visualizer(){const query=new URLSearchParams({generated:'true',origin:tour.origin.airportCode||tour.origin.code,budget:String(tour.budget.total.amount),currency:tour.budget.total.currency,month:tour.itineraryDatePlan.scanStartMonth,passengers:String(tour.passengerPricing?.travellers||1)});await page.goto(origin+'/multicity-visualizer.html?'+query);await page.locator('#mcv-app:visible').waitFor();await page.waitForFunction(()=>Boolean(window.GlobevoySavedTrips705C));}
  return {context,page,rows,postBodies,statuses,missing,visualizer,fail:v=>{failure=v},hold:p=>{gate=p}};
}

test('classic hotel CTA uses validated current context instead of the stale provider URL',async()=>{
  const {enrichStay}=require('../../backend/services/providers/links/partner-links');
  for(const property of [true,false]) {
    const tour=structuredClone(tours[0]),stop={...tour.stays[0],arrivalDate:tour.stays[0].hotel.booking.checkIn,departureDate:tour.stays[0].hotel.booking.checkOut};
    const oldUrl=property?'https://www.agoda.com/example/hotel/selected-city.html?hid=42&checkin=2020-01-01&NumberofChildren=2'
      :'https://www.agoda.com/partners/partnersearch.aspx?hid=42&checkin=2020-01-01&NumberofChildren=2';
    const enriched=enrichStay({...stop,hotel:{...stop.hotel,provider:'agoda',agodaHotelId:42,
      providerHotel:{provider:'Agoda',hotelId:42,bookingUrl:oldUrl}}},{adults:1,children:0,rooms:1,currency:'CAD'});
    tour.stays[0]=enriched;
    const s=await site(tour,false);
    try{
      await s.visualizer();
      await s.page.locator('#mcv-save-trip').waitFor();
      const label=property?'Check this property on Agoda':'View selected property in Agoda results';
      const button=s.page.locator('.mcv-mini-action').filter({hasText:label}).first();
      assert.equal(await button.count(),1);
      const url=new URL(await button.getAttribute('data-url'));
      assert.equal(url.searchParams.get('hid'),'42');
      assert.equal(url.searchParams.get('checkin'),enriched.arrivalDate);
      assert.equal(url.searchParams.get('NumberofChildren'),'0');
      assert.notEqual(url.href,oldUrl);
    }finally{await s.context.close()}
  }
});

for(const routeDetails of [false,true])test((routeDetails?'Route-details':'Classic visualizer')+' Save -> real React My Trips -> Delete, without network access',async()=>{
  const s=await site(tours[routeDetails?1:0]);
  try{
    await s.visualizer();
    if(routeDetails){await s.page.locator('#mcv-flight-options').click();await s.page.waitForURL('**/multi-city-trip.html?**');await s.page.locator('#gv-mtd-save').waitFor();await s.page.waitForFunction(()=>Boolean(window.GlobevoySavedTripsRouteDetails705CR3));}
    const button=s.page.locator(routeDetails?'#gv-mtd-save':'#mcv-save-trip');
    let releasePost;s.hold(new Promise(r=>{releasePost=r}));
    await button.click();await s.page.waitForFunction(()=>document.querySelector('[aria-busy="true"]'));
    assert.doesNotMatch(await button.innerText(),/Saved to account/);assert.equal(s.rows.size,0);
    releasePost();await button.filter({hasText:'Saved to account'}).waitFor();
    assert.equal(s.postBodies.length,1);assert.equal(s.rows.size,1);
    console.log('Browser Save payload bytes:',Buffer.byteLength(s.postBodies[0]));
    const body=JSON.parse(s.postBodies[0]);assert.ok(Buffer.byteLength(s.postBodies[0])<64*1024);assert.ok(Buffer.byteLength(JSON.stringify(body.tripSnapshot))<48*1024);
    assert.equal(body.tripSnapshot.tour.itineraryDatePlan.canonicalReturnDate,tours[routeDetails?1:0].itineraryDatePlan.canonicalReturnDate);
    const guest=await s.page.evaluate(()=>JSON.parse(sessionStorage.getItem('globevoy.multi.selected.v1')));
    assert.ok(guest.cheapFlightScanner.candidateEvidence.length);assert.ok(guest.entryEligibility.profile.passportCountryCode);
    await s.page.goto(origin+'/react/my-trips/');const card=s.page.locator('.gv-saved-visual-card');await card.waitFor();
    assert.match(await card.innerText(),/snapshot|price check|revalidation/i);
    await card.locator('summary').click();await card.getByRole('button',{name:'Delete saved trip'}).click();await card.waitFor({state:'detached'});
    assert.equal(s.rows.size,0);assert.ok(s.statuses.some(r=>r.method==='POST'&&r.status===201));assert.ok(s.statuses.some(r=>r.method==='DELETE'&&r.status===200));assert.deepEqual(s.missing,[]);
  }finally{await s.context.close()}
});

for(const failure of ['network','413','malformed'])test('Classic Save handles '+failure+' without claiming account success',async()=>{
  const s=await site(tours[0]);try{await s.visualizer();s.fail(failure);const button=s.page.locator('#mcv-save-trip');await button.click();
    await s.page.waitForFunction(()=>{const b=document.getElementById('mcv-save-trip');return b.getAttribute('aria-busy')==='false'&&b.textContent==='Save'});
    assert.doesNotMatch(await button.innerText(),/Saved/);assert.equal(s.rows.size,0);
    assert.equal(await button.getAttribute('aria-pressed'),'false');assert.equal(await button.evaluate(b=>b.classList.contains('is-saved')),false);
    assert.ok(await s.page.evaluate(()=>Boolean(JSON.parse(sessionStorage.getItem('globevoy.multi.selected.v1')).cheapFlightScanner.candidateEvidence)));
  }finally{await s.context.close()}
});

test('Guest Save keeps the full tour locally and never calls the account API',async()=>{
  const s=await site(tours[0],false);try{await s.visualizer();await s.page.locator('#mcv-save-trip').click();await s.page.locator('#mcv-save-trip').filter({hasText:'Saved'}).waitFor();
    assert.equal(s.postBodies.length,0);assert.equal(s.rows.size,0);
    const full=await s.page.evaluate(()=>JSON.parse(sessionStorage.getItem('globevoy.multi.selected.v1')));assert.ok(full.cheapFlightScanner.candidateEvidence.length);assert.ok(full.entryEligibility.profile.passportCountryCode);
    assert.ok(!s.statuses.some(r=>r.path==='/api/saved-trips'));
  }finally{await s.context.close()}
});

test('public page organization preserves content, assets and packaged legacy URLs',async()=>{
 const s=await site(tours[0],false);
 try{
  for(const name of ['about.html','affiliate.html','privacy.html','terms.html','stays.html','ask.html']){
   await s.page.goto(origin+'/'+name);await s.page.getByRole('heading',{level:1}).first().waitFor();
   assert.ok((await s.page.getByRole('heading',{level:1}).first().textContent()).trim().length>0);
   assert.equal(await s.page.locator('body').getAttribute('data-depth'),'0');
  }
  if(artifactRoot){
   for(const [old,target]of [['about.html','/about.html'],['privacy.html','/privacy.html'],['advanced-search.html','/ask.html'],['account-settings.html','/react/account/']]){
    const suffix='?returnTo=%2Freact%2Fmy-trips%2F&tag=a&tag=b#saved';
    await s.page.goto(origin+'/pages/'+old+suffix);await s.page.waitForURL(origin+target+suffix);
    assert.equal(new URL(s.page.url()).search,'?returnTo=%2Freact%2Fmy-trips%2F&tag=a&tag=b');assert.equal(new URL(s.page.url()).hash,'#saved');
   }
  }
  assert.deepEqual(s.missing,[]);
 }finally{await s.context.close()}
});
