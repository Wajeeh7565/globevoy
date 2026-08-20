(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.GlobevoyDiscovery500=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const BLOCKED_PUBLIC_KEYS=new Set(['productionStatus','candidateStatus','publicLive','internalProductionStatus','classificationConfidence','reviewStatus','humanReviewRequired','confidence','providerCoverageStatus','qualityReview','fieldGovernance','notes','sourceReferences','assessmentEvidence','limitations','classificationMethod','sourceEvidence','publicEligibility']);
  function normalized(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  function safeRecord(record){
    if(!record||typeof record!=='object') return null;
    for(const key of BLOCKED_PUBLIC_KEYS) if(Object.prototype.hasOwnProperty.call(record,key)) return null;
    const required=['cityId','city','country','region','theme'];
    if(required.some(key=>!String(record[key]||'').trim())) return null;
    return record;
  }
  function searchRecords(records,query='',region='all'){
    const q=normalized(query);
    return (records||[]).filter(safeRecord).filter(r=>region==='all'||r.sourceRegion===region||r.region===region).filter(r=>{
      if(!q)return true;
      return normalized([r.city,r.country,r.region,r.sourceRegion,(r.themes||[]).join(' '),r.discoveryRole].join(' ')).includes(q);
    });
  }
  function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function renderCard(record){
    const safe=safeRecord(record);
    if(!safe)return '';
    const flight=safe.providerAvailability&&safe.providerAvailability.flight;
    const hotel=safe.providerAvailability&&safe.providerAvailability.hotel;
    return `<article class="gv-discovery-card" data-city-id="${escapeHtml(safe.cityId)}"><img src="${escapeHtml(safe.img)}" alt="${escapeHtml(safe.city)}, ${escapeHtml(safe.country)}" loading="lazy"><div class="gv-discovery-card-body"><span class="gv-discovery-role">${escapeHtml(safe.discoveryRole)}</span><h3>${escapeHtml(safe.city)}</h3><p class="gv-discovery-country">${escapeHtml(safe.country)} - ${escapeHtml(safe.sourceRegion||safe.region)}</p><p>${escapeHtml((safe.themes||[]).join(' - '))} - ${escapeHtml(safe.days)}</p><div class="gv-provider-states" aria-label="Booking availability"><span class="${flight?'is-available':'is-unavailable'}">${flight?'Flight search available':'Flight search unavailable'}</span><span class="${hotel?'is-available':'is-unavailable'}">${hotel?'Hotel search available':'Hotel search unavailable'}</span></div></div></article>`;
  }
  function mountWhenEnabled(){
    return false;
  }
  return {normalized,safeRecord,searchRecords,renderCard,mountWhenEnabled,BLOCKED_PUBLIC_KEYS:[...BLOCKED_PUBLIC_KEYS]};
});
