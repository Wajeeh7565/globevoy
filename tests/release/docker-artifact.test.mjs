import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import policy from '../../frontend/runtime/environment-policy.js';
import {approvedFrontend} from '../../ops/release/production-frontend-policy.mjs';
test('actual composed Docker artifact contains only the selected environment destinations',()=>{
  const root=process.env.GLOBEVOY_DOCKER_ARTIFACT;
  assert.ok(root,'Extract the actual built Docker site first');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'runtime/docker-target.json'),'utf8'));
  assert.ok(['isolated','production','staging'].includes(manifest.target));
  const production=[approvedFrontend.apiBaseUrl,approvedFrontend.auth.clientId,approvedFrontend.auth.userPoolId,approvedFrontend.auth.domainBaseUrl];
  const staging=[policy.stagingApi,policy.stagingAuth.clientId,policy.stagingAuth.userPoolId,policy.stagingAuth.domainBaseUrl,policy.stagingOrigin];
  const forbidden=manifest.target==='isolated'?[...production,...staging]:manifest.target==='production'?staging:production;
  const files=fs.readdirSync(root,{recursive:true}).filter(f=>/\.(html|js|json)$/.test(f));
  const chunks=[];
  for(const file of files){const body=fs.readFileSync(path.join(root,file),'utf8');for(const value of forbidden)assert.ok(!body.includes(value),file+' retained forbidden destination');if(file.replaceAll('\\','/').includes('_next/')&&file.endsWith('.js'))chunks.push(body);}
  assert.ok(chunks.length>0);
  if(manifest.target!=='isolated')for(const value of manifest.target==='production'?production:staging.slice(0,4))assert.ok(chunks.some(s=>s.includes(value)),'React bundle missing selected identifier');
  for(const file of ['index.html','multi-city.html','multicity-visualizer.html','auth-callback.html','scripts/booking-account-snapshot-706a.js','react/account/index.html','react/my-trips/index.html']){
    assert.ok(fs.existsSync(path.join(root,file)),file);
  }
});
