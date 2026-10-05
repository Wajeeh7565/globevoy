'use strict';

const assert = require('node:assert/strict');
const { enrichFlightLeg, enrichStay } = require('./services/providers/links/partner-links');

function daysBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function leg(origin, destination, departureDate, observed = false) {
  return enrichFlightLeg({
    mode: 'flight',
    from: { airportCode: origin },
    to: { airportCode: destination },
    departureDate,
    estimatedFlightUsd: 100,
    ...(observed ? {
      liveFareVerified: true,
      cheapestOneWay: {
        providerBacked: true,
        productionEligible: true,
        appliedToEstimate: true,
        departureDate,
        bookingLink: `https://www.aviasales.com/search/${origin}${departureDate.slice(8, 10)}${departureDate.slice(5, 7)}${destination}1`,
        observedAt: new Date().toISOString()
      },
      providerVerification: { verified: true, exactDateMatch: true, productionEligible: true }
    } : {})
  }, { adults: 1, currency: 'USD' });
}

function stay(city, checkIn, checkOut, observed = false) {
  return enrichStay({
    city,
    arrivalDate: checkIn,
    departureDate: checkOut,
    nights: daysBetween(checkIn, checkOut),
    hotel: {
      estimatedStayUsd: 300,
      ...(observed ? {
        source: 'agoda',
        providerVerification: { verified: true, exactStayDates: true, productionEligible: true },
        providerHotel: { provider: 'Agoda', hotelId: 123, bookingUrl: 'https://www.agoda.com/partners/partnersearch.aspx?hid=123' }
      } : {})
    }
  }, { adults: 1, rooms: 1, currency: 'USD' });
}

const fixtures = [
  {
    name: 'Dublin–Agadir–Tangier',
    expectedNights: 6,
    legs: [leg('DUB', 'AGA', '2026-08-10'), leg('AGA', 'TNG', '2026-08-13', true), leg('TNG', 'DUB', '2026-08-16')],
    stays: [stay('Agadir', '2026-08-10', '2026-08-13', true), stay('Tangier', '2026-08-13', '2026-08-16')]
  },
  {
    name: 'Toronto major-city input',
    expectedNights: 8,
    legs: [leg('YYZ', 'PTY', '2026-10-10'), leg('PTY', 'CTG', '2026-10-14'), leg('CTG', 'YYZ', '2026-10-18')],
    stays: [stay('Panama City', '2026-10-10', '2026-10-14'), stay('Cartagena', '2026-10-14', '2026-10-18')]
  },
  {
    name: 'New York major-city input',
    expectedNights: 10,
    legs: [leg('JFK', 'SJU', '2026-11-05', true), leg('SJU', 'ASU', '2026-11-10'), leg('ASU', 'JFK', '2026-11-15')],
    stays: [stay('San Juan', '2026-11-05', '2026-11-10', true), stay('Asuncion', '2026-11-10', '2026-11-15')]
  }
];

for (const fixture of fixtures) {
  assert.equal(fixture.stays.reduce((sum, item) => sum + item.nights, 0), fixture.expectedNights, `${fixture.name}: night allocation`);
  assert.ok(fixture.legs.every(item => item.booking.trust.currentPriceConfirmed === false), `${fixture.name}: flight quote honesty`);
  assert.ok(fixture.legs.every(item => item.booking.trust.availabilityConfirmed === false), `${fixture.name}: flight availability honesty`);
  assert.ok(fixture.stays.every(item => item.hotel.booking.trust.availabilityConfirmed === false), `${fixture.name}: hotel availability honesty`);
  assert.ok(fixture.legs.some(item => item.booking.trust.priceState === 'planning-estimate'), `${fixture.name}: estimates remain explicit`);
}

console.log('PASS GV-QUALITY-680A Dublin/Morocco, Toronto, and New York fixtures');
