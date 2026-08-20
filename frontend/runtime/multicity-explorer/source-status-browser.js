(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.GlobevoyMulticitySourceStatus=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const POLICIES=Object.freeze({
    'live-exact': Object.freeze({label:'Checked recently — prices can change.',confidence:'high',isLive:true,isBookable:false,exactValidationRequired:false,isCurrentAvailabilityProven:true,planningBufferRate:0.05,limitations:['Current provider result; price and availability can still change.']}),
    'recently-cached': Object.freeze({label:'Recently observed price — not live availability.',confidence:'high',isLive:false,isBookable:false,exactValidationRequired:true,isCurrentAvailabilityProven:false,planningBufferRate:0.10,limitations:['Recent cached observation; it does not prove current availability or bookability.']}),
    cached: Object.freeze({label:'Cached price observation — recheck before booking.',confidence:'medium',isLive:false,isBookable:false,exactValidationRequired:true,isCurrentAvailabilityProven:false,planningBufferRate:0.20,limitations:['Cached observation; age should be shown and current availability is not proven.']}),
    replay: Object.freeze({label:'Based on previous price observations — not current pricing.',confidence:'medium',isLive:false,isBookable:false,exactValidationRequired:true,isCurrentAvailabilityProven:false,planningBufferRate:0.20,limitations:['Sanitized deterministic replay; not current availability or a bookable fare.']}),
    estimated: Object.freeze({label:'Estimated flight range — not live availability.',confidence:'low',isLive:false,isBookable:false,exactValidationRequired:true,isCurrentAvailabilityProven:false,planningBufferRate:0.30,limitations:['Modelled planning estimate; not directly observed for the complete itinerary.']}),
    unavailable: Object.freeze({label:'Flight-price data unavailable for this window.',confidence:'low',isLive:false,isBookable:false,exactValidationRequired:true,isCurrentAvailabilityProven:false,planningBufferRate:null,limitations:['No usable provider observation is available for this window.']})
  });
  function policy(mode){ return POLICIES[mode]||POLICIES.unavailable; }
  function round2(v){ return Math.round((Number(v)+Number.EPSILON)*100)/100; }
  function applyBuffer(amount,mode){ const r=policy(mode).planningBufferRate; return r===null||!Number.isFinite(Number(amount))?null:round2(Number(amount)*(1+r)); }
  return {POLICIES,policy,applyBuffer,round2};
});
