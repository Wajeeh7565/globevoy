const fs=require('fs'),zlib=require('zlib');
process.env.FARE_MAP_CITY_EXPANSION='on';
const opt=require('/home/claude/globevoy/backend/services/domain/fare-map/fare-map-optimizer.js')._internal;
const ce=require('/home/claude/globevoy/backend/services/domain/fare-map/city-expansion.js');
const snap=JSON.parse(zlib.gunzipSync(fs.readFileSync('/home/claude/gvdata/fare-snapshot-full.json.gz')));
const priced=new Set(Object.keys(JSON.parse(fs.readFileSync('/home/claude/gvdata/hotel-prices.json','utf8')).ratios));
const pilot=JSON.parse(zlib.gunzipSync(fs.readFileSync('/home/claude/gvdata/nuitee-pilot.json.gz'))).cities;const tried=new Set(pilot.map(c=>c.cityId));
// candidates: registry eligible + city expansion + discovered cities passing the good-hotel check
const base=opt.rows(),review=ce.reviewExpansion(undefined,{includeLegacyRecovery:true});
const cand=new Map();
for(const r of base){if(opt.eligible(r)||ce.admit(r,review))cand.set(r.unifiedRegistry.cityId,r);}
for(const r of opt.dynamicRows(base))if((opt.cityAccommodation(r)?.good3to4Stars||0)>=5)cand.set(r.unifiedRegistry.cityId,r);
// inbound connectivity and affordability from the worldwide fare map (all origins)
const inbound=new Map();for(const v of Object.values(snap.partitions))for(const f of v){const x=inbound.get(f.destination)||{o:new Set(),p:[]};x.o.add(f.origin);x.p.push(f.priceUsd);inbound.set(f.destination,x);}
// candidate frequency in the latest benchmark runs (pools and shown trips, all origins and budgets)
const freq=new Map();for(const f of ['q-r-t92','q-r-after-real','q-r-after-mem','q-r-before','q-tad-long']){try{const j=require('/home/claude/gvdata/'+f+'.json');for(const c of j.cases)for(const t of [...c.guest,...c.member,...Object.values(c.roles||{}).filter(Boolean)])for(const id of t.cities)freq.set(id,(freq.get(id)||0)+1);}catch{}}
const CARIB=new Set('AG AI AW BB BL BM BQ BS CU CW DM DO GD GP HT JM KN KY LC MF MQ MS PR SX TC TT VC VG VI'.split(' '));
const MIDEAST=new Set('AE BH IL IQ IR JO KW LB OM PS QA SA SY YE'.split(' '));
const region=r=>{const cc=String(r.unifiedRegistry.countryCode).toUpperCase();if(CARIB.has(cc))return 'Caribbean';if(MIDEAST.has(cc))return 'Middle East';const f=opt.regionFamily(r);return {europe:'Europe',asia:'Asia','north-america':'North America','latin-america':'Latin America',africa:'Africa',oceania:'Oceania'}[f]||'Other';};
const codeCountry=new Map();for(const c of require('/home/claude/globevoy/backend/data/global-destination-catalogue.json').destinations){codeCountry.set(String(c.cityCode).toUpperCase(),c.countryCode);for(const a of c.flightableAirportCodes||[])codeCountry.set(String(a).toUpperCase(),c.countryCode);}
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
const rows=[];
for(const [id,r] of cand){const code=opt.code(r),inb=inbound.get(code),acc=opt.cityAccommodation(r)||{};
 rows.push({id,name:r.unifiedRegistry.displayName,cc:String(r.unifiedRegistry.countryCode).toUpperCase(),region:region(r),discovered:opt.isDynamic(r),
  origins:inb?inb.o.size:0,foreignOrigins:inb?[...inb.o].filter(o=>codeCountry.get(o)&&codeCountry.get(o)!==String(r.unifiedRegistry.countryCode).toUpperCase()).length:0,domesticShare:inb&&inb.o.size?1-[...inb.o].filter(o=>codeCountry.get(o)&&codeCountry.get(o)!==String(r.unifiedRegistry.countryCode).toUpperCase()).length/inb.o.size:1,fare:inb?Math.round(med(inb.p)):null,freq:freq.get(id)||0,good:acc.good3to4Stars||0,rating:acc.medianRating||null,props:acc.properties||0,reviews:acc.reviews||0,priced:priced.has(id),tried:tried.has(id)});}
