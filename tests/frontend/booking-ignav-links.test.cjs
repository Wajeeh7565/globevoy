'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mod = require('../../frontend/scripts/booking-ignav-links.js');

const tour = { backendLegs: [
  { mode: 'flight', booking: { liveBookingLinks: { ignavId: 'idYYZLIS00', bookingProof: 'proof-fixture', endpoint: '/api/flight-booking-links' } } },
  { mode: 'ground', transportType: 'rail' },
  { mode: 'flight', booking: {} },
  { mode: 'flight', booking: { liveBookingLinks: { ignavId: 'bad id!' } } }
] };

test('lookups follow Booking Hub flight order and reject bad ids', () => {
  assert.deepEqual(mod.flightLookups(tour), [{ ignavId: 'idYYZLIS00', bookingProof: 'proof-fixture', endpoint: '/api/flight-booking-links' }, null, null]);
});

test('links render escaped, https-only, honest labels', () => {
  const html = mod.linksHtml({ ok: true, links: [
    { providerName: 'FlightHub <x>', providerType: 'third_party', amount: 482, currency: 'CAD', specificity: 'unknown', url: 'https://www.flighthub.com/a' },
    { providerName: 'Azores Airlines', providerType: 'airline', amount: 549, currency: 'CAD', specificity: 'exact_flight', url: 'https://book.azoresairlines.pt/x' },
    { providerName: 'Bad', url: 'javascript:alert(1)' }
  ] });
  assert.match(html, /FlightHub &lt;x&gt;/);
  assert.match(html, /CAD C\$482/);
  assert.match(html, /May open a search page/);
  assert.match(html, /Flight preselected/);
  assert.match(html, /does not earn a referral fee/);
  assert.doesNotMatch(html, /javascript:/);
});

test('fetchLinks posts only the id and server-issued proof to GlobeVoy backend', async () => {
  const seen = [];
  globalThis.GLOBEVOY_CONFIG = { apiBaseUrl: 'https://api.example.test/' };
  const r = await mod.fetchLinks({ ignavId: 'idYYZLIS00', bookingProof: 'proof-fixture', endpoint: '/api/flight-booking-links' }, async (url, init) => { seen.push({ url, init }); return { json: async () => ({ ok: true, links: [] }) }; });
  assert.equal(r.ok, true);
  assert.equal(seen[0].url, 'https://api.example.test/api/flight-booking-links');
  assert.deepEqual(JSON.parse(seen[0].init.body), { ignavId: 'idYYZLIS00', bookingProof: 'proof-fixture' });
  delete globalThis.GLOBEVOY_CONFIG;
});

test('booking page loads the script after the Booking Hub', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../frontend/pages/booking.html'), 'utf8');
  assert.ok(html.indexOf('booking-ignav-links.js') > html.indexOf('booking-hub-685d.js'));
});

test('stay White Label links: only https Nuitee/GlobeVoy hosts are accepted', () => {
  const links = mod.stayWhitelabels({ cities: [
    { hotel: { name: 'Good Value', booking: { whitelabel: { url: 'https://wajeeh-4443-racp8.nuitee.link/hotels/lpB?checkin=2027-03-12' } } } },
    { hotel: { booking: { whitelabel: { url: 'https://evil.example.com/hotels/x' } } } },
    { hotel: {} }
  ] });
  assert.equal(links[0].name, 'Good Value');
  assert.match(links[0].url, /nuitee\.link\/hotels\/lpB/);
  assert.equal(links[1], null);
  assert.equal(links[2], null);
});


test('a matching booking-link click joins the in-flight lookup and a later click is fresh', async () => {
  const previous = globalThis.GLOBEVOY_CONFIG;
  globalThis.GLOBEVOY_CONFIG = { apiBaseUrl: 'https://api.example.test/' };
  try {
    let calls = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const fetch = async () => { calls++; await gate; return { json: async () => ({ ok: true }) }; };
    const link = mod.flightLookups(tour)[0];
    const pair = [mod.fetchLinks(link, fetch), mod.fetchLinks(link, fetch)];
    assert.equal(calls, 1);
    release();
    await Promise.all(pair);
    await mod.fetchLinks(link, fetch);
    assert.equal(calls, 2);
  } finally { globalThis.GLOBEVOY_CONFIG = previous; }
});

test('a selected flight change detaches the original provider booking link', () => {
  const leg = { ...tour.backendLegs[0], from: { airportCode: 'YYZ' }, to: { airportCode: 'LIS' }, departureDate: '2027-02-12' };
  leg.booking = { liveBookingLinks: { ...leg.booking.liveBookingLinks, origin: 'YYZ', destination: 'LIS', departureDate: '2027-02-12', passengers: 2 } };
  assert.ok(mod.flightLookup(leg, { travellers: 2 }));
  assert.equal(mod.flightLookup(leg, { travellers: 3 }), null);
  assert.equal(mod.flightLookup({ ...leg, departureDate: '2027-02-13' }), null);
  assert.equal(mod.flightLookup({ ...leg, to: { airportCode: 'OPO' } }), null);
});
