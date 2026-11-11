import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import os from 'node:os';
import {readPageLayout,compatibilityRedirectHtml,writeCompatibilityPages} from '../../ops/frontend/page-layout.mjs';
import layoutAssertions from '../../frontend/validation/page-layout-support.cjs';
const layout=readPageLayout();
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('unused designs are byte-preserved outside active source; only linked legacy screens remain',()=>{
 assert.equal(layout.archives.length,31);
 for(const item of layout.archives){assert.equal(fs.existsSync(item.from),false,item.from);assert.equal(sha(item.to),item.sha256,item.to)}
 assert.deepEqual(fs.readdirSync('frontend/pages').filter(n=>n.endsWith('.html')).sort(),layout.retainedLegacyPages);
 const publicNames=new Set(fs.readdirSync('frontend').filter(n=>n.endsWith('.html')));
 assert.equal(publicNames.size,22);
 for(const name of layout.retainedLegacyPages)assert.equal(publicNames.has(name),false,'Duplicate active page name: '+name);
 assert.ok(fs.readFileSync('frontend/about.html','utf8').includes('About Globevoy'));
});

test('promoted public content is real HTML with correct root asset paths and shell depth',()=>{
 assert.equal(layout.promotions.length,5);
 for(const item of layout.promotions){
  assert.equal(fs.existsSync(item.from),false);const html=fs.readFileSync(item.to,'utf8');
  assert.equal(layoutAssertions.promotedPageContentPreserved(path.basename(item.to)),true);
  assert.equal(layoutAssertions.promotedPageContentPreserved(path.basename(item.to),html+'<p>Changed content</p>'),false);
  assert.ok(!html.includes('http-equiv="refresh"'),item.to);
  assert.ok(html.includes('data-depth="0"'),item.to);assert.ok(!html.includes('../'),item.to);
  for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
   const value=match[1].split('?')[0].split('#')[0];
   if(!value||/^(?:[a-z]+:|\/\/)/i.test(value))continue;
   const target=value.startsWith('/')?path.join('frontend',value):path.join(path.dirname(item.to),value);
   assert.ok(fs.existsSync(target),item.to+' -> '+value);
  }
 }
});

test('every former public URL has a safe compatibility redirect preserving query and fragment',()=>{
 assert.equal(Object.keys(layout.compatibilityRedirects).length,36);
 const queries=['','?returnTo=%2Freact%2Fmy-trips%2F&tag=a&tag=b','?code=synthetic-not-real&state=synthetic-not-real'];
 for(const [route,target]of Object.entries(layout.compatibilityRedirects)){
  assert.match(route,/^\/pages\/[a-z0-9-]+\.html$/);
  assert.ok(target.startsWith('/react/')?fs.existsSync('web/app/'+target.slice(7)+'page.tsx'):fs.existsSync('frontend'+target),target);
  const html=compatibilityRedirectHtml(target),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(html,/compatibility-redirect/);assert.ok(!/<form\b/i.test(html));
  for(const search of queries){let destination;const hash='#saved-section';vm.runInNewContext(script,{window:{location:{search,hash,replace:value=>{destination=value}}}});assert.equal(destination,target+search+hash);assert.ok(!destination.startsWith('//'))}
 }
 for(const bad of ['https://evil.example','//evil.example/x','/../index.html','/index.html?next=evil','/pages/about.html','javascript:alert(1)'])assert.throws(()=>compatibilityRedirectHtml(bad),/Invalid fixed/);
});

test('release generation preserves legacy content, emits redirects and excludes archived designs',()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gv-page-layout-'));
 try{
  fs.cpSync('frontend/pages',path.join(output,'pages'),{recursive:true});
  for(const target of new Set(Object.values(layout.compatibilityRedirects))){const file=path.join(output,target.slice(1),target.endsWith('/')?'index.html':'');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,target.startsWith('/react/')?'<h1>React fixture</h1>':fs.readFileSync('frontend'+target));}
  assert.equal(writeCompatibilityPages(output),36);
  for(const name of layout.retainedLegacyPages)assert.equal(sha(path.join(output,'pages',name)),sha(path.join('frontend/pages',name)));
  for(const route of Object.keys(layout.compatibilityRedirects)){const html=fs.readFileSync(path.join(output,route.slice(1)),'utf8');assert.match(html,/compatibility-redirect/);assert.ok(!html.includes('original-stitch-code-html'))}
  assert.equal(fs.existsSync(path.join(output,'archive')),false);
  assert.throws(()=>writeCompatibilityPages(output),/overwrite live content/);
 }finally{assert.equal(path.dirname(path.resolve(output)),path.resolve(os.tmpdir()));assert.ok(path.basename(output).startsWith('gv-page-layout-'));fs.rmSync(output,{recursive:true,force:true})}
});

test('active frontend consumers no longer link to archived source paths',()=>{
 const excluded=new Set(['validation','screenshots']);
 function scan(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(excluded.has(ent.name))continue;const file=path.join(dir,ent.name);if(ent.isDirectory())scan(file);else if(/\.(html|js|css)$/.test(ent.name)){const text=fs.readFileSync(file,'utf8');for(const item of [...layout.archives,...layout.promotions])assert.ok(!text.includes('pages/'+path.basename(item.from)),file+' references removed source '+item.from)}}}
 scan('frontend');
 const clean=fs.readFileSync('frontend/scripts/clean-routing.js','utf8');
 for(const name of layout.retainedLegacyPages)assert.ok(clean.includes(name));
 const mixed=fs.readFileSync('frontend/scripts/mixed-results-542b-r1.js','utf8');assert.ok(mixed.includes('`create-account.html?returnTo='));
});

test('retained legacy button routing still resolves from promoted root and nested screens',()=>{
 const script=fs.readFileSync('frontend/scripts/clean-routing.js','utf8');
 for(const depth of [0,1]){
  const labels=['Find trips within my budget','Explore Multi-city','View trip details','Multi-city'];
  const buttons=labels.map(textContent=>({textContent,handlers:[],addEventListener(_,fn){this.handlers.push(fn)}}));
  const window={location:{href:''}};
  vm.runInNewContext(script,{window,document:{body:{dataset:{depth:String(depth)}},querySelectorAll:()=>buttons}});
  for(const button of buttons){assert.equal(button.handlers.length,1);button.handlers[0]();assert.ok(fs.existsSync(path.join('frontend',depth?'pages':'',window.location.href)),window.location.href)}
 }
});
