const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const net = require('node:net');
let base, child;
const site = path.resolve(process.env.GLOBEVOY_SITE_ROOT || '.cache/fargate-demo-site');
before(async()=>{
  assert.ok(fs.existsSync(path.join(site,'react/account/index.html')), 'Build and compose the demo frontend first');
  if(process.env.GLOBEVOY_DEMO_TEST_URL) {
    base=process.env.GLOBEVOY_DEMO_TEST_URL;
    const u=new URL(base); assert.equal(u.protocol,'http:'); assert.ok(['127.0.0.1','localhost'].includes(u.hostname));
  } else {
    const reserve=net.createServer().listen(0,'127.0.0.1'); await once(reserve,'listening');
    const port=reserve.address().port; await new Promise(r=>reserve.close(r));
    base='http://127.0.0.1:'+port;
    const env={PORT:String(port),GLOBEVOY_SITE_ROOT:site,GLOBEVOY_DEMO_ORIGIN:base,GLOBEVOY_USE_MOCKS:'true',ENABLE_MULTICITY_ROUTE_610B:'true',ENABLE_GENERATED_TOUR_651A:'true'};
    for(const k of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP']) if(process.env[k])env[k]=process.env[k];
    child=spawn(process.execPath,['ops/docker/serve-demo.cjs'],{env,stdio:['ignore','ignore','inherit']});
  }
  for(let i=0;i<100;i++) {try {if((await fetch(base+'/health')).ok)return;}catch{} await new Promise(r=>setTimeout(r,100));}
  throw Error('Demo server did not start');
});
after(()=>child?.kill());
test('real homepage, classic pages, React export and assets load',async()=>{
  for(const route of ['/', '/about.html','/multi-city.html','/auth-callback.html','/react/account/','/react/my-trips/','/react/travel-profile/']) {
    const r=await fetch(base+route); assert.equal(r.status,200,route); assert.match(r.headers.get('content-type'),/text\/html/);
    const html=await r.text(); assert.match(html,/<html/i); assert.match(html,/demo-config.js/); assert.match(html,/Isolated demo/);
    const assets=[...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))[^"]*"/g)].map(m=>m[1]).filter(a=>!a.startsWith('http'));
    for(const asset of assets) {const response=await fetch(new URL(asset,base+route)); assert.equal(response.status,200,asset); assert.doesNotMatch(response.headers.get('content-type'),/text\/html/);}
  }
});
test('health and city registry JSON; existing travel routes retain validation',async()=>{
  for(const route of ['/health','/api/city-registry?q=Toronto&limit=3','/api/recommendations','/api/generated-tour','/api/multicity-tours']) {
    const r=await fetch(base+route); assert.ok([200,400].includes(r.status),route); assert.match(r.headers.get('content-type'),/application\/json/); assert.ok(await r.json());
  }
});
test('representative multi-city route works and generated-tour date guard remains enforced',async()=>{
  const query='?origin=YYZ&currency=CAD&budget=2500&month=2027-03&passengers=1&nights=7';
  for(const route of ['/api/multicity-tours','/api/generated-tour']) {
    const r=await fetch(base+route+query);assert.equal(r.status,200);
    const data=await r.json();if(route==='/api/multicity-tours') { assert.equal(data.supported,true); assert.ok(data.tours?.length); }
    else { assert.equal(data.supported,true,data.reason); assert.ok(data.tour); assert.equal(data.tour.itineraryDatePlan.consistent,true); }
  }
});
test('API misses, unavailable accounts/admin and methods never become HTML',async()=>{
  for(const route of ['/api','/api/unknown','/api/account/session','/api/saved-trips','/api/provider-live-coverage','/api/index.html']) {
    const r=await fetch(base+route); assert.equal(r.status,404); assert.match(r.headers.get('content-type'),/application\/json/);
  }
  assert.equal((await fetch(base+'/api/city-registry',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/health',{headers:{Origin:'https://unapproved.invalid'}})).status,403);
});
test('unknown frontend, private files and traversal fail closed; HEAD works',async()=>{
  for(const route of ['/missing-page','/backend/server.js','/.env','/runtime/%2e%2e%5cserver.js','/runtime/%00'])assert.equal((await fetch(base+route)).status,404,route);
  const r=await fetch(base+'/',{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');
});
test('demo policy has exact-origin same-origin API, no authentication or live destinations',async()=>{
  const context={window:{GLOBEVOY_DEMO_ORIGIN:base}};
  vm.runInNewContext(await (await fetch(base+'/runtime/environment-policy.js')).text(),context);
  const policy=context.window.GLOBEVOY_ENVIRONMENT_POLICY;
  assert.equal(policy.resolve(base).apiBaseUrl,base);assert.equal(policy.resolve(base).accountsEnabled,false);
  for(const origin of ['https://globevoy.com','https://unknown.invalid','http://127.0.0.1:1'])assert.equal(policy.resolve(origin).apiBaseUrl,'');
  for(const file of walk(site)) {
    if(!/\.(js|html|json)$/.test(file))continue;
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/https:\/\/[^\s"'<>]+(?:lambda-url\.us-east-2\.on\.aws|auth\.us-east-2\.amazoncognito\.com|amplifyapp\.com)/,file);
  }
});
function* walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())yield* walk(f);else yield f;}}
