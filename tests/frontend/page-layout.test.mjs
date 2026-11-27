import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import os from 'node:os';
import {readPageLayout,compatibilityRedirectHtml,writeCompatibilityPages} from '../../ops/frontend/page-layout.mjs';
import {writeClassicSeo} from '../../ops/frontend/seo.mjs';
import sourceLayout from '../../ops/frontend/source-layout.cjs';
import layoutAssertions from '../../frontend/validation/page-layout-support.cjs';
const layout=readPageLayout();
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('all active HTML is centralized and archived mockups stay byte-preserved',()=>{
 assert.equal(layout.archives.length,31);
 for(const item of layout.archives){assert.equal(sha(item.to),item.sha256,item.to)}
 assert.deepEqual(fs.readdirSync('frontend/pages').filter(n=>n.endsWith('.html')).sort(), [...layout.retainedLegacyPages,...layout.publicPageSources.map(item=>path.basename(item.to))].sort());
 assert.equal(fs.readdirSync('frontend').filter(n=>n.endsWith('.html')).length,0);
 const publicNames=new Set(layout.publicPageSources.map(item=>path.basename(item.to)));
 assert.equal(publicNames.size,23);
 for(const item of layout.publicPageSources){assert.equal(fs.existsSync(item.from),false);assert.equal(sha(item.to),item.sha256,item.to);}
 for(const name of layout.retainedLegacyPages)assert.equal(publicNames.has(name),false,'Duplicate active page name: '+name);
 assert.ok(fs.readFileSync('frontend/pages/about.html','utf8').includes('About Globevoy'));
});

test('promoted public content is real HTML with correct root asset paths and shell depth',()=>{
 assert.equal(layout.promotions.length,4);
 for(const item of layout.promotions){
  const source=sourceLayout.frontendSourcePath('frontend',path.basename(item.to));const html=fs.readFileSync(source,'utf8');
  assert.equal(layoutAssertions.promotedPageContentPreserved(path.basename(item.to)),true);
  assert.equal(layoutAssertions.promotedPageContentPreserved(path.basename(item.to),html+'<p>Changed content</p>'),false);
  assert.ok(!html.includes('http-equiv="refresh"'),item.to);
  assert.ok(html.includes('data-depth="0"'),item.to);assert.ok(!html.includes('../'),item.to);
  for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
   const value=match[1].split('?')[0].split('#')[0];
   if(!value||/^(?:[a-z]+:|\/\/)/i.test(value))continue;
   const target=sourceLayout.frontendSourcePath('frontend',value.replace(/^\//,''));
   assert.ok(fs.existsSync(target),item.to+' -> '+value);
  }
 }
});

test('every former public URL has a safe compatibility redirect preserving query and fragment',()=>{
 assert.equal(Object.keys(layout.compatibilityRedirects).length,36);
 const queries=['','?returnTo=%2Freact%2Fmy-trips%2F&tag=a&tag=b','?code=synthetic-not-real&state=synthetic-not-real'];
 for(const [route,target]of Object.entries(layout.compatibilityRedirects)){
  assert.match(route,/^\/pages\/[a-z0-9-]+\.html$/);
  assert.ok(target.startsWith('/react/')?fs.existsSync('web/app/'+target.slice(7)+'page.tsx'):fs.existsSync(sourceLayout.frontendSourcePath('frontend',target.slice(1))),target);
  const html=compatibilityRedirectHtml(target),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(html,/compatibility-redirect/);assert.ok(!/<form\b/i.test(html));
  for(const search of queries){let destination;const hash='#saved-section';vm.runInNewContext(script,{window:{location:{search,hash,replace:value=>{destination=value}}}});assert.equal(destination,target+search+hash);assert.ok(!destination.startsWith('//'))}
 }
 for(const bad of ['https://evil.example','//evil.example/x','/../index.html','/index.html?next=evil','/pages/about.html','javascript:alert(1)'])assert.throws(()=>compatibilityRedirectHtml(bad),/Invalid fixed/);
});

test('release generation preserves legacy content, emits redirects and excludes archived designs',()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gv-page-layout-'));
 try{
  sourceLayout.copyFrontendSource(output);
  for(const item of layout.publicPageSources)assert.equal(sha(path.join(output,path.basename(item.to))),item.sha256,item.to);
  assert.equal(fs.existsSync(path.join(output,'validation')),false);
  assert.equal(fs.existsSync(path.join(output,'README.md')),false);
  for(const target of new Set(Object.values(layout.compatibilityRedirects))){const file=path.join(output,target.slice(1),target.endsWith('/')?'index.html':'');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,target.startsWith('/react/')?'<h1>React fixture</h1>':fs.readFileSync(sourceLayout.frontendSourcePath('frontend',target.slice(1))));}
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
 assert.ok(clean.includes('index.html'));
});

