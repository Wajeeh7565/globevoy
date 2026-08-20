(function(){
'use strict';
const mem=new Map();
const LOCAL={
  'mexico city|mexico':'./assets/images/mexico-city.jpg',
  'montreal|canada':'./assets/images/montreal.jpg',
  'new york|united states':'./assets/images/new-york-city.jpg',
  'new york city|united states':'./assets/images/new-york-city.jpg',
  'toronto|canada':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Toronto%20Skyline%20from%20CN%20Tower%2C%20Toronto%2C%20Ontario%20%2821219067113%29.jpg',
  'quebec city|canada':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Qu%C3%A9bec%20City%20skyline%20%28Quintin%20Soloviev%29.jpg',
  'québec city|canada':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Qu%C3%A9bec%20City%20skyline%20%28Quintin%20Soloviev%29.jpg',
  'washington, d.c.|united states':'https://source.unsplash.com/featured/1200x720/?washington%20dc%20capitol%20skyline',
  'washington dc|united states':'https://source.unsplash.com/featured/1200x720/?washington%20dc%20capitol%20skyline',
  'detroit|united states':'https://source.unsplash.com/featured/1200x720/?detroit%20skyline',
  'ottawa|canada':'https://source.unsplash.com/featured/1200x720/?ottawa%20parliament%20skyline',
  'belfast|united kingdom':'https://source.unsplash.com/featured/1200x720/?belfast%20city%20skyline',
  'bodrum|turkey':'https://source.unsplash.com/featured/1200x720/?bodrum%20turkey%20castle%20coast',
  'cancun|mexico':'https://source.unsplash.com/featured/1200x720/?cancun,mexico,beach',
  'san jose|costa rica':'https://source.unsplash.com/featured/1200x720/?san%20jose,costa%20rica,city',
  'panama city|panama':'https://source.unsplash.com/featured/1200x720/?panama%20city,panama,skyline',
  'cartagena|colombia':'https://source.unsplash.com/featured/1200x720/?cartagena,colombia,old%20town',
  'guatemala city|guatemala':'https://source.unsplash.com/featured/1200x720/?guatemala%20city,guatemala',
  'caye caulker|belize':'https://source.unsplash.com/featured/1200x720/?caye%20caulker,belize,island',
  'campeche|mexico':'https://source.unsplash.com/featured/1200x720/?campeche,mexico,colonial',
  'london|united kingdom':'https://source.unsplash.com/featured/1200x720/?london,skyline',
  'cairo|egypt':'https://source.unsplash.com/featured/1200x720/?cairo,egypt,pyramids',
  'batumi|georgia':'https://source.unsplash.com/featured/1200x720/?batumi,georgia,black%20sea',
  'tehran|iran':'https://source.unsplash.com/featured/1200x720/?tehran,iran,city',
  'muscat|oman':'https://source.unsplash.com/featured/1200x720/?muscat,oman,waterfront',
  'doha|qatar':'https://source.unsplash.com/featured/1200x720/?doha,qatar,skyline',
  'san diego|united states':'https://source.unsplash.com/featured/1200x720/?san%20diego,california,coast',
  'las vegas|united states':'https://source.unsplash.com/featured/1200x720/?las%20vegas,strip',
  'victoria|canada':'https://source.unsplash.com/featured/1200x720/?victoria,bc,harbour',
  'vancouver|canada':'https://source.unsplash.com/featured/1200x720/?vancouver,canada,skyline',
  'seattle|united states':'https://source.unsplash.com/featured/1200x720/?seattle,skyline',
  'tofino|canada':'https://source.unsplash.com/featured/1200x720/?tofino,canada,coast',
  'portland (maine)|united states':'https://source.unsplash.com/featured/1200x720/?portland,maine,waterfront',
  'portland|united states':'https://source.unsplash.com/featured/1200x720/?portland,oregon,skyline',
  'boston|united states':'https://source.unsplash.com/featured/1200x720/?boston,skyline'
};
function key(city,country){return `${city}|${country}`.toLowerCase()}
const CACHE_TTL=7*24*60*60*1000;
function safeGet(k){try{const v=JSON.parse(localStorage.getItem(k)||'null');if(!v)return null;if(v.cachedAt&&Date.now()-v.cachedAt>CACHE_TTL)return null;return v}catch(_){return null}}
function safeSet(k,v){try{localStorage.setItem(k,JSON.stringify({...v,cachedAt:Date.now()}))}catch(_){}}
function sourceUrl(city,country){const title=[city,country].filter(Boolean).join(', ');return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(title)}`}
function normalizeUrl(v){if(!v)return'';return v.startsWith('//')?'https:'+v:v}
function genericFallback(v){return !v||/photo-1533104816931|photo-1507525428034|photo-1504674900247|photo-1500530855697|photo-1441974231531/i.test(v)}
function discoveryImage(city,country){try{const list=Array.isArray(window.GLOBEVOY_PUBLIC_DISCOVERY_500)?window.GLOBEVOY_PUBLIC_DISCOVERY_500:[];const lc=String(city||'').toLowerCase(),cc=String(country||'').toLowerCase();const found=list.find((item)=>String(item.city||'').toLowerCase()===lc&&(!cc||String(item.country||'').toLowerCase()===cc));return found&&(found.img||found.image||found.heroImage||'')||'';}catch(_){return ''}}

function hashHue(city,country){const text=`${city}|${country}`;let h=0;for(let i=0;i<text.length;i++)h=(h*31+text.charCodeAt(i))%360;return h;}
function svgEscape(v){return String(v||'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));}
function generatedCitySvg(city,country){
  const hue=hashHue(city,country),h2=(hue+38)%360,h3=(hue+180)%360;
  const safeCity=svgEscape(city||'Destination'),safeCountry=svgEscape(country||'');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" role="img" aria-label="${safeCity} travel image"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},62%,44%)"/><stop offset=".55" stop-color="hsl(${h2},62%,34%)"/><stop offset="1" stop-color="hsl(${h3},48%,26%)"/></linearGradient><linearGradient id="m" x1="0" x2="0" y1="0" y2="1"><stop stop-color="rgba(255,255,255,.52)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></linearGradient></defs><rect width="1200" height="720" fill="url(#g)"/><circle cx="980" cy="120" r="150" fill="rgba(255,255,255,.18)"/><path d="M0 500 C160 390 280 420 420 350 C590 260 720 310 880 230 C1010 160 1110 190 1200 130 L1200 720 L0 720 Z" fill="rgba(255,255,255,.22)"/><path d="M0 555 C180 490 320 525 480 455 C660 375 820 440 1000 360 C1100 318 1160 315 1200 302 L1200 720 L0 720 Z" fill="rgba(4,18,34,.28)"/><g fill="rgba(255,255,255,.82)"><rect x="120" y="350" width="48" height="190" rx="8"/><rect x="188" y="295" width="72" height="245" rx="10"/><rect x="282" y="380" width="55" height="160" rx="8"/><rect x="362" y="330" width="88" height="210" rx="10"/><rect x="470" y="405" width="58" height="135" rx="8"/></g><rect y="0" width="1200" height="720" fill="url(#m)" opacity=".28"/><text x="72" y="105" fill="white" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="64" letter-spacing="-2">${safeCity}</text><text x="76" y="154" fill="rgba(255,255,255,.78)" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="28" letter-spacing="4">${safeCountry}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function badTitle(v){return /\b(flag|coat of arms|locator|location map|seal|logo|icon|symbol|map of|blank map|district map|route map|administrative divisions|wikivoyage banner)\b/i.test(String(v||''))}
async function fetchJson(url,timeout=9000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{Accept:'application/json'},signal:c.signal,mode:'cors',credentials:'omit'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}finally{clearTimeout(t)}}
function pushUnique(list,url){url=normalizeUrl(url);if(url&&!list.includes(url))list.push(url)}
async function wikipediaLead(city,country){
  const search=`${city} ${country}`.trim();
  const u='https://en.wikipedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:search,gsrnamespace:'0',gsrlimit:'4',redirects:'1',prop:'pageimages|info',piprop:'original|thumbnail',pithumbsize:'1400',inprop:'url'});
  const d=await fetchJson(u),pages=Object.values(d?.query?.pages||{});
  pages.sort((a,b)=>{const ac=String(a.title||'').toLowerCase().includes(String(city).toLowerCase())?0:1,bc=String(b.title||'').toLowerCase().includes(String(city).toLowerCase())?0:1;return ac-bc});
  const out=[];for(const p of pages){if(badTitle(p.title))continue;pushUnique(out,p.original?.source||p.thumbnail?.source);if(out.length>=2)break}return out;
}
async function commonsGallery(city,country){
  const terms=`${city} ${country} city landmark travel`;
  const u='https://commons.wikimedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:terms,gsrnamespace:'6',gsrlimit:'18',prop:'imageinfo',iiprop:'url|mime|size|extmetadata',iiurlwidth:'1400'});
  const d=await fetchJson(u),pages=Object.values(d?.query?.pages||{}),out=[];
  for(const p of pages){const ii=p.imageinfo?.[0];if(!ii||badTitle(p.title))continue;const mime=String(ii.mime||'');if(!/^image\/(jpeg|png|webp)$/i.test(mime))continue;if(Number(ii.width||0)<700||Number(ii.height||0)<420)continue;pushUnique(out,ii.thumburl||ii.url);if(out.length>=5)break}return out;
}
async function request(city,country,fallback){
  const k=key(city,country),cacheKey='gv-city-images-v4:'+k,cached=safeGet(cacheKey);if(cached?.images?.length)return cached;
  const images=[];const local=LOCAL[k]||'';const dataImg=discoveryImage(city,country);if(local&&!/source\.unsplash\.com/i.test(local))pushUnique(images,local);
  if(new URLSearchParams(location.search).get('offline')!=='1'){
    try{(await wikipediaLead(city,country)).forEach(x=>pushUnique(images,x))}catch(e){console.warn('Wikipedia lead image unavailable',city,e)}
    if(images.length<5)try{(await commonsGallery(city,country)).forEach(x=>pushUnique(images,x))}catch(e){console.warn('Wikimedia gallery unavailable',city,e)}
  }
  if(dataImg)pushUnique(images,dataImg);
  if(fallback)pushUnique(images,fallback);
  if(local&&/source\.unsplash\.com/i.test(local))pushUnique(images,local);
  if(!images.length)pushUnique(images,generatedCitySvg(city,country));
  const result={images:images.slice(0,5),sourceUrl:sourceUrl(city,country),sourceLabel:images[0]&&images[0].startsWith('data:image/svg+xml')?'Generated Globevoy city artwork':'Wikipedia / Wikimedia Commons — review attribution before production'};
  if(result.images.length)safeSet(cacheKey,result);return result;
}
async function get(city,country,fallback){const k=key(city,country);if(!mem.has(k))mem.set(k,request(city,country,fallback));return mem.get(k)}
window.GlobevoyCityImages={get};
})();
