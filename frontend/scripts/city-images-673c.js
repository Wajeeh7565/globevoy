(function(){
'use strict';

const VERSION='GV-IMG-673F-R2';
const CACHE_PREFIX='gv-city-images-v12-673f-r2:';
const LEGACY_CACHE_PREFIXES=['gv-city-images-v11-673f-r1:','gv-city-images-v10-673f:'];
const CACHE_TTL=30*24*60*60*1000;
const REGISTRY_URL='./assets/data/city-image-registry-673c.json';
const mem=new Map();
let registryPromise=null;

const LOCAL={
  'dubai|united arab emirates':'./assets/images/dubai.jpg','dubai|uae':'./assets/images/dubai.jpg','dubai':'./assets/images/dubai.jpg',
  'cairo|egypt':'./assets/images/cairo.jpg','cairo':'./assets/images/cairo.jpg',
  'mexico city|mexico':'./assets/images/mexico-city.jpg',
  'montreal|canada':'./assets/images/montreal.jpg','montréal|canada':'./assets/images/montreal.jpg','montreal':'./assets/images/montreal.jpg','montréal':'./assets/images/montreal.jpg',
  'new york|united states':'./assets/images/new-york-city.jpg','new york city|united states':'./assets/images/new-york-city.jpg',
  'toronto|canada':'./assets/images/toronto.jpg','toronto':'./assets/images/toronto.jpg',
  'ottawa|canada':'./assets/images/ottawa.jpg','ottawa':'./assets/images/ottawa.jpg',
  'cancun|mexico':'./assets/images/cancun.jpg','cancún|mexico':'./assets/images/cancun.jpg','cancun':'./assets/images/cancun.jpg','cancún':'./assets/images/cancun.jpg',
  'fort lauderdale|united states':'./assets/images/fort-lauderdale.jpg','fort lauderdale|usa':'./assets/images/fort-lauderdale.jpg','fort lauderdale':'./assets/images/fort-lauderdale.jpg',
  'miami|united states':'./assets/images/miami.jpg','miami|usa':'./assets/images/miami.jpg','miami':'./assets/images/miami.jpg',
  'montego bay|jamaica':'./assets/images/montego-bay.jpg','montego bay':'./assets/images/montego-bay.jpg'
};

const COUNTRY_ALIASES={
  'usa':'united states','us':'united states','u.s.':'united states','united states of america':'united states',
  'uae':'united arab emirates','u.a.e.':'united arab emirates','uk':'united kingdom','u.k.':'united kingdom',
  'turkiye':'turkey','türkiye':'turkey','czech republic':'czechia','south korea':'korea, republic of',
  'russia':'russian federation','vietnam':'viet nam','bolivia':'bolivia, plurinational state of'
};

function ascii(v){return String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'');}
function norm(v){return ascii(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function countryNorm(v){const n=norm(v);return COUNTRY_ALIASES[n]||n;}
function key(city,country){return `${norm(city)}|${countryNorm(country)}`;}
function normalizeUrl(v){const s=String(v||'').trim();return s.startsWith('//')?'https:'+s:s;}
function safeGet(k){try{const v=JSON.parse(localStorage.getItem(k)||'null');if(!v)return null;if(v.cachedAt&&Date.now()-v.cachedAt>CACHE_TTL)return null;return v;}catch(_){return null;}}
function safeSet(k,v){try{localStorage.setItem(k,JSON.stringify({...v,cachedAt:Date.now()}));}catch(_){}}
function isOffline(){return new URLSearchParams(location.search).get('offline')==='1';}
function isTrustedFallback(v){const s=String(v||'');return /^\.?\/?assets\/images\//i.test(s)||/^(https?:)?\/\/(upload\.wikimedia\.org|commons\.wikimedia\.org|[a-z-]+\.wikipedia\.org)\//i.test(s);}
function sourceSearchUrl(city,country){return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent([city,country].filter(Boolean).join(', '))}`;}
function badTitle(v){return /\b(flag|coat of arms|locator|location map|seal|logo|icon|symbol|blank map|district map|route map|administrative divisions|politician|footballer|actor|actress|portrait|selfie|food|dish|menu|airport diagram|airline logo|wikivoyage banner)\b/i.test(String(v||''));}
function photoMime(v){return /^image\/(jpeg|png|webp)$/i.test(String(v||''));}
function pushCandidate(list,c){if(!c||!c.url)return;const url=normalizeUrl(c.url);if(!url||list.some(x=>x.url===url))return;list.push({...c,url});}
function bestCandidate(list){return list.slice().sort((a,b)=>(b.score||0)-(a.score||0))[0]||null;}

function hashHue(city,country){const text=`${city}|${country}`;let h=0;for(let i=0;i<text.length;i++)h=(h*31+text.charCodeAt(i))%360;return h;}
function svgEscape(v){return String(v||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));}
function generatedCitySvg(city,country){
  const hue=hashHue(city,country),h2=(hue+38)%360,h3=(hue+180)%360;
  const safeCity=svgEscape(city||'Destination'),safeCountry=svgEscape(country||'');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" role="img" aria-label="${safeCity} destination artwork"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},62%,44%)"/><stop offset=".55" stop-color="hsl(${h2},62%,34%)"/><stop offset="1" stop-color="hsl(${h3},48%,26%)"/></linearGradient></defs><rect width="1200" height="720" fill="url(#g)"/><circle cx="980" cy="120" r="150" fill="rgba(255,255,255,.18)"/><path d="M0 500 C160 390 280 420 420 350 C590 260 720 310 880 230 C1010 160 1110 190 1200 130 L1200 720 L0 720 Z" fill="rgba(255,255,255,.22)"/><path d="M0 555 C180 490 320 525 480 455 C660 375 820 440 1000 360 C1100 318 1160 315 1200 302 L1200 720 L0 720 Z" fill="rgba(4,18,34,.28)"/><g fill="rgba(255,255,255,.82)"><rect x="120" y="350" width="48" height="190" rx="8"/><rect x="188" y="295" width="72" height="245" rx="10"/><rect x="282" y="380" width="55" height="160" rx="8"/><rect x="362" y="330" width="88" height="210" rx="10"/><rect x="470" y="405" width="58" height="135" rx="8"/></g><text x="72" y="105" fill="white" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="64">${safeCity}</text><text x="76" y="154" fill="rgba(255,255,255,.78)" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="28" letter-spacing="4">${safeCountry}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function fetchJson(url,timeout=10000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal,mode:'cors',credentials:'omit'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }finally{clearTimeout(timer);}
}

async function loadRegistry(){
  if(!registryPromise){
    registryPromise=fetchJson(REGISTRY_URL,12000).then(data=>{
      const list=Array.isArray(data?.cities)?data.cities:[];
      const byKey=new Map();
      const cityCountries=new Map();
      list.forEach(item=>{
        byKey.set(key(item.city,item.country),item);
        byKey.set(`${norm(item.city)}|${String(item.countryCode||'').toLowerCase()}`,item);
        const cityKey=norm(item.city),countryKey=countryNorm(item.country)||String(item.countryCode||'').toLowerCase();
        if(!cityCountries.has(cityKey))cityCountries.set(cityKey,new Set());
        if(countryKey)cityCountries.get(cityKey).add(countryKey);
      });
      const ambiguousCities=new Set([...cityCountries].filter(([,countries])=>countries.size>1).map(([city])=>city));
      return {meta:data,byKey,ambiguousCities};
    }).catch(()=>({meta:{cities:[]},byKey:new Map(),ambiguousCities:new Set()}));
  }
  return registryPromise;
}

async function recordFor(city,country){
  const reg=await loadRegistry();
  return reg.byKey.get(key(city,country))||null;
}

function titleScore(title,city,country){
  const titleN=norm(title),cityN=norm(city),countryN=countryNorm(country);
  let score=0;
  if(titleN===cityN)score=98;
  else if(titleN.startsWith(`${cityN} `)||titleN.startsWith(`${cityN},`))score=91;
  else if(titleN.includes(cityN))score=68;
  if(countryN&&titleN.includes(countryN))score+=7;
  return score;
}

async function wikipediaRestSummary(title,city,country){
  if(!title||badTitle(title))return null;
  const url=`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(title).replace(/ /g,'_'))}`;
  const page=await fetchJson(url,9000);
  if(!page||page.type==='disambiguation'||page.type==='no-extract'||badTitle(page.title))return null;
  const image=page.originalimage?.source||page.thumbnail?.source;
  if(!image)return null;
  const score=titleScore(page.title,city,country);
  if(score<65)return null;
  return {url:image,title:page.title,sourceUrl:page.content_urls?.desktop?.page||sourceSearchUrl(city,country),score:score+3,source:'Wikipedia REST exact city article'};
}

async function wikipediaDirectTitles(city,country,countryOnly=false){
  const candidates=[];
  const titles=(countryOnly?[`${city}, ${country}`]:[city,`${city}, ${country}`]).filter(Boolean);
  const checks=await Promise.allSettled([...new Set(titles)].flatMap(title=>[
    wikipediaRestSummary(title,city,country),
    wikipediaPageImage(title,city,country)
  ]));
  for(const check of checks){
    if(check.status==='fulfilled'&&check.value)pushCandidate(candidates,check.value);
  }
  return candidates;
}

async function wikipediaSearchFallback(city,country){
  const query=`intitle:\"${city}\" ${country} city`;
  const url='https://en.wikipedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',origin:'*',list:'search',srnamespace:'0',srlimit:'8',srsearch:query});
  const data=await fetchJson(url,10000),rows=data?.query?.search||[],out=[];
  for(const row of rows.slice(0,5)){
    const score=titleScore(row.title,city,country);
    if(score<65)continue;
    try{const page=await wikipediaPageImage(row.title,city,country);if(page)pushCandidate(out,{...page,score:Math.max(page.score||0,score)});}catch(_){}
  }
  return out;
}

