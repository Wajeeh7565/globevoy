'use strict';
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const root=__dirname;
const visualizer=fs.readFileSync(path.join(root,'scripts/multicity-visualizer-673c.js'),'utf8');
const cityImages=fs.readFileSync(path.join(root,'scripts/city-images-673c.js'),'utf8');
const checks=[];
function check(name,ok){checks.push({name,ok:!!ok});console.log(`${ok?'[PASS]':'[FAIL]'} ${name}`);if(!ok)process.exitCode=1;}
check('every rendered itinerary card resolves immediately', visualizer.includes("cards.forEach((card,index)=>{") && visualizer.includes('resolveCard(card,index);'));
check('route hydration does not depend on IntersectionObserver', !visualizer.includes("'IntersectionObserver' in window"));
check('route cards request eager images', visualizer.includes("installPhoto(card,generatedCityImage(city,country),city,country,'eager')"));

const store=new Map();
const legacyKey='gv-city-images-v10-673f:warsaw|poland';
store.set(legacyKey,JSON.stringify({images:['https://upload.wikimedia.org/example-warsaw.jpg'],confidence:'high',cachedAt:Date.now()}));
let fetchCalls=0;
const sandbox={
  window:{},
  localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v)},
  location:{search:''},
  URLSearchParams,
  URL,
  fetch:async()=>{fetchCalls++;throw new Error('network should not be used for a valid legacy cache hit');},
  AbortController,
  setTimeout,
  clearTimeout,
  console,
  Date,
  Promise,
  Map,
  Set,
  Number,
  String,
  RegExp,
  encodeURIComponent
};
vm.runInNewContext(cityImages,sandbox,{filename:'city-images-673c.js'});
(async()=>{
  const result=await sandbox.window.GlobevoyCityImages.get('Warsaw','Poland','');
  check('valid Codex 673F photo cache is reused', result.images[0].includes('example-warsaw.jpg') && fetchCalls===0);
  check('legacy cache is migrated into R2 namespace', store.has('gv-city-images-v12-673f-r2:warsaw|poland'));
  if(process.exitCode)throw new Error('GV-PROD-673F-R2 photo hydration test failed.');
  fs.writeFileSync(path.join(root,'VALIDATION_GV_PROD_673F_R2_PHOTOS.json'),JSON.stringify({release:'GV-PROD-673F-R2',passed:true,checkCount:checks.length,checks},null,2)+'\n');
  console.log(`GV-PROD-673F-R2 photo hydration validation passed (${checks.length}/${checks.length}).`);
})().catch(err=>{console.error(err);process.exit(1);});
