'use strict';
process.env.ENABLE_AGODA_PROVIDER_STAY_679A = 'true';
process.env.ENABLE_AGODA_PRICE_LINK_INTEGRITY_679A_R1 = 'true';
process.env.ENABLE_PRICE_AUDIT_610D = 'true';
process.env.AGODA_SITE_ID = 'test-site';
process.env.AGODA_API_KEY = 'test-key';
process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION = 'true';
process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A = 'true';

const agoda = require('./services/agoda');

let passed = 0;
let total = 0;
function check(name, condition, detail) {
  total++;
  if (!condition) {
    console.error(`FAIL ${name}`, detail || '');
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`PASS ${name}`);
  }
}

(async () => {
  check('R1 version exported', agoda.AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1 === 'GV-HOTEL-679A-R1');
  check('R1 feature flag active', agoda.priceLinkIntegrity679AR1Enabled() === true);

  const resultsLink = agoda.classifyAgodaLandingUrl679AR1('https://www.agoda.com/partners/partnersearch.aspx?hid=896&cid=1953464');
  check('partnersearch classified as results link', resultsLink.linkType === 'provider-search-results' && resultsLink.directPropertyLink === false, resultsLink);
  check('hotel id presence retained without claiming direct property page', resultsLink.providerHotelIdInLink === true && resultsLink.finalDestinationRequiresPartnerConfirmation === true, resultsLink);

  const directLink = agoda.classifyAgodaLandingUrl679AR1('https://www.agoda.com/nilu-cancun-zona-hotelera-by-selina.html');
  check('clean hotel HTML classified as property page', directLink.linkType === 'provider-property-page' && directLink.directPropertyLink === true, directLink);

  const destination = { city: 'Cancun', country: 'Mexico', agodaCityId: 3478, fallbackNightlyUsd: 95 };
  const hotel = {
    hotelId: 896,
    hotelName: 'Nilu Cancun Zona Hotelera by Selina',
    dailyRate: 136,
    currency: 'CAD',
    landingURL: 'https://www.agoda.com/partners/partnersearch.aspx?hid=896&cid=1953464',
    reviewScore: 7.6,
    reviewCount: 351,
    starRating: 3
  };
  const fetchFn = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ results: [hotel] }) });
  const stay = await agoda.fetchAgodaStayEstimate({ destination, nights: 5, month: '2026-08-08', currency: 'CAD', adults: 1, rooms: 1, _fetchFn: fetchFn });
  const ph = stay.providerHotel || {};
  check('provider hotel carries R1 integrity marker', ph.priceLinkIntegrityVersion === 'GV-HOTEL-679A-R1', ph);
  check('rate is an observation, not landing-page parity claim', ph.rateObservation?.status === 'provider-observation-unconfirmed-at-landing' && ph.rateObservation?.priceParityVerified === false && ph.rateObservation?.currentLandingPriceConfirmed === false, ph.rateObservation);
  check('exclusive dailyRate tax semantics preserved', ph.rateObservation?.sourceField === 'dailyRate' && ph.rateObservation?.taxBasis === 'exclusive' && ph.rateObservation?.taxesAndFeesIncluded === false, ph.rateObservation);
  check('provider observed total preserved', ph.rateObservation?.providerStayTotal === 680, ph.rateObservation);
  check('partnersearch handoff not called direct', ph.linkType === 'provider-search-results' && ph.directPropertyLink === false, ph);
  check('final price confirmation explicitly required', ph.rateObservation?.finalPriceRequiresPartnerConfirmation === true && ph.finalDestinationRequiresPartnerConfirmation === true, ph);

  if (process.exitCode) throw new Error(`GV-HOTEL-679A-R1 backend validation failed (${passed}/${total}).`);
  console.log(`GV-HOTEL-679A-R1 backend validation passed (${passed}/${total}).`);
})().catch(err => { console.error(err.stack || err); process.exit(1); });
