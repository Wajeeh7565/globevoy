'use strict';
// Planning cost evidence only. Live room/offer verification remains in Nuitee.
const DAY=86400000;
function iso(value){const s=String(value||'');const t=Date.parse(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null;}
function quote(request, options={}) {
 const {cityId,checkIn,checkOut,rooms,quality={}}=request;
 const nights=(Date.parse(checkOut)-Date.parse(checkIn))/DAY;
 if(!cityId||!iso(checkIn)||!iso(checkOut)||!Number.isInteger(nights)||nights<1||nights>35||!Number.isInteger(rooms)||rooms<1||rooms>9)return null;
 let raw;
 try{raw=options.provider?options.provider.quote({...request}):{
  nightlyUsd:options.regionalNightlyUsd,source:'regional-planning-model',observedAt:null,
  uncertainty:'regional estimate; seasonal variation, taxes and availability unverified'
 };}catch{return null;}
 if(!raw||typeof raw.then==='function'||raw.currency&&raw.currency!=='USD')return null;
 const nightly=Number(raw.nightlyUsd),tax=raw.taxesAndFeesUsd==null?null:Number(raw.taxesAndFeesUsd);
 if(!Number.isFinite(nightly)||nightly<=0||tax!=null&&(!Number.isFinite(tax)||tax<0)||!raw.source)return null;
 const now=options.now??Date.now(),observed=raw.observedAt==null?null:Date.parse(raw.observedAt);
 if(observed!=null&&(!Number.isFinite(observed)||observed>now+60000||now-observed>14*DAY))return null;
 if(raw.expiresAt&&(!Number.isFinite(Date.parse(raw.expiresAt))||Date.parse(raw.expiresAt)<=now))return null;
 const stars=Number.isFinite(raw.stars)?raw.stars:null,rating=Number.isFinite(raw.reviewScore)?raw.reviewScore:null;
 if(quality.minStars&&stars!=null&&stars<quality.minStars||quality.minReviewScore&&rating!=null&&rating<quality.minReviewScore)return null;
 const total=Math.round((nightly*rooms*nights+(tax||0))*100)/100;
 return {version:'GV-HOTEL-COST-001',cityId,checkIn,checkOut,nights,rooms,currency:'USD',nightlyPerRoomUsd:nightly,
  estimatedTotalUsd:total,taxesAndFeesUsd:tax,taxesAndFeesKnown:tax!=null,quality:{requested:quality,stars,reviewScore:rating,
   verified:(!quality.minStars||stars!=null)&&(!quality.minReviewScore||rating!=null)&&(stars!=null||rating!=null)},
  source:raw.source,observedAt:raw.observedAt||null,expiresAt:raw.expiresAt||null,
  uncertainty:raw.uncertainty||'planning estimate; availability and final price unverified',
  bookable:false,availabilityVerified:false,finalVerificationProvider:'Nuitee'};
}
function fixtureProvider(records=[]){
 const index=new Map();for(const row of records)index.set([row.cityId,row.checkIn,row.checkOut].join('|'),Object.freeze({...row}));
 return {quote:request=>index.get([request.cityId,request.checkIn,request.checkOut].join('|'))||null};
}
module.exports={quote,fixtureProvider};
