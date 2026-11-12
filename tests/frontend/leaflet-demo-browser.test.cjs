const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('../../web/node_modules/playwright');
test('existing React results renders real Leaflet, route markers and attributed OSM tiles',async()=>{
  const base=process.env.GLOBEVOY_DEMO_TEST_URL;
  assert.ok(base,'Start the isolated local Docker image first');
  const u=new URL(base);assert.equal(u.protocol,'http:');assert.ok(['127.0.0.1','localhost'].includes(u.hostname));
  const js=fs.readFileSync('.cache/leaflet-test/leaflet.js'),css=fs.readFileSync('.cache/leaflet-test/leaflet.css');
  const browser=await chromium.launch({headless:true,...(process.env.GLOBEVOY_DEMO_BROWSER_CHANNEL?{channel:process.env.GLOBEVOY_DEMO_BROWSER_CHANNEL}:{})});
  try{
    const page=await browser.newPage({reducedMotion:'reduce'});const tileUrls=[],unexpected=[];
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===base)return route.continue();
      if(url.href==='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')return route.fulfill({contentType:'text/javascript',body:js});
      if(url.href==='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.hostname==='tile.openstreetmap.org'){
        tileUrls.push(url.href);return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
      }
      if(/googleapis|lambda-url|amazoncognito/.test(url.hostname))unexpected.push(url.hostname);
      return route.abort();
    });
    await page.goto(base+'/react/results/?origin=YYZ&budget=2500&currency=CAD&nights=7&month=2027-03&adults=1');
    await page.locator('.leaflet-container').waitFor({timeout:30000});
    await page.waitForFunction(()=>document.querySelectorAll('.leaflet-marker-icon').length>1);
    assert.equal(await page.evaluate(()=>window.L.version),'1.9.4');
    assert.match(await page.locator('.leaflet-control-attribution').innerText(),/OpenStreetMap/);
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    assert.ok(tileUrls.length>0);assert.deepEqual(unexpected,[]);
  }finally{await browser.close();}
});
