import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const policy = require('../../frontend/runtime/environment-policy.js');
const ts = require('../../web/node_modules/typescript');
const source = p => fs.readFileSync(p, 'utf8');
const session = { version: 'GV-ACCOUNT-705B-R3', accessToken: 'test-token', expiresAt: Date.now()+3600000, verifiedAt: Date.now(), user: {sub: 'test'} };
function browser(origin) {
 const window = {location: {origin, pathname: '/', search: '', hash: ''}, sessionStorage: {getItem: () => JSON.stringify(session)}};
 return vm.createContext({window, URL, console, Date, document: {readyState: 'loading', addEventListener() {}}, fetch() {throw Error('Unexpected network call');}, process: {env: {NEXT_PUBLIC_GLOBEVOY_API_BASE_URL: policy.stagingApi}}});
}
function classic(origin) {
 const ctx=browser(origin);
 for (const p of ['runtime/environment-policy.js', 'runtime/config.js', 'runtime/auth-config-705b-r3.js', 'scripts/auth-session-705b-r3.js']) vm.runInContext(source('frontend/'+p),ctx);
 return ctx;
}
function reactModule(file, ctx, dependencies) {
 const exports={}; ctx.exports=exports; ctx.require=name => { if (!(name in dependencies)) throw Error(name); return dependencies[name]; };
 vm.runInContext(ts.transpileModule(source(file), {compilerOptions: {module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText,ctx);
 return exports;
}
for (const origin of ['https://globevoy.com','https://www.globevoy.com','https://main.dttux5e6ddtzb.amplifyapp.com']) {
 test('production API and disabled auth: '+origin, async () => {
  const ctx=classic(origin), w=ctx.window;
  assert.equal(w.GLOBEVOY_CONFIG.apiBaseUrl,policy.productionApi);
  assert.equal(w.GLOBEVOY_CONFIG.worldwideRegistryEnabled,false);
  assert.equal(w.GLOBEVOY_AUTH_CONFIG.enabled,false);
  assert.equal(w.GLOBEVOY_AUTH_CONFIG.clientId,'');
  assert.equal(w.GLOBEVOY_AUTH_CONFIG.callbackUrl,'');
  assert.equal(w.GlobevoyAuth705B.getSession(),null);
  assert.equal(await w.GlobevoyAuth705B.reverifySession(session),null);
  const config=reactModule('web/lib/public-config.ts',ctx,{'../../frontend/runtime/environment-policy.js':policy});
  assert.equal(config.browserApiBaseUrl(),policy.productionApi);
  assert.equal(config.browserEnvironment().reactEnabled,false);
  const auth=reactModule('web/lib/auth.ts',ctx,{'@/lib/public-config':config});
  assert.equal(auth.getAuthSession(),null);
  assert.equal(await auth.reverifyAuthSession(session),null);
  const api=reactModule('web/lib/api.ts',ctx,{'@/lib/public-config':config});
  await assert.rejects(api.listSavedTrips('test-token'), /not available/);
  assert.equal((await api.getPublicMultiCityAutomaticDates({})).supported,false);
 });
}
test('staging remains enabled; unknown origins and remote development overrides fail closed', () => {
 const ctx=classic(policy.stagingOrigin);
 assert.equal(ctx.window.GLOBEVOY_CONFIG.apiBaseUrl,policy.stagingApi);
 assert.equal(ctx.window.GLOBEVOY_AUTH_CONFIG.enabled,true);
 assert.equal(ctx.window.GlobevoyAuth705B.getSession().accessToken,'test-token');
 assert.equal(policy.resolve('https://unexpected.example',policy.stagingApi).apiBaseUrl,'');
 assert.equal(policy.resolve('http://localhost:3000',policy.stagingApi).apiBaseUrl,'');
 assert.equal(policy.resolve('http://localhost:3000','http://localhost:7072').apiBaseUrl,'http://localhost:7072');
});
test('classic consumers load shared policy first', () => {
 for (const name of fs.readdirSync('frontend',{recursive:true}).filter(p=>p.endsWith('.html') && !p.includes('validation'))) {
  const html=source('frontend/'+name);
  const consumer=html.search(/<script[^>]+src=["'][^"']*(?:runtime\/(?:config|auth-config-705b-r3)|scripts\/shell-670f)\.js/);
  if (consumer>=0) assert.ok(html.indexOf('runtime/environment-policy.js')>=0 && html.indexOf('runtime/environment-policy.js')<consumer,name);
 }
});
