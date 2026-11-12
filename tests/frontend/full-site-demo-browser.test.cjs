const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('../../web/node_modules/playwright');
test('real composed demo browser navigation and same-origin API',async()=>{
  const base=process.env.GLOBEVOY_DEMO_TEST_URL;
  assert.ok(base,'Set GLOBEVOY_DEMO_TEST_URL to the local demo container');
  const target=new URL(base);assert.equal(target.protocol,'http:');assert.ok(['127.0.0.1','localhost'].includes(target.hostname));
  const browser=await chromium.launch({headless:true,...(process.env.GLOBEVOY_DEMO_BROWSER_CHANNEL?{channel:process.env.GLOBEVOY_DEMO_BROWSER_CHANNEL}:{})});
  try {
    const page=await browser.newPage();const forbidden=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(/lambda-url|amazoncognito|amplifyapp/.test(u.hostname))forbidden.push(u.origin);
      return u.origin===base?route.continue():route.abort();
    });
    await page.goto(base+'/');await page.waitForFunction(()=>window.GLOBEVOY_CONFIG);
    assert.equal(await page.evaluate(()=>window.GLOBEVOY_CONFIG.apiBaseUrl),base);
    assert.equal(await page.evaluate(()=>window.GLOBEVOY_ENVIRONMENT_POLICY.resolve(location.origin).accountsEnabled),false);
    const registry=await page.evaluate(()=>fetch('/api/city-registry?q=Toronto&limit=3').then(r=>r.json()));
    assert.ok(registry.records.length);
    for(const route of ['/about.html','/multi-city.html','/react/account/','/react/my-trips/']) {
      await page.goto(base+route);await page.waitForLoadState('networkidle');
      assert.ok(await page.locator('body').innerText());
    }
    assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
