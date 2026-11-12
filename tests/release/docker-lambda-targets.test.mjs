import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import http from 'node:http';
import {dockerPolicy} from '../../ops/docker/prepare-policy.mjs';
import policy from '../../frontend/runtime/environment-policy.js';
import {approvedFrontend} from '../../ops/release/production-frontend-policy.mjs';

function browser(selected){const context={window:{GLOBEVOY_DEMO_ORIGIN:'http://globevoy-demo.test:8787'},URL};vm.runInNewContext(selected.source,context);return context.window.GLOBEVOY_ENVIRONMENT_POLICY;}
test('single-environment profiles reuse the maintained factory and reject unknown origins',()=>{
  assert.throws(()=>dockerPolicy('arbitrary'),/target/);
  for(const target of ['production','staging']){
    const selected=dockerPolicy(target),p=browser(selected),resolved=p.resolve(selected.manifest.origin);
    assert.equal(resolved.environment,target);assert.equal(resolved.accountsEnabled,true);
    assert.equal(resolved.apiBaseUrl,target==='production'?approvedFrontend.apiBaseUrl:policy.stagingApi);
    assert.equal(resolved.auth.clientId,target==='production'?approvedFrontend.auth.clientId:policy.stagingAuth.clientId);
    for(const origin of ['http://globevoy-demo.test:8787','http://127.0.0.1:8787','https://evil.invalid']){
      const denied=p.resolve(origin,policy.stagingApi);assert.equal(denied.apiBaseUrl,'');assert.equal(denied.accountsEnabled,false);
    }
    assert.equal(p.resolve('http://localhost:8787','http://localhost:9999').apiBaseUrl,'');
    if(target==='production')for(const forbidden of [policy.stagingApi,policy.stagingAuth.clientId,policy.stagingAuth.userPoolId,policy.stagingOrigin])assert.ok(!selected.source.includes(forbidden));
    else for(const forbidden of [approvedFrontend.apiBaseUrl,approvedFrontend.auth.clientId,approvedFrontend.auth.userPoolId])assert.ok(!selected.source.includes(forbidden));
  }
  const isolated=dockerPolicy('isolated');assert.equal(browser(isolated).resolve('http://globevoy-demo.test:8787').accountsEnabled,false);
  for(const destination of [policy.productionApi,policy.stagingApi])assert.ok(!isolated.source.includes(destination));
});

async function serve(selected,origin){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gv-lambda-target-'));fs.mkdirSync(path.join(root,'runtime'));
  fs.writeFileSync(path.join(root,'runtime/environment-policy.js'),selected.source);fs.writeFileSync(path.join(root,'runtime/docker-target.json'),JSON.stringify(selected.manifest));
  fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><html><head></head><body>GlobeVoy</body></html>');
  const reserve=net.createServer().listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const env={PORT:String(port),GLOBEVOY_SITE_ROOT:root,GLOBEVOY_DEMO_ORIGIN:origin};
  for(const k of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
  const child=spawn(process.execPath,['ops/docker/serve-demo.cjs'],{env,stdio:['ignore','ignore','ignore']});
  const exit=once(child,'exit');exit.catch(()=>{});
  return {child,exit,base:'http://127.0.0.1:'+port,cleanup:async()=>{if(child.exitCode===null){child.kill();await exit;}fs.rmSync(root,{recursive:true,force:true});}};
}
function request(base,route,host){return new Promise((resolve,reject)=>{
  http.get(base+route,{headers:{Host:host}},response=>{response.resume();response.on('end',()=>resolve({status:response.statusCode,headers:response.headers}));}).on('error',reject);
});}
test('connected container has no proxy/local fallback and refuses wrong Host',async()=>{
  const s=await serve(dockerPolicy('production'),'https://globevoy.com');
  try{
    for(let i=0;i<100;i++){try{if((await fetch(s.base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
    assert.equal((await request(s.base,'/','globevoy.com')).status,200);
    assert.equal((await request(s.base,'/api/account/session','globevoy.com')).status,409);
    assert.equal((await request(s.base,'/api/recommendations','globevoy.com')).status,409);
    assert.equal((await request(s.base,'/','evil.invalid')).status,403);
    const www=await request(s.base,'/auth-callback.html?state=offline-test','www.globevoy.com');
    assert.equal(www.status,302);assert.equal(www.headers.location,'https://globevoy.com/auth-callback.html?state=offline-test');
  }finally{await s.cleanup();}
});
test('remote profile cannot start on demo origin or a mismatched manifest',async()=>{
  for(const selected of [dockerPolicy('production'),{...dockerPolicy('staging'),manifest:{target:'production',origin:'https://globevoy.com'}}]){
    const origin=selected.manifest.target==='production'&&selected.source.includes(policy.stagingApi)?'https://globevoy.com':'http://globevoy-demo.test:8787';
    const s=await serve(selected,origin);try{const [code]=await s.exit;assert.notEqual(code,0);}finally{await s.cleanup();}
  }
});
