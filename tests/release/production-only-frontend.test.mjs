import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import policy from '../../frontend/runtime/environment-policy.js';
import { productionPolicySource, approvedFrontend, stagingDestinations } from '../../ops/release/production-frontend-policy.mjs';
import { verifyProductionFrontend } from '../../ops/release/verify-production-frontend.mjs';
const release = {environment:'production',target:'globevoy.com',...approvedFrontend,reactEnabled:true,accountsEnabled:true};
const clone = v => JSON.parse(JSON.stringify(v));
function browser(origin, candidate=clone(release), configuration=release) {
  const window={location:{origin}};
  const ctx=vm.createContext({window,URL});
  vm.runInContext(productionPolicySource(configuration),ctx);
  window.GLOBEVOY_PRODUCTION_RELEASE=candidate;
  return {window,environment:developmentApi=>window.GLOBEVOY_ENVIRONMENT_POLICY.resolve(origin,developmentApi)};
}

test('production-only module pins the approved API/auth; unknown/staging/loopback origins fail closed',()=>{
  const source=productionPolicySource(release);
  for(const value of Object.values(stagingDestinations()))assert.ok(!source.includes(value));
  for(const origin of ['https://globevoy.com','https://www.globevoy.com']){
    const b=browser(origin),e=b.environment(policy.stagingApi);
    assert.equal(e.apiBaseUrl,approvedFrontend.apiBaseUrl);assert.equal(e.auth.userPoolId,approvedFrontend.auth.userPoolId);assert.equal(e.accountsEnabled,true);assert.equal(e.reactEnabled,true);
    assert.equal(b.window.GLOBEVOY_ENVIRONMENT_POLICY.stagingOrigin,'');
  }
  for(const origin of ['',policy.stagingOrigin,'https://unknown.example','null','http://localhost:3000']){
    const e=browser(origin).environment('http://localhost:7072');
    assert.equal(e.apiBaseUrl,'');assert.equal(e.accountsEnabled,false);assert.equal(e.reactEnabled,false);assert.equal(e.auth,null);
  }
});

test('all original URL/issuer/region guards remain; runtime tampering cannot select staging or another deployment',()=>{
  const candidates=[
    {...release,apiBaseUrl:policy.stagingApi},
    {...release,apiBaseUrl:'https://other.lambda-url.us-east-2.on.aws'},
    {...release,apiBaseUrl:approvedFrontend.apiBaseUrl+'?key=not-real'},
    {...release,apiBaseUrl:approvedFrontend.apiBaseUrl+'/unsafe'},
    {...release,environment:'staging'},
    ...Object.entries(policy.stagingAuth).filter(([key])=>key!=='region').map(([key,value])=>({...release,auth:{...release.auth,[key]:value}})),
    ...['issuer','domainBaseUrl','userPoolId','clientId','region'].map(key=>({...release,auth:{...release.auth,[key]:'unapproved'}}))
  ];
  for(const candidate of candidates){const e=browser('https://globevoy.com',candidate).environment();assert.equal(e.accountsEnabled,false);assert.ok(e.apiBaseUrl===''||e.apiBaseUrl===approvedFrontend.apiBaseUrl);assert.equal(e.auth,null)}
  const disabled={...release,reactEnabled:false,accountsEnabled:false,auth:null};
  assert.equal(browser('https://globevoy.com',release,disabled).environment().accountsEnabled,false);
  assert.equal(browser('https://globevoy.com',release,disabled).environment().reactEnabled,false);
  assert.throws(()=>productionPolicySource({...release,apiBaseUrl:policy.stagingApi}),/approved/);
  for(const [key,value]of Object.entries(policy.stagingAuth).filter(([key])=>key!=='region'))assert.throws(()=>productionPolicySource({...release,auth:{...release.auth,[key]:value}}),/approved|staging identity/);
  assert.throws(()=>productionPolicySource({...release,auth:{...release.auth,secret:'not-real'}}),/approved/);
  assert.throws(()=>productionPolicySource({...release,providerToken:'not-real'}),/closed schema/);
});

test('ordinary source policy preserves staging and existing loopback development behavior',()=>{
  const e=policy.resolve(policy.stagingOrigin);
  assert.equal(e.apiBaseUrl,policy.stagingApi);assert.equal(e.auth.clientId,policy.stagingAuth.clientId);assert.equal(e.accountsEnabled,true);
  assert.equal(policy.resolve('http://localhost:3000','http://localhost:7072').apiBaseUrl,'http://localhost:7072');
  assert.equal(policy.resolve('https://unknown.example').accountsEnabled,false);
});

