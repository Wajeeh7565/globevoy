(function(){
'use strict';
const VERSION='GV-BOOK-673B';
const COUNTRY_ALIASES={
  'united states of america':'united-states','usa':'united-states','us':'united-states','united states':'united-states',
  'united kingdom':'united-kingdom','uk':'united-kingdom','uae':'united-arab-emirates','united arab emirates':'united-arab-emirates',
  'turkiye':'turkey','türkiye':'turkey','czech republic':'czechia','south korea':'south-korea'
};
function ascii(v){return String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'');}
function slug(v){return ascii(v).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-+/g,'-');}
function countrySlug(v){const raw=ascii(v).toLowerCase().trim();return COUNTRY_ALIASES[raw]||slug(raw);}
function place(city,country){const c=slug(city),ct=countrySlug(country);return c&&ct?`${c}-${ct}`:c;}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''));}
function buildFromSegments(segments){
  const list=Array.isArray(segments)?segments:[];
  if(list.length<2)return {ok:false,reason:'At least two flight legs are required for a complete multi-city search.',url:'',path:''};
  const parts=[];
  for(let i=0;i<list.length;i++){
    const segment=list[i]||{},from=place(segment.fromCity,segment.fromCountry),to=place(segment.toCity,segment.toCountry),date=String(segment.date||'');
    if(!from||!to)return {ok:false,reason:`Leg ${i+1} is missing a city or country.`,url:'',path:''};
    if(!validDate(date))return {ok:false,reason:`Leg ${i+1} is missing an exact departure date.`,url:'',path:''};
    parts.push(`${from}~${to}~${date}`);
  }
  const path=parts.join('/');
  return {ok:true,reason:'',path,url:`https://www.kiwi.com/deep?multicity=${path}`,provider:'Kiwi.com',version:VERSION};
}
window.GlobevoyKiwiMulticity={version:VERSION,slug,place,buildFromSegments};
})();
