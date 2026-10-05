'use strict';

process.env.ENABLE_AGODA_HANDOFF_INTEGRITY_679A_R2 = 'true';
process.env.AGODA_AFFILIATE_CID = '1963873';

const {
  enrichStay,
  AGODA_HANDOFF_INTEGRITY_VERSION_679A_R2,
  agodaHandoffIntegrity679AR2Enabled
} = require('./services/providers/links/partner-links');

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

function exactAgodaHotel(overrides = {}) {
  return {
    source: 'agoda',
    estimatedStayUsd: 400,
    providerVerification: {
      verified: true,
      exactStayDates: true,
      productionEligible: true,
      provider: 'Agoda',
      priceLinkIntegrityVersion: 'GV-HOTEL-679A-R1'
    },
    providerHotel: {
      provider: 'Agoda',
      priceLinkIntegrityVersion: 'GV-HOTEL-679A-R1',
      hotelId: 896,
      hotelName: 'Example Agoda Hotel',
      bookingUrl: 'https://www.agoda.com/partners/partnersearch.aspx?hid=896&cid=1953464',
      linkType: 'provider-search-results',
      directPropertyLink: false,
      providerHotelIdInLink: true,
      ...overrides
    }
  };
}

check('R2 version exported', AGODA_HANDOFF_INTEGRITY_VERSION_679A_R2 === 'GV-HOTEL-679A-R2');
check('R2 feature flag active', agodaHandoffIntegrity679AR2Enabled() === true);

const resultStay = enrichStay({
  city: 'Cancun',
  country: 'Mexico',
  agodaCityId: 3478,
  arrivalDate: '2026-08-09',
  departureDate: '2026-08-14',
  nights: 5,
  hotel: exactAgodaHotel()
}, { currency: 'CAD', adults: 1, rooms: 1 });

check('partnersearch remains results handoff', resultStay.hotel.booking.status === 'provider-search-results', resultStay.hotel.booking);
check('results handoff label is explicit', resultStay.hotel.booking.label === 'View in Agoda results', resultStay.hotel.booking);
check('results handoff is not marked specific hotel deeplink', resultStay.hotel.booking.specificHotel === false && resultStay.hotel.booking.directPropertyLink === false, resultStay.hotel.booking);
check('results handoff retains R2 marker', resultStay.hotel.booking.handoffIntegrityVersion === 'GV-HOTEL-679A-R2', resultStay.hotel.booking);
check('hotel id in partnersearch does not upgrade link type', resultStay.hotel.booking.providerHotelIdInLink === true && resultStay.hotel.booking.linkType === 'provider-search-results', resultStay.hotel.booking);

const directStay = enrichStay({
  city: 'Cancun',
  country: 'Mexico',
  agodaCityId: 3478,
  arrivalDate: '2026-08-09',
  departureDate: '2026-08-14',
  nights: 5,
  hotel: exactAgodaHotel({
    bookingUrl: 'https://www.agoda.com/nilu-cancun-zona-hotelera-by-selina.html',
    linkType: 'provider-property-page',
    directPropertyLink: true,
    providerHotelIdInLink: false
  })
}, { currency: 'CAD', adults: 1, rooms: 1 });

check('property page remains property handoff', directStay.hotel.booking.status === 'provider-property-page' && directStay.hotel.booking.directPropertyLink === true, directStay.hotel.booking);
check('direct property label reserved for property page', directStay.hotel.booking.label === 'View this hotel on Agoda' && directStay.hotel.booking.specificHotel === true, directStay.hotel.booking);
check('affiliate/date params preserve property path', /nilu-cancun-zona-hotelera-by-selina\.html/i.test(directStay.hotel.booking.url), directStay.hotel.booking.url);

const unknownStay = enrichStay({
  city: 'Milan',
  country: 'Italy',
  agodaCityId: 16285,
  arrivalDate: '2026-08-13',
  departureDate: '2026-08-17',
  nights: 4,
  hotel: exactAgodaHotel({
    bookingUrl: 'https://www.agoda.com/some-affiliate-landing?hid=123',
    linkType: 'provider-link-unverified',
    directPropertyLink: false
  })
}, { currency: 'CAD', adults: 1, rooms: 1 });

check('unverified link never called direct hotel page', unknownStay.hotel.booking.status === 'provider-link-unverified' && unknownStay.hotel.booking.label === 'View in Agoda results', unknownStay.hotel.booking);

if (process.exitCode) throw new Error(`GV-HOTEL-679A-R2 backend validation failed (${passed}/${total}).`);
console.log(`GV-HOTEL-679A-R2 backend validation passed (${passed}/${total}).`);
