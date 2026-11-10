const {chromium}=require(require('path').resolve('.cache/browser-tools/node_modules/playwright'));
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const root=path.resolve(process.env.GLOBEVOY_SITE_ARTIFACT || '.cache/launch-site-browser');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext();const requests=[];
 const auth={region:'us-east-2',userPoolId:'us-east-2_OFFLINEtest',clientId:'offlineclient123456789012',issuer:'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_OFFLINEtest',domainBaseUrl:'https://offline-production.auth.us-east-2.amazoncognito.com'};
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname!=='globevoy.com'){requests.push(u.origin);return route.abort();}
  let file=path.join(root,decodeURIComponent(u.pathname));if(u.pathname.endsWith('/'))file=path.join(file,'index.html');
  if(!file.startsWith(root)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  let body=fs.readFileSync(file);
  if(u.pathname==='/runtime/environment-policy.js')body=Buffer.from(body.toString()+`\nwindow.GLOBEVOY_PRODUCTION_RELEASE=${JSON.stringify({environment:'production',target:'globevoy.com',apiBaseUrl:'https://offline.lambda-url.us-east-2.on.aws',reactEnabled:true,accountsEnabled:true,auth})};`);
  const type={'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
  await route.fulfill({status:200,body,contentType:type});
 });
 const page=await context.newPage();
 await page.goto('https://globevoy.com/index.html');await page.waitForTimeout(1000);
 assert.ok((await page.locator('body').innerText()).length>200);console.log('PASS classic homepage renders');
 await page.goto('https://globevoy.com/react/account/');await page.getByRole('heading',{name:'Your trips, one place.'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Sign in or create account'}).isEnabled(),true);console.log('PASS production React account hydration and sign-in/create-account button');
 for(const p of ['my-trips','travel-profile']){await page.goto('https://globevoy.com/react/'+p+'/');await page.waitForTimeout(600);assert.ok((await page.locator('body').innerText()).length>100);console.log('PASS React '+p+' route renders');}
 assert.ok(!requests.some(x=>x.includes('staging')||x.includes('mirksnj')));console.log('PASS no staging network requests; all external calls blocked');
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});

