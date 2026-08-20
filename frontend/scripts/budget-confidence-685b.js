(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GV_TRUST_685B_BUDGET_CONFIDENCE=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='GV-TRUST-685B';
  function n(value){const x=Number(value);return Number.isFinite(x)?x:0;}
  function evaluate(input){
    const data=input||{};
    const live=data.live||{};
    const over=data.over===true;
    const criticalCount=Math.max(0,n(live.criticalCount));
    const verifiedCount=Math.min(criticalCount,Math.max(0,n(live.verifiedCount)));
    const allCriticalVerified=criticalCount>0&&(live.allCriticalVerified===true||verifiedCount>=criticalCount);
    const providerBackedFit=!over&&live.budgetClaim==='provider-backed-fit'&&allCriticalVerified;
    const coverage=criticalCount>0?verifiedCount/criticalCount:0;
    if(over){
      return {version:VERSION,level:'over-budget',label:'Over budget',providerBackedFit:false,criticalCount,verifiedCount,coverage};
    }
    if(providerBackedFit){
      return {version:VERSION,level:'provider-backed-fit',label:'Provider-backed fit',providerBackedFit:true,criticalCount,verifiedCount,coverage:1};
    }
    if(criticalCount>0&&verifiedCount>0){
      return {version:VERSION,level:'partial-evidence',label:'Planning estimate — verify price',providerBackedFit:false,criticalCount,verifiedCount,coverage};
    }
    return {version:VERSION,level:'verification-required',label:'Price verification required',providerBackedFit:false,criticalCount,verifiedCount,coverage};
  }
  return Object.freeze({VERSION,evaluate});
});