test('actual ZIP verifier rejects every known staging identifier, including compressed React chunks and escaped/encoded URLs',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gv-production-scan-'));
  const names=['index.html','auth-callback.html','runtime/environment-policy.js','runtime/auth-config-705b-r3.js','scripts/auth-session-705b-r3.js','sign-in.html','scripts/account-menu.js','react/account/index.html','react/my-trips/index.html','react/travel-profile/index.html','react/journey/index.html'];
  const files=Object.fromEntries(names.map(name=>[name,'test asset']));
  const zip=path.join(temp,'fixture.zip');
  function make(value){
    const contents={...files,'react/_next/static/chunks/regression.js':value};
    const manifest={productionOnly:true,files:Object.fromEntries(Object.entries(contents).map(([name,data])=>[name,createHash('sha256').update(data).digest('hex')]))};
    contents['release-manifest.json']=JSON.stringify(manifest);
    execFileSync(process.env.PYTHON||'python',['-c','import json,sys,zipfile;d=json.load(sys.stdin);z=zipfile.ZipFile(sys.argv[1],"w",compression=zipfile.ZIP_DEFLATED);[z.writestr(k,v) for k,v in d.items()];z.close()',zip],{input:JSON.stringify(contents)});
  }
  try{
    make('staging guard text; '+approvedFrontend.auth.issuer);assert.equal(verifyProductionFrontend(zip).verified,true);
    for(const value of Object.values(stagingDestinations())){
      make(value);assert.throws(()=>verifyProductionFrontend(zip),/Staging destinations/);
    }
    for(const value of ['https://unapproved.lambda-url.us-east-2.on.aws','https://other.auth.us-east-2.amazoncognito.com','us-east-2_OtherPool','clientId:"unapprovedclient123456"']){make(value);assert.throws(()=>verifyProductionFrontend(zip),/Unapproved API\/Cognito/)}
    make(policy.stagingApi.replaceAll('/','\\/'));assert.throws(()=>verifyProductionFrontend(zip),/Staging destinations/);
    make(encodeURIComponent(policy.stagingAuth.domainBaseUrl));assert.throws(()=>verifyProductionFrontend(zip),/Staging destinations/);
    const previous=process.env.PYTHONOPTIMIZE;
    try{process.env.PYTHONOPTIMIZE='1';make(policy.stagingApi);assert.throws(()=>verifyProductionFrontend(zip),/Staging destinations/)}
    finally{if(previous===undefined)delete process.env.PYTHONOPTIMIZE;else process.env.PYTHONOPTIMIZE=previous}
  }finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('gv-production-scan-'));fs.rmSync(temp,{recursive:true,force:true})}
});

test('classic account links preserve staging development fallback without hardcoded staging URLs',()=>{
  const shell=fs.readFileSync('frontend/scripts/shell-670f.js','utf8');
  const snippet=shell.slice(shell.indexOf('  const stagingOrigin ='),shell.indexOf('  function activeAccountSession'));
  // GV-WEB-2: the results page signs in through GlobevoyTripSearch.signIn (frontend/scripts/trip-search.js).
  const tripSearch=fs.readFileSync('frontend/scripts/trip-search.js','utf8');
  for(const productionOnly of [false,true]){
    const window={GLOBEVOY_ENVIRONMENT_POLICY:productionOnly?browser('https://globevoy.com').window.GLOBEVOY_ENVIRONMENT_POLICY:policy};
    const location={origin:'http://localhost:8080',hostname:'localhost',pathname:'/',search:'',hash:''};
    const ctx=vm.createContext({window,location,root:p=>p,URLSearchParams,sessionStorage:{getItem:()=>null}});
    vm.runInContext(snippet+';globalThis.accountLink=accountBaseHref;',ctx);
    assert.equal(ctx.accountLink,productionOnly?'react/account/':policy.stagingOrigin+'/react/account/');
    vm.runInContext(tripSearch+';window.GlobevoyTripSearch.signIn();',ctx);
    // GV-WEB-4: production sign-in starts on the GlobeVoy sign-in page, which hands over to Cognito.
    assert.equal(location.href,productionOnly?'sign-in.html?returnTo=%2F':policy.stagingOrigin+'/account.html');
  }
});
