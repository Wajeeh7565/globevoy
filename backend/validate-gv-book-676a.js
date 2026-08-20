'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const service = require('./services/duffel-sandbox-proof');
const lambda = require('./lambda');

const checks=[];
function check(name, passed, details=null){checks.push({name,passed:Boolean(passed),details});if(!passed)process.exitCode=1;}
function sampleTour(){return{
  origin:{city:'Toronto',country:'Canada',countryCode:'CA',code:'YYZ'},
  cities:[
    {city:'Fort Lauderdale',country:'United States',countryCode:'US',code:'FLL',hotel:{estimatedDisplayTotal:420}},
    {city:'Cancún',country:'Mexico',countryCode:'MX',code:'CUN',hotel:{estimatedDisplayTotal:390}}
  ],
  legs:[
    {from:{city:'Toronto',code:'YYZ'},to:{city:'Fort Lauderdale',code:'FLL'},departureDate:'2026-11-05',estimatedDisplayTotal:300},
    {from:{city:'Fort Lauderdale',code:'FLL'},to:{city:'Cancún',code:'CUN'},departureDate:'2026-11-08',estimatedDisplayTotal:240},
    {from:{city:'Cancún',code:'CUN'},to:{city:'Toronto',code:'YYZ'},departureDate:'2026-11-11',estimatedDisplayTotal:350}
  ],
  budget:{total:{currency:'CAD'}},
  passengerPricing:{travellers:1,rooms:1}
};}
function fakeOffer(id,total,currency='CAD',sliceCount=3){return{
  id,live_mode:false,total_amount:String(total),total_currency:currency,expires_at:'2026-07-29T13:00:00Z',
  owner:{name:'Duffel Airways',iata_code:'ZZ'},
  slices:Array.from({length:sliceCount},(_,i)=>({origin:{iata_code:['YYZ','FLL','CUN'][i]||'AAA'},destination:{iata_code:['FLL','CUN','YYZ'][i]||'BBB'},duration:'PT2H',segments:[{departing_at:`2026-11-${String(5+i*3).padStart(2,'0')}T09:00:00`,arriving_at:`2026-11-${String(5+i*3).padStart(2,'0')}T11:00:00`,operating_carrier:{name:'Duffel Airways'},operating_carrier_flight_number:String(100+i)}]}))
};}
async function main(){
  check('version',service.DUFFEL_PROOF_VERSION==='GV-BOOK-676A',service.DUFFEL_PROOF_VERSION);
  const disabled=service.status({});
  check('disabled by default',disabled.enabled===false&&disabled.configured===false,disabled);
  const configured=service.status({ENABLE_DUFFEL_SANDBOX_676A:'true',DUFFEL_ACCESS_TOKEN:'duffel_test_example'});
  check('test token configures sandbox',configured.configured===true&&configured.mode==='test',configured);
  const live=service.status({ENABLE_DUFFEL_SANDBOX_676A:'true',DUFFEL_ACCESS_TOKEN:'duffel_live_example'});
  check('live token is not configured for sandbox proof',live.configured===false&&live.mode==='live',live);
  check('order and payment creation disabled',configured.orderCreationEnabled===false&&configured.paymentCollectionEnabled===false,configured);

  const request=service.buildOfferRequest({tour:sampleTour(),travellers:2,maxConnections:1});
  check('three route legs become three Duffel slices',request.data.slices.length===3,request.data.slices);
  check('slice routes are exact',request.data.slices.map(x=>`${x.origin}-${x.destination}`).join(',')==='YYZ-FLL,FLL-CUN,CUN-YYZ',request.data.slices);
  check('slice dates are exact',request.data.slices.map(x=>x.departure_date).join(',')==='2026-11-05,2026-11-08,2026-11-11',request.data.slices);
  check('passenger count is preserved',request.data.passengers.length===2,request.data.passengers.length);
  check('economy and connection limit are explicit',request.data.cabin_class==='economy'&&request.data.max_connections===1,request.data);

  let missingDate=false;try{const t=sampleTour();delete t.legs[1].departureDate;service.buildOfferRequest({tour:t});}catch(e){missingDate=e.code==='missing-departure-date';}
  check('missing date is rejected',missingDate);
  let ground=false;try{const t=sampleTour();t.legs[1].mode='rail';service.buildOfferRequest({tour:t});}catch(e){ground=e.code==='ground-leg-not-supported';}
  check('ground leg is rejected from flight request',ground);
  let missingCode=false;try{const t=sampleTour();t.legs[0].from.code='Toronto';service.buildOfferRequest({tour:t});}catch(e){missingCode=e.code==='missing-airport-code';}
  check('missing IATA code is rejected',missingCode);

  const calls=[];
  const fetch=async(url,options)=>{calls.push({url,options});return{ok:true,status:200,text:async()=>JSON.stringify({data:{id:'orq_test',live_mode:false,offers:[fakeOffer('off_expensive',999),fakeOffer('off_wrong_slices',100,'CAD',2),fakeOffer('off_cheapest',620)]}})};};
  const result=await service.runProof({tour:sampleTour(),travellers:1,currency:'CAD',hotelSubtotal:810,transferSubtotal:40},{ENABLE_DUFFEL_SANDBOX_676A:'true',DUFFEL_ACCESS_TOKEN:'duffel_test_secret'}, {fetch});
  check('one provider request made',result.providerRequestMade===true&&calls.length===1,{providerRequestMade:result.providerRequestMade,calls:calls.length});
  check('correct Duffel endpoint and API version used',/\/air\/offer_requests/.test(calls[0].url)&&calls[0].options.headers['Duffel-Version']==='v2',calls[0]);
  check('test token sent only in request header',calls[0].options.headers.Authorization==='Bearer duffel_test_secret'&&!JSON.stringify(result).includes('duffel_test_secret'));
  const sent=JSON.parse(calls[0].options.body);
  check('request body contains all three slices',sent.data.slices.length===3,sent.data.slices);
  check('wrong-slice offer filtered',result.offers.length===2&&result.offers.every(x=>x.sliceCount===3),result.offers);
  check('offers sorted cheapest first',result.selectedOffer?.id==='off_cheapest',result.offers.map(x=>x.id));
  check('test offer is never live mode',result.liveMode===false&&result.selectedOffer.liveMode===false,result.selectedOffer);
  check('same-currency combined display total calculated',result.total.combinedAmount===1470&&result.total.combinedAmountStatus==='calculated',result.total);
  check('hotel amount labelled as estimate',/Globevoy hotel estimate/.test(result.total.labels.hotel),result.total.labels);
  check('architecture does not claim atomic transaction',result.bookingArchitecture.oneAtomicTransactionProven===false&&result.bookingArchitecture.orderCreationEnabled===false,result.bookingArchitecture);

  const mismatch=service.combinedTotal(service.normalizeOffer(fakeOffer('off_usd',500,'USD')),{currency:'CAD',hotelSubtotal:500,transferSubtotal:0});
  check('unlike currencies are not added',mismatch.combinedAmount===null&&mismatch.combinedAmountStatus==='currency-conversion-required',mismatch);
  const noToken=await service.runProof({tour:sampleTour(),currency:'CAD'},{ENABLE_DUFFEL_SANDBOX_676A:'true'}, {fetch});
  check('missing token makes no provider request',noToken.providerRequestMade===false&&noToken.reason==='duffel-test-token-required'&&calls.length===1,noToken);
  const liveToken=await service.runProof({tour:sampleTour(),currency:'CAD'},{ENABLE_DUFFEL_SANDBOX_676A:'true',DUFFEL_ACCESS_TOKEN:'duffel_live_secret'}, {fetch});
  check('live token is refused without provider call',liveToken.providerRequestMade===false&&liveToken.reason==='live-token-refused-for-sandbox-proof'&&calls.length===1,liveToken);

  const oldFlag=process.env.ENABLE_DUFFEL_SANDBOX_676A,oldToken=process.env.DUFFEL_ACCESS_TOKEN;
  delete process.env.ENABLE_DUFFEL_SANDBOX_676A;delete process.env.DUFFEL_ACCESS_TOKEN;
  const statusResponse=await lambda.handler({rawPath:'/api/duffel-sandbox-proof',requestContext:{http:{method:'GET'}}});
  const statusBody=JSON.parse(statusResponse.body);
  check('Lambda GET status endpoint works',statusResponse.statusCode===200&&statusBody.version==='GV-BOOK-676A',statusBody);
  const methodResponse=await lambda.handler({rawPath:'/api/duffel-sandbox-proof',requestContext:{http:{method:'PUT'}}});
  check('Lambda rejects unsupported method',methodResponse.statusCode===405,methodResponse.statusCode);
  const badPost=await lambda.handler({rawPath:'/api/duffel-sandbox-proof',requestContext:{http:{method:'POST'}},body:JSON.stringify({tour:{legs:[]}})});
  check('Lambda validation error returns 400',badPost.statusCode===400,JSON.parse(badPost.body));
  if(oldFlag===undefined)delete process.env.ENABLE_DUFFEL_SANDBOX_676A;else process.env.ENABLE_DUFFEL_SANDBOX_676A=oldFlag;
  if(oldToken===undefined)delete process.env.DUFFEL_ACCESS_TOKEN;else process.env.DUFFEL_ACCESS_TOKEN=oldToken;

  const lambdaSource=fs.readFileSync(path.join(__dirname,'lambda.js'),'utf8');
  check('Lambda imports sandbox proof service',lambdaSource.includes("require('./services/duffel-sandbox-proof')"));
  check('Lambda exposes only one proof route',lambdaSource.includes("path === '/api/duffel-sandbox-proof'"));
  check('no order creation endpoint added',!lambdaSource.includes('/api/duffel-order')&&!lambdaSource.includes('/api/duffel-payment'));

  const out={release:'GV-BOOK-676A',generatedAt:new Date().toISOString(),checkCount:checks.length,passedCount:checks.filter(x=>x.passed).length,failedCount:checks.filter(x=>!x.passed).length,checks};
  fs.writeFileSync(path.join(__dirname,'VALIDATION_GV_BOOK_676A_BACKEND.json'),JSON.stringify(out,null,2)+'\n');
  if(out.failedCount)throw new Error(`GV-BOOK-676A backend validation failed (${out.failedCount}).`);
  console.log(`GV-BOOK-676A backend validation passed (${out.passedCount}/${out.checkCount}).`);
}
main().catch(error=>{console.error(error.stack||error);process.exit(1);});