function entityScore(item,city,country,requireCountry=false){
  const label=norm(item?.label||item?.display?.label?.value),description=norm(item?.description||item?.display?.description?.value);
  const cityN=norm(city),countryN=countryNorm(country);
  let score=0;
  if(label===cityN)score+=80;
  else if(label.startsWith(cityN)||cityN.startsWith(label))score+=45;
  else if(label.includes(cityN))score+=25;
  if(/\b(city|town|municipality|capital|metropolis|urban|village|resort|island)\b/.test(description))score+=20;
  if(countryN&&description.includes(countryN))score+=25;
  if(requireCountry&&countryN&&!description.includes(countryN))return-100;
  if(/\b(disambiguation|surname|given name|album|song|film|company|football|person)\b/.test(description))score-=80;
  return score;
}

async function commonsFileInfo(filename){
  if(!filename)return null;
  const title=String(filename).startsWith('File:')?String(filename):`File:${filename}`;
  const url='https://commons.wikimedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',origin:'*',titles:title,prop:'imageinfo',iiprop:'url|mime|size|extmetadata',iiurlwidth:'1600'});
  const data=await fetchJson(url),page=Object.values(data?.query?.pages||{})[0],ii=page?.imageinfo?.[0];
  if(!ii||!photoMime(ii.mime)||Number(ii.width||0)<700||Number(ii.height||0)<420||badTitle(page?.title))return null;
  return {url:ii.thumburl||ii.url,title:page.title,width:ii.width,height:ii.height,sourceUrl:ii.descriptionurl||`https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`};
}

