'use strict';
const outputPath = require('./output-path');
const FRONTEND_ROOT = require('node:path').resolve(__dirname, '..');
const fs=require('fs'),path=require('path'),vm=require('vm');
class ClassList{constructor(){this.values=new Set();}add(v){this.values.add(v);}remove(v){this.values.delete(v);}contains(v){return this.values.has(v);}toggle(v,force){const on=force===undefined?!this.values.has(v):Boolean(force);on?this.values.add(v):this.values.delete(v);return on;}}
class Element{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.className='';this.classList=new ClassList();this.disabled=false;this.onclick=null;}}
class Storage{constructor(){this.m=new Map();}getItem(k){return this.m.has(k)?this.m.get(k):null;}setItem(k,v){this.m.set(k,String(v));}}
function tour(){return{origin:{city:'Toronto',code:'YYZ'},cities:[{city:'Fort Lauderdale',code:'FLL',hotel:{estimatedDisplayTotal:420}},{city:'Cancún',code:'CUN',hotel:{estimatedDisplayTotal:390}}],legs:[{from:{city:'Toronto',code:'YYZ'},to:{city:'Fort Lauderdale',code:'FLL'},departureDate:'2026-11-05'},{from:{city:'Fort Lauderdale',code:'FLL'},to:{city:'Cancún',code:'CUN'},departureDate:'2026-11-08'},{from:{city:'Cancún',code:'CUN'},to:{city:'Toronto',code:'YYZ'},departureDate:'2026-11-11'}],budget:{total:{currency:'CAD'}},passengerPricing:{travellers:1,rooms:1}};}
function proof(){return{ok:true,version:'GV-BOOK-676A',providerRequestMade:true,reason:'sandbox-offers-returned',requestSummary:{sliceCount:3,passengerCount:1,cabinClass:'economy',maxConnections:1,slices:[{origin:'YYZ',destination:'FLL',departure_date:'2026-11-05'},{origin:'FLL',destination:'CUN',departure_date:'2026-11-08'},{origin:'CUN',destination:'YYZ',departure_date:'2026-11-11'}]},offers:[{id:'off_1',liveMode:false,totalAmount:620,totalCurrency:'CAD',expiresAt:'2026-07-29T13:00:00Z',owner:{name:'Duffel Airways',iataCode:'ZZ'},operatingCarriers:['Duffel Airways'],sliceCount:3,slices:[{origin:'YYZ',destination:'FLL'},{origin:'FLL',destination:'CUN'},{origin:'CUN',destination:'YYZ'}]}],selectedOffer:{id:'off_1',liveMode:false,totalAmount:620,totalCurrency:'CAD',sliceCount:3},total:{displayCurrency:'CAD',combinedAmountStatus:'calculated',flightSandboxSubtotal:620,flightSandboxCurrency:'CAD',hotelEstimateSubtotal:810,transferEstimateSubtotal:0,combinedAmount:1430,labels:{flight:'Duffel test-mode flight offer — not a live market price',hotel:'Globevoy hotel estimate — not a Duffel Stays quote',transfer:'Globevoy transfer estimate',combined:'Sandbox combined display total'}}};}
async function main(){
 const ids=['gv-duffel-run','gv-duffel-status','gv-duffel-request','gv-duffel-offers','gv-duffel-total'];const elements=new Map(ids.map(id=>[id,new Element(id)]));
 const document={querySelector(sel){return sel.startsWith('#')?elements.get(sel.slice(1))||null:null;}};
 const localStorage=new Storage(),sessionStorage=new Storage();sessionStorage.setItem('globevoy.multi.selected.v1',JSON.stringify(tour()));
 let payloadSeen=null,runCount=0,statusResult={ok:true,configured:true,enabled:true,mode:'test'};
 const context={console,URLSearchParams,Intl,Date,Promise,setTimeout,clearTimeout,document,localStorage,sessionStorage,location:{search:'?multi=true'},window:null};context.window=context;context.window.name='';context.window.GlobevoyApi={isConfigured:()=>true,getDuffelSandboxStatus:async()=>statusResult,runDuffelSandboxProof:async payload=>{payloadSeen=payload;runCount++;return proof();}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(FRONTEND_ROOT,'scripts/booking-duffel-676a.js'),'utf8'),context,{filename:'booking-duffel-676a.js'});await new Promise(r=>setTimeout(r,20));
 const checks=[];const check=(name,passed,details=null)=>checks.push({name,passed:Boolean(passed),details});
 check('configured status renders ready',/Duffel test mode is connected/.test(elements.get('gv-duffel-status').innerHTML),elements.get('gv-duffel-status').innerHTML);
 check('configured status enables button',elements.get('gv-duffel-run').disabled===false);
 await elements.get('gv-duffel-run').onclick();
 check('sandbox search runs once on click',runCount===1,runCount);
 check('tour payload preserves three dated legs',payloadSeen?.tour?.legs?.length===3,payloadSeen);
 check('hotel estimate is sent',payloadSeen?.hotelSubtotal===810,payloadSeen?.hotelSubtotal);
 check('request summary renders',/3 dated flight slices/.test(elements.get('gv-duffel-request').innerHTML),elements.get('gv-duffel-request').innerHTML);
 check('offer route renders all slices',/YYZ → FLL/.test(elements.get('gv-duffel-offers').innerHTML)&&/CUN → YYZ/.test(elements.get('gv-duffel-offers').innerHTML),elements.get('gv-duffel-offers').innerHTML);
 check('offer price is labelled test only',/test price, not live/.test(elements.get('gv-duffel-offers').innerHTML),elements.get('gv-duffel-offers').innerHTML);
 check('combined display total renders',/CAD C\$1,430/.test(elements.get('gv-duffel-total').innerHTML),elements.get('gv-duffel-total').innerHTML);
 check('hotel remains labelled estimate',/Globevoy hotel estimate/.test(elements.get('gv-duffel-total').innerHTML),elements.get('gv-duffel-total').innerHTML);
 check('completion status says no order or payment',/No order or payment was created/.test(elements.get('gv-duffel-status').innerHTML),elements.get('gv-duffel-status').innerHTML);
 elements.get('gv-duffel-run').classList.add('gv-entry-guarded');elements.get('gv-duffel-run').disabled=false;await context.window.GlobevoyDuffel676A.run();
 check('entry guard prevents second provider call',runCount===1,runCount);
 check('entry guard explains block',/Entry check blocks this route/.test(elements.get('gv-duffel-status').innerHTML),elements.get('gv-duffel-status').innerHTML);
 const result={release:'GV-BOOK-676A',fixture:'duffel-booking-panel-dom',generatedAt:new Date().toISOString(),checkCount:checks.length,passedCount:checks.filter(x=>x.passed).length,failedCount:checks.filter(x=>!x.passed).length,checks};fs.writeFileSync(outputPath('VALIDATION_GV_BOOK_676A_BROWSER_FIXTURE.json'),JSON.stringify(result,null,2)+'\n');if(result.failedCount)throw new Error(`fixture failed ${result.failedCount}`);console.log(`GV-BOOK-676A browser fixture passed (${result.passedCount}/${result.checkCount}).`);
}
main().catch(e=>{console.error(e.stack||e);process.exit(1);});