const shownIds=new Set([...freq.keys()]);
const R={candidates:rows.length,priced:rows.filter(x=>x.priced).length,shownInBenchmark:rows.filter(x=>shownIds.has(x.id)).length,shownUnpriced:rows.filter(x=>shownIds.has(x.id)&&!x.priced).length};
// shown-weighted coverage: share of benchmark city appearances that have a real price
const totalApp=[...freq.values()].reduce((a,b)=>a+b,0),pricedApp=[...freq].filter(([id])=>priced.has(id)).reduce((a,[,n])=>a+n,0);
R.appearancesPriced=Math.round(100*pricedApp/totalApp)+'%';
// score unpriced, untried candidates (no list of places: all inputs are data)
const pool=rows.filter(x=>!x.priced&&!x.tried&&x.origins>0&&x.good>=3);
const rank=(arr,k)=>{const s=arr.map(x=>x[k]??0).sort((a,b)=>a-b);return x=>s.length>1?s.findIndex(v=>v>=(x[k]??0))/(s.length-1):.5;};
const rO=rank(pool,'foreignOrigins'),rF=rank(pool,'freq'),rG=rank(pool,'good'),rR=rank(pool,'rating'),rV=rank(pool,'reviews'),rFare=rank(pool,'fare');
for(const x of pool){
 x.cat=[];const aff=1-rFare(x),pop=rV(x),gem=rR(x)*(1-rV(x))*Math.min(1,x.good/10),prem=rR(x)*rG(x);
 if(aff>.7&&x.good>=5)x.cat.push('affordable');if(pop>.8)x.cat.push('popular');if(gem>.35)x.cat.push('hidden-gem');if(prem>.7)x.cat.push('premium');
 x.score=-(x.domesticShare>.8?.3:0)+.25*rO(x)+.25*rF(x)+.15*rG(x)+.1*rR(x)+.1*aff+.1*Math.max(pop,gem,prem)+(x.discovered?.05:0);}
const regions=['Europe','Asia','North America','Latin America','Caribbean','Africa','Middle East','Oceania'];
const avail=Object.fromEntries(regions.map(g=>[g,pool.filter(x=>x.region===g).length]));
// region quotas: floor per region, rest by available share; capped by availability
const FLOOR={Europe:45,Asia:50,'North America':30,'Latin America':40,Caribbean:25,Africa:35,'Middle East':25,Oceania:15};
const quota={};let left=300;for(const g of regions){quota[g]=Math.min(FLOOR[g],avail[g]);left-=quota[g];}
const spare=regions.map(g=>[g,avail[g]-quota[g]]).filter(([,n])=>n>0),tot=spare.reduce((a,[,n])=>a+n,0);
for(const [g,n] of spare){const add=Math.min(n,Math.round(left*n/tot));quota[g]+=add;}
let sel=[];for(const g of regions){
 const list=pool.filter(x=>x.region===g).sort((a,b)=>b.score-a.score);
 // inside a region, keep a mix: at least a few of each category when available, then by score; at most 6 per country
 const out=[],per={};const take=x=>{if(out.includes(x)||out.length>=quota[g]||(per[x.cc]||0)>=Math.max(6,Math.ceil(quota[g]*.22)))return;out.push(x);per[x.cc]=(per[x.cc]||0)+1;};
 for(const c of ['affordable','popular','hidden-gem','premium'])list.filter(x=>x.cat.includes(c)).slice(0,Math.ceil(quota[g]/8)).forEach(take);
 list.forEach(take);sel.push(...out);}
if(sel.length<300){const ids=new Set(sel.map(x=>x.id)),cnt={};sel.forEach(x=>cnt[x.cc]=(cnt[x.cc]||0)+1);for(const x of pool.slice().sort((a,b)=>b.score-a.score)){if(sel.length>=300)break;if(ids.has(x.id)||(cnt[x.cc]||0)>=8||x.good<15||x.origins<25)continue;sel.push(x);ids.add(x.id);cnt[x.cc]=(cnt[x.cc]||0)+1;}}
sel=sel.slice(0,300);
const by=k=>sel.reduce((m,x)=>{for(const v of [].concat(x[k]))m[v]=(m[v]||0)+1;return m;},{});
const all500=[...rows.filter(x=>x.priced),...sel],reg500=all500.reduce((m,x)=>(m[x.region]=(m[x.region]||0)+1,m),{});
const selIds=new Set(sel.map(x=>x.id)),appAfter=[...freq].filter(([id])=>priced.has(id)||selIds.has(id)).reduce((a,[,n])=>a+n,0);
const shownAfter=rows.filter(x=>shownIds.has(x.id)&&!x.priced&&!selIds.has(x.id)).length;
console.log(JSON.stringify({...R,unpricedPool:pool.length,availableByRegion:avail,selected:sel.length,selectedByRegion:by('region'),selectedCategories:by('cat'),discoveredSelected:sel.filter(x=>x.discovered).length,countries:new Set(sel.map(x=>x.cc)).size,
 regionsAfter500:reg500,appearancesPricedAfter:Math.round(100*appAfter/totalApp)+'%',shownStillUnpricedAfter:shownAfter},null,0));
fs.writeFileSync('/home/claude/gvdata/selected-300.json',JSON.stringify(sel));
for(const g of regions)console.log(g.padEnd(14),sel.filter(x=>x.region===g).map(x=>x.name+(x.discovered?'*':'')).join(', '));
