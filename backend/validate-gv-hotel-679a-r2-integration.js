'use strict';

process.env.AGODA_SITE_ID = '123456';
process.env.AGODA_API_KEY = 'test-key';
process.env.ENABLE_AGODA_PROVIDER_STAY_679A = 'true';
process.env.ENABLE_AGODA_PRICE_LINK_INTEGRITY_679A_R1 = 'true';
process.env.ENABLE_AGODA_HANDOFF_INTEGRITY_679A_R2 = 'true';
process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A = 'true';
process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION = 'true';
process.env.ENABLE_PRICE_AUDIT_610D = 'true';
process.env.CAD_TO_USD = '0.735';

const live = require('./services/live-provider-verification');
const links = require('./services/partner-links');

let passed=0,total=0;
function check(name,ok,detail){total++;if(ok){passed++;console.log(`PASS ${name}`)}else{console.error(`FAIL ${name}`,detail||'');process.exitCode=1}}
function response(payload,status=200){return{ok:status>=200&&status<300,status,async text(){return JSON.stringify(payload)}}}

const hotel={
  hotelId:896,
  hotelName:'OYO Times Square',
  starRating:4,
  reviewScore:7.2,
  reviewCount:815,
  currency:'CAD',
  dailyRate:211,
  landingURL:'https://www.agoda.com/partners/partnersearch.aspx?hid=896&cid=1953464'
};

async function mockFetch(_url,options={}){
  const body=JSON.parse(options.body||'{}');
  if(!body?.criteria?.cityId)return response({error:'missing city'},400);
  return response({results:[hotel]});
}

(async()=>{
  const tour={
    origin:{city:'Toronto',code:'YYZ',airportCode:'YYZ'},
    cities:[{city:'New York',country:'United States',countryCode:'US',code:'JFK',airportCode:'JFK',nights:4}],
    stops:[{
      city:'New York',
      country:'United States',
      countryCode:'US',
      code:'JFK',
      airportCode:'JFK',
      agodaCityId:318,
      arrivalDate:'2026-08-13',
      departureDate:'2026-08-17',
      nights:4,
      hotel:{estimatedStayUsd:700}
    }],
    legs:[],
    totalBudgetUsd:2000,
    estimatedTotalUsd:700,
    passengerPricing:{adults:1,children:0,rooms:1,travellers:1}
  };

  const verified=await live.verifyTourWithLiveProviders(
    tour,
    {currency:'CAD',adults:1,passengers:1,rooms:1,budgetUsd:2000},
    {_fetchFn:mockFetch}
  );

  check('summary advertises R2 handoff integrity',
    verified.summary?.agodaProviderStay?.handoffIntegrityEnabled===true
      && verified.summary?.agodaProviderStay?.handoffIntegrityVersion==='GV-HOTEL-679A-R2',
    verified.summary?.agodaProviderStay);

  const enriched=links.enrichStay(
    verified.tour.stops[0],
    {currency:'CAD',adults:1,passengers:1,rooms:1}
  );
  const h=enriched.hotel||{};
  const b=h.booking||{};

  check('verified Agoda provider hotel survives presentation enrichment',h.providerHotel?.provider==='Agoda',h.providerHotel);
  check('partnersearch remains provider-search-results',b.linkType==='provider-search-results'&&b.status==='provider-search-results',b);
  check('R2 label says Agoda results, not exact property',b.label==='View in Agoda results',b);
  check('R2 metadata rejects direct property claim',b.directPropertyLink===false&&b.specificHotel===false,b);
  check('hotel id in results URL does not change handoff semantics',b.providerHotelIdInLink===true,b);
  check('R2 handoff marker survives final presentation',b.handoffIntegrityVersion==='GV-HOTEL-679A-R2',b);
  check('selected dates survive Agoda handoff',b.checkIn==='2026-08-13'&&b.checkOut==='2026-08-17',b);
  check('party survives Agoda handoff',b.passengers?.adults===1&&b.passengers?.rooms===1,b.passengers);
  check('R1 price honesty remains active',h.providerHotel?.rateObservation?.priceParityVerified===false&&verified.summary?.budgetClaim==='estimated-to-fit-budget',{rate:h.providerHotel?.rateObservation,budgetClaim:verified.summary?.budgetClaim});

  if(process.exitCode)throw new Error(`GV-HOTEL-679A-R2 integration validation failed (${passed}/${total}).`);
  console.log(`GV-HOTEL-679A-R2 integration validation passed (${passed}/${total}).`);
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
