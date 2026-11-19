'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v2 = require('../../frontend/scripts/booking-trip-v2.js');

const now = Date.parse('2026-11-19T09:10:00Z');
function tour() {
  return {
    totalNights: 12,
    passengerPricing: { travellers: 1, adults: 1, rooms: 1 },
    displayBudget: { currency: 'CAD', symbol: 'C$', exchangeRateFromUsd: 1.36, totalBudget: 5000 },
    origin: { city: 'Toronto', code: 'YYZ' },
    backendLegs: [
      { mode: 'flight', from: { city: 'Toronto', code: 'YYZ' }, to: { city: 'Bogota', code: 'BOG' }, departureDate: '2026-12-03', airline: 'Copa Airlines',
        priceProvenance: { sourceType: 'LIVE', provider: 'Ignav', partyTotalAmountUsd: 700, observedAt: '2026-11-19T09:06:00Z' },
        booking: { url: 'https://tp.media/r?x=1', liveBookingLinks: { ignavId: 'abcdefgh12', bookingProof: 'p' } } },
      { mode: 'flight', from: { city: 'Bogota', code: 'BOG' }, to: { city: 'Toronto', code: 'YYZ' }, departureDate: '2026-12-09', estimatedTransportUsd: 300, booking: { url: 'javascript:alert(1)' } }
    ],
    cities: [{ city: 'Bogota', nights: 6, hotel: { name: 'ibis Bogota Museo', rating: 8.4, checkIn: '2026-12-03', checkOut: '2026-12-09', agodaCityId: 2086,
      nuiteeLiveRate: { amount: 352.51, currency: 'CAD', sourceType: 'LIVE', refundableTag: 'NRFN', boardName: 'Room Only' },
      nuiteeWhitelabel: { url: 'https://wajeeh-4443-racp8.nuitee.link/hotels/lp57def?checkin=2026-12-03' } } }]
  };
}

test('rows are in travel order with live sources and links', () => {
  const { items } = v2.buildItems(tour(), now);
  assert.deepEqual(items.map(i => i.kind), ['flight', 'hotel', 'flight']);
  assert.equal(items[0].source, 'Live price · Ignav');
  assert.equal(items[0].age, 'checked 4 min ago');
  assert.equal(Math.round(items[0].price), 952);
  assert.ok(items[0].ignav);
  assert.equal(items[1].source, 'Live rate · Nuitee');
  assert.equal(items[1].price, 352.51);
  assert.equal(items[1].mainLabel, 'Book this hotel');
  assert.match(items[1].mainUrl, /nuitee\.link\/hotels\/lp57def/);
  assert.match(items[1].compareUrl, /agoda\.com\/search\?city=2086/);
  assert.equal(items[2].source, 'Estimated price');
  assert.equal(items[2].mainUrl, '', 'non-https links are dropped');
});

test('summary totals and budget left', () => {
  const t = tour();
  const { items, cur } = v2.buildItems(t, now);
  const s = v2.summaryOf(t, items, cur);
  assert.equal(s.route, 'Toronto → Bogota → Toronto');
  assert.equal(Math.round(s.total), Math.round(700 * 1.36 + 352.51 + 300 * 1.36));
  assert.equal(Math.round(s.left), Math.round(5000 - s.total));
  assert.equal(s.liveCount, 2);
});

test('estimate hotel without White Label falls back to Agoda', () => {
  const t = tour();
  delete t.cities[0].hotel.nuiteeLiveRate; delete t.cities[0].hotel.nuiteeWhitelabel;
  t.cities[0].hotel.name = 'Bogota central value stay'; t.cities[0].hotel.estimatedStayUsd = 200;
  const { items } = v2.buildItems(t, now);
  assert.equal(items[1].title, 'Hotel in Bogota');
  assert.equal(items[1].mainLabel, 'Find a hotel');
  assert.match(items[1].mainUrl, /agoda\.com/);
});