test('published SEO metadata and sitemap agree without changing classic page bodies', () => {
 const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-page-layout-'));
 const origin = 'https://globevoy.com';
 const pages = new Map([
  ['index.html', '/'],
  ['about.html', '/about.html'],
  ['how-it-works.html', '/how-it-works.html'],
  ['trust.html', '/trust.html']
 ]);
 const head = /<head>([\s\S]*?)<\/head>/i;
 try {
  sourceLayout.copyFrontendSource(output);
  writeClassicSeo(output, layout.publicPageSources);
  const titles = new Set(), descriptions = new Set();
  for (const { to } of layout.publicPageSources) {
   const name = path.basename(to);
   const published = fs.readFileSync(path.join(output, name), 'utf8');
   assert.equal(published.replace(head, ''), fs.readFileSync(to, 'utf8').replace(head, ''), name);
   const metadata = published.match(head)[1];
   const route = pages.get(name);
   if (route) {
    const canonical = origin + route;
    assert.deepEqual([...metadata.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(match => match[1]), [canonical]);
    assert.ok(metadata.includes(`<meta property="og:url" content="${canonical}">`));
    assert.doesNotMatch(metadata, /noindex/i);
    const title = [...metadata.matchAll(/<title>([^<]+)<\/title>/g)];
    const description = [...metadata.matchAll(/<meta name="description" content="([^"]+)">/g)];
    assert.equal(title.length, 1, name);
    assert.equal(description.length, 1, name);
    titles.add(title[0][1]);
    descriptions.add(description[0][1]);
    assert.match(published, /<h1\b[^>]*>[^<\s]/i);
   } else {
    assert.match(metadata, /<meta name="robots" content="noindex\b/i);
    assert.doesNotMatch(metadata, /rel="canonical"/i);
   }
  }
  assert.equal(titles.size, pages.size);
  assert.equal(descriptions.size, pages.size);
  const robots = fs.readFileSync(path.join(output, 'robots.txt'), 'utf8');
  assert.equal(robots, 'User-agent: *\nAllow: /\n\nSitemap: ' + origin + '/sitemap.xml\n');
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), [...pages.values()].map(route => origin + route));
  for (const [alias, target] of Object.entries(layout.compatibilityRedirects)) {
   const html = compatibilityRedirectHtml(target);
   if ([...pages.values()].includes(target)) {
    assert.ok(html.includes(`rel="canonical" href="${origin + target}"`), alias);
    assert.doesNotMatch(html, /noindex/i);
   } else {
    assert.match(html, /content="noindex"/, alias);
    assert.doesNotMatch(html, /rel="canonical"/, alias);
   }
  }
 } finally {
  assert.equal(path.dirname(path.resolve(output)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(output).startsWith('gv-page-layout-'));
  fs.rmSync(output, { recursive: true, force: true });
 }
});

test('retained legacy button routing still resolves from promoted root and nested screens',()=>{
 const script=fs.readFileSync('frontend/scripts/clean-routing.js','utf8');
 for(const depth of [0,1]){
  const labels=['Find trips within my budget','Explore Multi-city','View trip details','Multi-city'];
  const buttons=labels.map(textContent=>({textContent,handlers:[],addEventListener(_,fn){this.handlers.push(fn)}}));
  const window={location:{href:''}};
  vm.runInNewContext(script,{window,document:{body:{dataset:{depth:String(depth)}},querySelectorAll:()=>buttons}});
  for(const button of buttons){assert.equal(button.handlers.length,1);button.handlers[0]();assert.ok(fs.existsSync(sourceLayout.frontendSourcePath('frontend',path.join(depth?'pages':'',window.location.href))),window.location.href)}
 }
});