async function wikipediaPageImage(title,city,country){
  if(!title||badTitle(title))return null;
  const url='https://en.wikipedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',origin:'*',titles:title,redirects:'1',prop:'pageimages|info|pageprops',piprop:'original|thumbnail',pithumbsize:'1600',inprop:'url'});
  const data=await fetchJson(url),page=Object.values(data?.query?.pages||{})[0];
  if(!page||page.missing!==undefined||page.pageprops?.disambiguation!==undefined||badTitle(page.title))return null;
  const image=page.original?.source||page.thumbnail?.source;
  if(!image)return null;
  const titleN=norm(page.title),cityN=norm(city);
  const score=(titleN===cityN?95:titleN.startsWith(cityN)?78:titleN.includes(cityN)?62:35)+(countryNorm(country)&&titleN.includes(countryNorm(country))?8:0);
  return {url:image,title:page.title,sourceUrl:page.fullurl||sourceSearchUrl(city,country),score,source:'Wikipedia exact city article'};
}

async function wikidataExact(city,country,requireCountry=false){
  const searchUrl='https://www.wikidata.org/w/api.php?'+new URLSearchParams({action:'wbsearchentities',format:'json',origin:'*',language:'en',uselang:'en',type:'item',limit:'8',search:[city,country].filter(Boolean).join(' ')});
  const search=await fetchJson(searchUrl),items=(search?.search||[]).map(item=>({...item,_score:entityScore(item,city,country,requireCountry)})).filter(item=>item._score>20).sort((a,b)=>b._score-a._score).slice(0,4);
  if(!items.length)return [];
  const ids=items.map(item=>item.id).join('|');
  const entityUrl='https://www.wikidata.org/w/api.php?'+new URLSearchParams({action:'wbgetentities',format:'json',origin:'*',ids,props:'claims|sitelinks|labels|descriptions',languages:'en',sitefilter:'enwiki'});
  const data=await fetchJson(entityUrl),out=[];
  for(const item of items){
    const entity=data?.entities?.[item.id];if(!entity)continue;
    const base=item._score;
    const filename=entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if(filename){try{const info=await commonsFileInfo(filename);if(info)pushCandidate(out,{...info,score:base+45,source:'Wikidata city image'});}catch(_){}}
    const title=entity?.sitelinks?.enwiki?.title;
    if(title){try{const page=await wikipediaPageImage(title,city,country);if(page)pushCandidate(out,{...page,score:Math.max(page.score||0,base+35)});}catch(_){}}
  }
  return out;
}

