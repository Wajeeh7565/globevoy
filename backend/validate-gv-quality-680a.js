'use strict';

process.env.ENABLE_AGODA_HANDOFF_INTEGRITY_679A_R2 = 'true';
process.env.ENABLE_MAP_FIRST_THREE_PICKS_670A = 'true';

const assert = require('node:assert/strict');
const { enrichFlightLeg, enrichStay, BOOKING_TRUST_VERSION_680A } = require('./services/partner-links');
const { qualityRejectionReasons, rankQualifiedHotels } = require('./services/agoda');
const { _internal: generatedTourInternal } = require('./generated-tour');

const observedAt = new Date().toISOString();
const exactFlight = enrichFlightLeg({
  mode: 'flight',
  from: { city: 'New York', airportCode: 'JFK' },
  to: { city: 'San Juan', airportCode: 'SJU' },
  estimatedFlightUsd: 63,
  liveFareVerified: true,
  cheapestOneWay: {
    providerBacked: true,
    productionEligible: true,
    appliedToEstimate: true,
    departureDate: '2026-09-10',
    bookingLink: 'https://www.aviasales.com/search/JFK1009SJU1',
    observedAt
  },
  providerVerification: { verified: true, exactDateMatch: true, productionEligible: true, observedAt }
}, { adults: 1, currency: 'USD' });

assert.equal(BOOKING_TRUST_VERSION_680A, 'GV-QUALITY-680A');
assert.equal(exactFlight.booking.status, 'provider-itinerary-hint');
assert.equal(exactFlight.booking.exactTicketClaimed, false);
assert.equal(exactFlight.booking.trust.currentPriceConfirmed, false);
assert.equal(exactFlight.booking.trust.availabilityConfirmed, false);
assert.equal(exactFlight.booking.trust.baggageBasis, 'unknown-unless-confirmed-on-partner');
assert.equal(exactFlight.booking.trust.ctaLabel, 'Check this itinerary on Aviasales');

const estimatedFlight = enrichFlightLeg({
  mode: 'flight',
  from: { airportCode: 'YYZ' },
  to: { airportCode: 'PTY' },
  departureDate: '2026-10-12',
  estimatedFlightUsd: 300
}, { adults: 1, currency: 'CAD' });
assert.equal(estimatedFlight.booking.status, 'prefilled-comparison-link');
assert.equal(estimatedFlight.booking.trust.priceState, 'planning-estimate');
assert.equal(estimatedFlight.booking.trust.handoffState, 'route-search');
assert.equal(estimatedFlight.booking.trust.ctaLabel, 'Search this route on Aviasales');

const agodaResults = enrichStay({
  city: 'Toronto',
  agodaCityId: 13170,
  arrivalDate: '2026-10-12',
  departureDate: '2026-10-16',
  nights: 4,
  hotel: {
    source: 'agoda',
    estimatedStayUsd: 400,
    providerVerification: {
      verified: true,
      exactStayDates: true,
      productionEligible: true,
      priceLinkIntegrityVersion: 'GV-HOTEL-679A-R1',
      observedAt
    },
    providerHotel: {
      provider: 'Agoda',
      priceLinkIntegrityVersion: 'GV-HOTEL-679A-R1',
      hotelId: 896,
      bookingUrl: 'https://www.agoda.com/partners/partnersearch.aspx?hid=896',
      linkType: 'provider-search-results',
      directPropertyLink: false,
      providerHotelIdInLink: true,
      rateObservation: { taxBasis: 'confirm-on-partner' }
    }
  }
}, { adults: 1, rooms: 1, currency: 'CAD' });
assert.equal(agodaResults.hotel.booking.trust.handoffState, 'selected-property-results');
assert.equal(agodaResults.hotel.booking.trust.currentPriceConfirmed, false);
assert.equal(agodaResults.hotel.booking.trust.availabilityConfirmed, false);
assert.equal(agodaResults.hotel.booking.trust.ctaLabel, 'View selected property in Agoda results');

for (const hotel of [
  { hotelName: 'Downtown apartment', dailyRate: 90 },
  { hotelName: 'Habitación con terraza', dailyRate: 80 },
  { hotelName: 'Old Town walk-up', dailyRate: 70 }
]) {
  assert.ok(qualityRejectionReasons(hotel).includes('low-trust-property-type'));
}

const ranked = rankQualifiedHotels([
  { hotelName: 'Budget Apartment', accommodationType: 'Apartment', dailyRate: 70, reviewScore: 8.9, reviewCount: 200, starRating: 4 },
  { hotelName: 'Harbour Hotel', accommodationType: 'Hotel', dailyRate: 105, reviewScore: 8.7, reviewCount: 500, starRating: 4 }
], 'Best balance');
assert.equal(ranked[0].hotelName, 'Harbour Hotel');

const diversePicks = generatedTourInternal.threePickRoleAssignments670aR2([
  { id: 'a', estimatedTotalUsd: 700, totalDistanceKm: 8000, stops: [{ city: 'San Juan' }, { city: 'Asuncion' }] },
  { id: 'b', estimatedTotalUsd: 900, totalDistanceKm: 9000, stops: [{ city: 'San Juan' }, { city: 'Bogota' }] },
  { id: 'c', estimatedTotalUsd: 920, totalDistanceKm: 4000, stops: [{ city: 'Panama City' }, { city: 'Cartagena' }] },
  { id: 'd', estimatedTotalUsd: 1000, totalDistanceKm: 11000, stops: [{ city: 'Tokyo' }, { city: 'Seoul' }] }
], { budget: 1200, currency: 'USD' });
assert.equal(diversePicks['lowest-cost'].id, 'a');
assert.notEqual(diversePicks['best-balance'].id, 'b');
assert.equal(diversePicks['best-balance'].mapFirstRoleAssignment.recommendationDiversityVersion, 'GV-QUALITY-680A');
assert.equal(diversePicks['best-balance'].mapFirstRoleAssignment.maxStopOverlapWithEarlierPick, 0);

console.log('PASS GV-QUALITY-680A backend trust, handoff, stay-quality, and recommendation-diversity checks');
