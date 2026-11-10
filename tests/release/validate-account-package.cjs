const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(process.argv[2]),enabled=process.argv.includes('--enabled');
const file=path.join(root,'services/accounts/auth/production-account-build.json');
assert.equal(fs.existsSync(file),enabled);
const auth=require(path.join(root,'services/accounts/auth/production-cognito-auth'));
const wrapper=require(path.join(root,'src/lambda'));
assert.equal(typeof wrapper.handler,'function');
assert.equal(auth.config()!==null,enabled);
if(enabled)assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),require('../../ops/release/production-account-config.json'));
let source=fs.readFileSync(path.join(__dirname,'../../backend/validation/validate-gv-production-account.js'),'utf8');
for(const name of ['production-account-lambda','services/accounts/auth/production-cognito-auth','services/accounts/auth/staging-cognito-auth-705b-r3'])source=source.replace("require('../"+name+"')",'require('+JSON.stringify(path.join(root,name))+')');
const result=spawnSync(process.execPath,['-e',source],{encoding:'utf8'});process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0,'Packaged JWT/CRUD regression failed');
(async()=>{
 const before={...process.env};
 for(const [route,status] of [['/api/account/session',enabled?401:503],['/api/saved-trips',enabled?401:503],['/api/account/travel-profile',enabled?401:503]]){
  const r=await wrapper.handler({rawPath:route,requestContext:{http:{method:'GET'}},headers:{origin:'https://globevoy.com'}});assert.equal(r.statusCode,status);
 }
 const event={rawPath:'/api/city-registry',requestContext:{http:{method:'GET'}},headers:{origin:'https://globevoy.com'},queryStringParameters:{limit:'1'}};
 assert.deepEqual(await wrapper.handler(event),await require(path.join(root,'lambda')).handler(event));
 assert.deepEqual({...process.env},before);
 console.log('PASS artifact opt-in/default-off, public API delegation and zero environment changes');
})().catch(e=>{console.error(e);process.exitCode=1;});
