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

test('Ignav evidence in canonicalPricing/providerVerification shows as live with the shown amount', () => {
  const t = tour();
  t.backendLegs[1] = { from: { city: 'Bogota', code: 'BOG' }, to: { city: 'Toronto', code: 'YYZ' }, departureDate: '2026-12-09',
    providerVerification: { sourceType: 'LIVE', provider: 'ignav-live-one-way', observedAt: '2026-11-19T09:08:00Z' },
    canonicalPricing: { kind: 'flight', amountUsd: 151, amountDisplay: 205, currency: 'CAD', evidence: { sourceType: 'LIVE', provider: 'ignav-live-one-way', observedAt: '2026-11-19T09:08:00Z' } } };
  const { items } = v2.buildItems(t, now);
  assert.equal(items[2].source, 'Live price · Ignav');
  assert.equal(items[2].price, 205);
  assert.equal(items[2].age, 'checked 2 min ago');
  assert.equal(items[2].mainLabel, 'Compare flights');
});

test('bestLink prefers the airline, then exact flight, then cheapest; drops non-https', () => {
  const pick = v2.bestLink([
    { providerName: 'Waya', providerType: 'ota', amount: 250, url: 'https://waya.example/x' },
    { providerName: 'Evil', providerType: 'airline', amount: 1, url: 'http://evil.example' },
    { providerName: 'United', providerType: 'airline', amount: 280, url: 'https://united.com/x' },
    { providerName: 'United', providerType: 'airline', amount: 274, url: 'https://united.com/y' }
  ]);
  assert.equal(pick.url, 'https://united.com/y');
  assert.equal(v2.bestLink([]), null);
});

test('total matches the site total: extras line and reserve', () => {
  const t = tour(); t.displayBudget.tripEstimate = 2000; t.displayBudget.reserveAmount = 250;
  const { items, cur } = v2.buildItems(t, now);
  const s = v2.summaryOf(t, items, cur);
  assert.equal(Math.round(s.total), 2000);
  assert.ok(s.extras > 0);
  assert.equal(Math.round(s.left), 5000 - 250 - 2000);
});

test('fresh Nuitee offer: Book this room → checkout; stale offer: hotel page', () => {
  const t = tour();
  const hotel = t.cities[0].hotel;
  const occupancy = Buffer.from(JSON.stringify([{ adults: 1, children: [] }])).toString('base64');
  hotel.nuiteeHotelId = 'lp57def';
  hotel.nuiteeLiveRate.checkin = hotel.checkIn;
  hotel.nuiteeLiveRate.checkout = hotel.checkOut;
  const property = new URL(hotel.nuiteeWhitelabel.url);
  property.searchParams.set('checkout', hotel.checkOut);
  property.searchParams.set('occupancies', occupancy);
  hotel.nuiteeWhitelabel.url = property.toString();
  t.cities[0].hotel.nuiteeWhitelabel.checkoutUrl = 'https://wajeeh-4443-racp8.nuitee.link/booking?offerId=offer-1';
  t.cities[0].hotel.nuiteeWhitelabel.offerObservedAt = '2026-11-19T09:00:00Z';
  let { items } = v2.buildItems(t, now); // 10 min old
  assert.equal(items[1].mainLabel, 'Book this room');
  assert.match(items[1].mainUrl, /\/booking\?offerId=offer-1$/);
  assert.match(items[1].altUrl, /\/hotels\/lp57def/);
  ({ items } = v2.buildItems(t, Date.parse('2026-11-19T10:30:00Z'))); // 90 min old
  assert.equal(items[1].mainLabel, 'Book this hotel');
  assert.match(items[1].mainUrl, /\/hotels\/lp57def/);
  assert.equal(items[1].altUrl, '');
  t.passengerPricing.adults = 2;
  ({ items } = v2.buildItems(t, now));
  assert.equal(items[1].mainLabel, 'Find a hotel', 'a different party cannot inherit the room offer');
  t.passengerPricing.adults = 1;
  t.cities[0].arrivalDate = '2026-12-04';
  ({ items } = v2.buildItems(t, now));
  assert.equal(items[1].mainLabel, 'Find a hotel', 'a changed arrival date cannot inherit the room offer');
});

// GV-HOTEL-FEES-001: the booking page shows the hotel site's checkout price, plus local taxes
// paid at the hotel as their own line, so the total still matches the results page.
test('local taxes paid at the hotel: own line, not "transfers & extras"; total matches the site', () => {
  const t = tour();
  t.cities[0].hotel.nuiteeLiveRate.payAtHotelAmount = 41.5;
  t.displayBudget.tripEstimate = Math.round(700 * 1.36 + 352.51 + 41.5 + 300 * 1.36);
  const { items, cur } = v2.buildItems(t, now);
  const hotel = items.find(i => i.kind === 'hotel');
  assert.equal(hotel.price, 352.51, 'checkout price, as on the hotel site');
  assert.equal(hotel.payAtHotel, 41.5);
  assert.match(hotel.detail, /plus C\$42 local taxes paid at the hotel/);
  const s = v2.summaryOf(t, items, cur);
  assert.equal(s.payAtHotel, 41.5);
  assert.equal(s.extras, 0, 'the fee is not mislabelled as transfers');
  assert.equal(Math.round(s.total), t.displayBudget.tripEstimate);
});


test('fresh backend quote wins over editable prices, while changed trips must revalidate', async () => {
  const base = tour();
  const browser = structuredClone(base);
  browser.bookingEvidence = 'opaque-signed-quote';
  browser.cities[0].hotel.nuiteeLiveRate.amount = 1;
  const previous = globalThis.GLOBEVOY_CONFIG;
  globalThis.GLOBEVOY_CONFIG = { apiBaseUrl: 'https://offline.example.test' };
  const fetch = async (url, request) => {
    assert.match(url, /booking-evidence$/);
    assert.deepEqual(JSON.parse(request.body), { token: 'opaque-signed-quote' });
    return { ok: true, json: async () => ({ ok: true, expiresAt: Date.now() + 5000, quote: base }) };
  };
  try {
    for (let visit = 0; visit < 2; visit++) {
      const evidence = await v2.readVerifiedQuote(browser, fetch);
      assert.equal(v2.buildItems(evidence.quote, now).items[1].price, 352.51);
    }
    browser.cities[0].hotel.checkOut = '2026-12-11';
    assert.equal(await v2.readVerifiedQuote(browser, fetch), null);
  } finally { globalThis.GLOBEVOY_CONFIG = previous; }
});
