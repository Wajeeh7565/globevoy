import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicPages, siteOrigin } from './seo.mjs';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function readPageLayout() {
 return JSON.parse(fs.readFileSync(path.join(repository,'ops/frontend/page-layout.json'),'utf8'));
}
export function compatibilityRedirectHtml(target) {
 if(!/^\/(?:[a-z0-9-]+\.html|react\/(?:account|my-trips|travel-profile)\/)$/.test(target)) throw Error('Invalid fixed compatibility target');
 const canonical = publicPages.has(target) ? target : '';
 const metadata = canonical
  ? `<link rel="canonical" href="${siteOrigin + canonical}">`
  : '<meta name="robots" content="noindex">';
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page moved | GlobeVoy</title><meta name="gv-page-kind" content="compatibility-redirect">${metadata}
<script>window.location.replace(${JSON.stringify(target)} + window.location.search + window.location.hash);</script>
<noscript><meta http-equiv="refresh" content="0;url=${target}"></noscript></head>
<body><p>This page has moved. <a href="${target}">Continue to GlobeVoy</a>.</p></body></html>\n`;
}
export function writeCompatibilityPages(output) {
 const layout=readPageLayout();
 for(const [route,target]of Object.entries(layout.compatibilityRedirects)) {
  if(!/^\/pages\/[a-z0-9-]+\.html$/.test(route)) throw Error('Invalid compatibility route');
  const destination=path.join(output,target.slice(1),target.endsWith('/')?'index.html':'');
  if(!fs.existsSync(destination)) throw Error('Missing compatibility destination: '+target);
  const file=path.join(output,route.slice(1));
  if(fs.existsSync(file)) throw Error('Compatibility route would overwrite live content: '+route);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,compatibilityRedirectHtml(target));
 }
 return Object.keys(layout.compatibilityRedirects).length;
}