async function wikipediaGeo(city,country,record){
  const lat=Number(record?.lat),lon=Number(record?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return [];
  const url='https://en.wikipedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',origin:'*',generator:'geosearch',ggsprimary:'all',ggsnamespace:'0',ggsradius:'10000',ggslimit:'15',ggscoord:`${lat}|${lon}`,prop:'pageimages|info|pageprops|coordinates',piprop:'original|thumbnail',pithumbsize:'1600',inprop:'url'});
  const data=await fetchJson(url),pages=Object.values(data?.query?.pages||{}),out=[];
  const cityN=norm(city);
  for(const page of pages){
    if(page?.pageprops?.disambiguation!==undefined||badTitle(page?.title))continue;
    const image=page?.original?.source||page?.thumbnail?.source;if(!image)continue;
    const titleN=norm(page.title);let score=30;
    if(titleN===cityN)score=92;else if(titleN.startsWith(cityN))score=75;else if(titleN.includes(cityN))score=60;
    if(score<55)continue;
    pushCandidate(out,{url:image,title:page.title,sourceUrl:page.fullurl||sourceSearchUrl(city,country),score,source:'Wikipedia coordinate-matched article'});
  }
  return out;
}

async function commonsGeo(city,country,record){
  const lat=Number(record?.lat),lon=Number(record?.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return [];
  const url='https://commons.wikimedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',origin:'*',generator:'geosearch',ggsprimary:'all',ggsnamespace:'6',ggsradius:'10000',ggslimit:'40',ggscoord:`${lat}|${lon}`,prop:'imageinfo',iiprop:'url|mime|size|extmetadata',iiurlwidth:'1600'});
  const data=await fetchJson(url),pages=Object.values(data?.query?.pages||{}),out=[];
  const cityN=norm(city);
  for(const page of pages){
    const ii=page?.imageinfo?.[0];if(!ii||badTitle(page.title)||!photoMime(ii.mime))continue;
    const width=Number(ii.width||0),height=Number(ii.height||0),ratio=height?width/height:0;
    if(width<900||height<500||ratio<1.18||ratio>2.5)continue;
    const text=norm(`${page.title} ${ii?.extmetadata?.ImageDescription?.value||''} ${ii?.extmetadata?.ObjectName?.value||''}`);
    let score=42;if(text.includes(cityN))score+=28;if(/skyline|cityscape|downtown|old town|waterfront|panorama|historic centre|historic center|aerial/.test(text))score+=12;
    pushCandidate(out,{url:ii.thumburl||ii.url,title:page.title,sourceUrl:ii.descriptionurl||`https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,score,source:'Wikimedia Commons coordinate-matched photo'});
  }
  return out;
}

async function resolve(city,country,fallback){
  const cityKey=key(city,country),cacheKey=CACHE_PREFIX+cityKey;
  const cached=safeGet(cacheKey);
  if(cached?.images?.length&&cached.confidence!=='neutral-fallback')return cached;
  for(const prefix of LEGACY_CACHE_PREFIXES){
    const legacy=safeGet(prefix+cityKey);
    if(legacy?.images?.length&&legacy.confidence!=='neutral-fallback'){
      const migrated={...legacy,version:VERSION,migratedFrom:prefix};
      safeSet(cacheKey,migrated);
      return migrated;
    }
  }
  const local=LOCAL[key(city,country)]||LOCAL[norm(city)]||'';
  if(local){
    const result={version:VERSION,images:[local],sourceUrl:'',sourceLabel:'Globevoy verified local city image',confidence:'verified-local'};
    safeSet(cacheKey,result);return result;
  }
  const registry=await loadRegistry(),record=registry.byKey.get(key(city,country))||null,active=record?.active===true,ambiguous=registry.ambiguousCities.has(norm(city));
  if(isOffline())return {version:VERSION,images:[generatedCitySvg(city,country)],sourceUrl:'',sourceLabel:'Globevoy neutral city artwork',confidence:'neutral-fallback',active};
  const candidates=[];
  if(ambiguous){
    try{(await wikipediaGeo(city,country,record)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Wikipedia coordinate image unavailable',city,e);}
    try{(await commonsGeo(city,country,record)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Commons coordinate image unavailable',city,e);}
    if(!candidates.some(c=>(c.score||0)>=85)){
      try{(await wikipediaDirectTitles(city,country,true)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Wikipedia country-qualified city image unavailable',city,e);}
    }
    if(!candidates.some(c=>(c.score||0)>=82)){
      try{(await wikidataExact(city,country,true)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Wikidata country-qualified city image unavailable',city,e);}
    }
  }else{
    try{(await wikipediaDirectTitles(city,country)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Wikipedia direct city image unavailable',city,e);}
    if(!candidates.some(c=>(c.score||0)>=85)){
      try{(await wikidataExact(city,country)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Wikidata city image unavailable',city,e);}
    }
    if(!candidates.some(c=>(c.score||0)>=82)){
      try{(await wikipediaSearchFallback(city,country)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Wikipedia city search unavailable',city,e);}
    }
    if(!candidates.some(c=>(c.score||0)>=80)){
      try{(await wikipediaGeo(city,country,record)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Wikipedia coordinate image unavailable',city,e);}
    }
    if(!candidates.some(c=>(c.score||0)>=75)){
      try{(await commonsGeo(city,country,record)).forEach(c=>pushCandidate(candidates,c));}catch(e){console.warn('Commons coordinate image unavailable',city,e);}
    }
  }
  if(isTrustedFallback(fallback))pushCandidate(candidates,{url:fallback,score:50,source:'Trusted existing city image',sourceUrl:''});
  const best=bestCandidate(candidates);
  if(best&&Number(best.score||0)>=55){
    const images=candidates.slice().sort((a,b)=>(b.score||0)-(a.score||0)).map(c=>c.url).filter(Boolean).slice(0,5);
    const result={version:VERSION,images,sourceUrl:best.sourceUrl||sourceSearchUrl(city,country),sourceLabel:best.source||'Wikipedia / Wikimedia Commons',confidence:Number(best.score||0)>=80?'high':'coordinate-matched',cityId:record?.cityId||'',registryMatched:!!record,active};
    safeSet(cacheKey,result);return result;
  }
  const unresolved={version:VERSION,images:[generatedCitySvg(city,country)],sourceUrl:sourceSearchUrl(city,country),sourceLabel:'Photo unresolved — Globevoy is showing neutral artwork, not a verified city photograph',confidence:'neutral-fallback',cityId:record?.cityId||'',registryMatched:!!record,active};
  if(!active)safeSet(cacheKey,unresolved);
  return unresolved;
}

async function get(city,country,fallback){
  const k=key(city,country);if(!mem.has(k))mem.set(k,resolve(city,country,fallback));return mem.get(k);
}


const GALLERY_PREFIX='gv-licensed-city-gallery-v1:';
const GALLERY_SKIP=/\b(flags?|coat|arms|logos?|maps?|locator|seal|emblem|icons?|symbols?|charts?|graphs?|climate|diagram|signature|banner|population|wiki\w*|commons|location|outline|plans?|muse(um|u|o)s?|collections?|paintings?|engraving|lithograph|illustration|drawing|portrait|statue|bust|reconstruction|review|sir|1[0-8]\d\d|19[0-4]\d|w|metro|subway|trains?|trams?|bus(es)?|airport|station|stadium|arena|game|university|hospital|school|campus|protest|parade|festival|concert|election|president|mayor)\b/i;
const galleryMem=new Map();
function licensedFile(info,title){
  const ext=info?.extmetadata||{};
  const licence=String(ext.LicenseShortName?.value||'');
  if(!/^(CC BY(?:-SA)? [1-4]\.\d|CC0(?: 1\.0)?|Public domain)$/i.test(licence))return null;
  if(/\b(non.?commercial|no derivatives|permission required)\b/i.test(String(ext.Restrictions?.value||'')))return null;
  const url=info.thumburl||info.url, source=info.descriptionurl;
  if(!/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//i.test(url||'')||!/^https:\/\/commons\.wikimedia\.org\//i.test(source||''))return null;
  const template=document.createElement('template');
  template.innerHTML=String(ext.Artist?.value||'');
  const author=template.content.textContent.trim().slice(0,160);
  if(/^CC BY/i.test(licence)&&!author)return null;
  const licenceUrl=String(ext.LicenseUrl?.value||'').replace(/^http:/,'https:');
  return {url,title,sourceUrl:source,author,licence,licenceUrl:/^https:\/\/creativecommons\.org\//i.test(licenceUrl)?licenceUrl:''};
}
async function licensedGallery(city,country){
  if(isOffline()||!norm(city))return [];
  const {byKey,ambiguousCities}=await loadRegistry();
  const record=byKey.get(key(city,country));
  const cityTitle=record?.city||city, countryTitle=record?.country||country;
  const ambiguous=ambiguousCities.has(norm(cityTitle));
  const api=(host,params)=>fetchJson('https://'+host+'/w/api.php?'+new URLSearchParams({format:'json',origin:'*',formatversion:'2',...params}),4500);
  const qualified=countryTitle?`${cityTitle}, ${countryTitle}`:null;
  for(const title of [...new Set([qualified,!ambiguous?cityTitle:null].filter(Boolean))]){
    try{
      const result=await api('en.wikipedia.org',{action:'parse',page:title,prop:'images',redirects:'1'});
      const page=result?.parse;
      if(!page?.images?.length||!/^[^:]+$/.test(page.title)||/disambiguation/i.test(page.title))continue;
      if(ambiguous ? norm(page.title)!==norm(qualified) : titleScore(page.title,cityTitle,countryTitle)<90)continue;
      const files=page.images.filter(f=>/\.(jpe?g|png|webp)$/i.test(f)&&!GALLERY_SKIP.test(f.replace(/[_-]+/g,' ').replace(/\.\w+$/,''))).slice(0,24);
      if(!files.length)continue;
      const info=await api('commons.wikimedia.org',{action:'query',titles:files.map(x=>'File:'+x).join('|'),prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'1280'});
      const byName=new Map((info?.query?.pages||[]).map(p=>[String(p.title).replace(/^File:/,'').replace(/_/g,' '),p.imageinfo?.[0]]));
      const photos=files.map(f=>{
        const file=byName.get(f.replace(/_/g,' '));
        const ratio=file?.width/file?.height;
        return file?.width>=700&&ratio>=1.15&&ratio<=2.7&&photoMime(file.mime)?licensedFile(file,f.replace(/_/g,' ')):null;
      }).filter(Boolean).slice(0,4);
      if(photos.length)return photos;
    }catch(_){ /* try the next unambiguous article */ }
  }
  if(!Number.isFinite(record?.lat)||!Number.isFinite(record?.lon))return [];
  try{
    const info=await api('commons.wikimedia.org',{action:'query',generator:'geosearch',ggsprimary:'all',ggsnamespace:'6',ggsradius:'5000',ggslimit:'30',
      ggscoord:`${record.lat}|${record.lon}`,prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'1280'});
    return (info?.query?.pages||[]).map(p=>{
      const file=p.imageinfo?.[0],ratio=file?.width/file?.height;
      const locality=norm(p.title+' '+(file?.extmetadata?.ImageDescription?.value||''));
      return !badTitle(p.title)&&locality.includes(norm(cityTitle))&&file?.width>=700&&ratio>=1.15&&ratio<=2.7&&photoMime(file.mime)?licensedFile(file,p.title):null;
    }).filter(Boolean).slice(0,4);
  }catch(_){return [];}
}
function gallery(city,country){
  const k=GALLERY_PREFIX+key(city,country);
  if(!galleryMem.has(k))galleryMem.set(k,(async()=>{
    const cached=safeGet(k);
    if(cached?.images?.length)return cached.images;
    const images=await licensedGallery(city,country);
    if(images.length)safeSet(k,{images});
    return images;
  })());
  return galleryMem.get(k);
}
async function photos(city,country){
  const local=LOCAL[key(city,country)]||(!country?LOCAL[norm(city)]:'');
  if(local)return [{url:local}];
  return gallery(city,country);
}
function setCredit(target,photo){
  if(!target)return;
  target.querySelector(':scope > .gv-photo-credit')?.remove();
  if(!photo?.sourceUrl)return;
  const credit=document.createElement('span');
  credit.className='gv-photo-credit';
  Object.assign(credit.style,{position:'absolute',top:'4px',right:'4px',maxWidth:'70%',zIndex:'4',padding:'2px 5px',borderRadius:'3px',background:'#10283cd9',color:'white',fontSize:'10px'});
  const link=(text,url)=>{const a=document.createElement('a');a.textContent=text;a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.style.color='inherit';return a;};
  credit.append(link(photo.author||'Photo credit',photo.sourceUrl));
  if(photo.licence)credit.append(' · ',photo.licenceUrl?link(photo.licence,photo.licenceUrl):photo.licence);
  target.append(credit);
}

window.GlobevoyCityImages={version:VERSION,get,photos,gallery,setCredit,registry:loadRegistry};
})();
