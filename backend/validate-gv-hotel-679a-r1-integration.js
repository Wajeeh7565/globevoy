'use strict';
process.env.AGODA_SITE_ID = '123456';
process.env.AGODA_API_KEY = 'test-key';
process.env.ENABLE_AGODA_PROVIDER_STAY_679A = 'true';
process.env.ENABLE_AGODA_PRICE_LINK_INTEGRITY_679A_R1 = 'true';
process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A = 'true';
process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION = 'true';
process.env.ENABLE_PRICE_AUDIT_610D = 'true';
process.env.CAD_TO_USD = '0.735';
const live = require('./services/domain/live-fares/live-provider-verification');
let passed=0,total=0;
function check(name,ok,detail){total++;if(ok){passed++;console.log(`PASS ${name}`)}else{console.error(`FAIL ${name}`,detail||'');process.exitCode=1}}
function response(payload,status=200){return{ok:status>=200&&status<300,status,async text(){return JSON.stringify(payload)}}}
const hotel={hotelId:896,hotelName:'OYO Times Square',starRating:4,reviewScore:7.2,reviewCount:815,currency:'CAD',dailyRate:211,landingURL:'https://www.agoda.com/partners/partnersearch.aspx?hid=896&cid=1953464'};
async function mockFetch(_url,options={}){const body=JSON.parse(options.body||'{}');if(!body?.criteria?.cityId)return response({error:'missing city'},400);return response({results:[hotel]})}
(async()=>{
 const tour={origin:{city:'Toronto',code:'YYZ',airportCode:'YYZ'},cities:[{city:'New York',country:'United States',countryCode:'US',code:'JFK',airportCode:'JFK',nights:4}],stops:[{city:'New York',country:'United States',countryCode:'US',code:'JFK',airportCode:'JFK',arrivalDate:'2026-08-13',departureDate:'2026-08-17',nights:4,hotel:{estimatedStayUsd:700}}],legs:[],totalBudgetUsd:2000,estimatedTotalUsd:700,passengerPricing:{adults:1,children:0,rooms:1,travellers:1}};
 const v=await live.verifyTourWithLiveProviders(tour,{currency:'CAD',adults:1,passengers:1,rooms:1,budgetUsd:2000},{_fetchFn:mockFetch});
 const h=v.tour.stops[0].hotel;
 check('R1 provider verification active',h.providerVerification?.priceLinkIntegrityVersion==='GV-HOTEL-679A-R1',h.providerVerification);
 check('API observation still records exact requested stay dates',h.providerVerification?.verified===true&&h.providerVerification?.exactStayDates===true,h.providerVerification);
 check('landing price parity explicitly false',h.providerVerification?.priceParityVerified===false&&h.providerVerification?.currentLandingPriceConfirmed===false,h.providerVerification);
 check('partnersearch URL classified as search results',h.providerVerification?.providerLinkType==='provider-search-results'&&h.providerVerification?.directPropertyLink===false,h.providerVerification);
 check('provider hotel preserves rate observation',h.providerHotel?.rateObservation?.providerStayTotal===844,h.providerHotel?.rateObservation);
 check('rate observation preserves taxes-exclusive semantics',h.providerHotel?.rateObservation?.taxBasis==='exclusive'&&h.providerHotel?.rateObservation?.taxesAndFeesIncluded===false,h.providerHotel?.rateObservation);
 check('summary advertises R1 price/link integrity',v.summary?.agodaProviderStay?.priceLinkIntegrityEnabled===true&&v.summary?.agodaProviderStay?.priceLinkIntegrityVersion==='GV-HOTEL-679A-R1',v.summary?.agodaProviderStay);
 check('summary does not claim landing parity',v.summary?.agodaProviderStay?.landingPriceParityComplete===false&&v.summary?.agodaProviderStay?.priceParityVerifiedStayCount===0,v.summary?.agodaProviderStay);
 check('budget claim downgraded from provider-backed fit until landing price parity is confirmed',v.summary?.budgetClaim==='estimated-to-fit-budget',v.summary);
 check('final price confirmation remains required',v.summary?.agodaProviderStay?.finalPriceRequiresPartnerConfirmation===true,v.summary?.agodaProviderStay);
 if(process.exitCode)throw new Error(`GV-HOTEL-679A-R1 integration validation failed (${passed}/${total}).`);
 console.log(`GV-HOTEL-679A-R1 integration validation passed (${passed}/${total}).`);
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
