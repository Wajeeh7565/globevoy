'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('../../web/node_modules/playwright');

test('the booking page waits for a click, joins rapid repeats, and labels search links as comparison', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'], executablePath: process.env.GLOBEVOY_TEST_BROWSER_PATH });
  try {
    const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent('<main id="gv-booking-v2"></main>');
    await page.evaluate(() => {
      window.GLOBEVOY_CONFIG = { apiBaseUrl: 'https://offline.example.test' };
      window.lookups = 0;
      window.attestations = 0;
      window.fetch = async (url, options) => {
        if (url.endsWith('/api/booking-evidence')) {
          window.attestations++;
          if (JSON.parse(options.body).token !== 'backend-token') throw Error('Unsigned quote');
          return { ok: true, json: async () => ({ ok: true, expiresAt: Date.now() + 60000, quote: window.GlobevoyBooking673FR1.tour }) };
        }
        window.lookups++;
        const { ignavId, bookingProof } = JSON.parse(options.body);
        if (ignavId !== 'mockflight123' || bookingProof !== 'offline-proof') throw Error('Unexpected identity');
        await new Promise(resolve => { window.releaseLookup = resolve; });
        return { json: async () => ({ ok: true, links: [
          { url: 'https://partner.example.test/search', providerName: 'Example Airline', providerType: 'airline', specificity: 'search_results' }
        ] }) };
      };
      window.GlobevoyBooking673FR1 = { tour: {
        bookingEvidence: 'backend-token',
        passengerPricing: { travellers: 1, adults: 1, rooms: 1 },
        backendLegs: [{ mode: 'flight', departureDate: '2027-02-12', from: { airportCode: 'YYZ' }, to: { airportCode: 'LIS' },
          booking: { liveBookingLinks: { ignavId: 'mockflight123', bookingProof: 'offline-proof',
            origin: 'YYZ', destination: 'LIS', departureDate: '2027-02-12', passengers: 1 } } }]
      } };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../frontend/runtime/api-client.js') });
    for (const file of ['booking-ignav-links.js', 'booking-trip-v2.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../../frontend/scripts', file) });
    }
    const action = page.getByRole('button', { name: 'See booking options' });
    await action.waitFor();
    assert.equal(await page.evaluate(() => window.lookups), 0);
    assert.equal(await page.evaluate(() => window.attestations), 1);
    await action.evaluate(button => { button.click(); button.click(); });
    assert.equal(await page.evaluate(() => window.lookups), 1);
    assert.equal(await page.getByRole('button', { name: 'Checking booking options…' }).isDisabled(), true);
    await page.evaluate(() => window.releaseLookup());
    await page.getByRole('link', { name: /Compare on Example Airline/ }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Book on Example Airline/ }).count(), 0);
    assert.equal(await page.evaluate(() => window.lookups), 1);
  } finally { await browser.close(); }
});

test('a trip reopened from Saved Trips opens no partner links until its prices are revalidated', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'], executablePath: process.env.GLOBEVOY_TEST_BROWSER_PATH });
  try {
    const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent('<main id="gv-booking-v2"></main>');
    await page.evaluate(() => {
      window.GLOBEVOY_CONFIG = { apiBaseUrl: 'https://offline.example.test' };
      window.calls = 0;
      window.fetch = async () => { window.calls++; throw Error('no network'); };
      window.GLOBEVOY_BOOKING_ACCOUNT_SNAPSHOT_706A = { snapshotOnly: true, requiresRevalidation: true };
      window.GlobevoyBooking673FR1 = { tour: {
        bookingEvidence: 'saved-token',
        passengerPricing: { travellers: 1, adults: 1, rooms: 1 },
        displayBudget: { currency: 'CAD', exchangeRateFromUsd: 1.4, tripEstimate: 900, totalBudget: 1500, reserveAmount: 150 },
        cities: [{ city: 'Lisbon', country: 'Portugal', nights: 3, hotel: { name: 'Example Hotel', estimatedStayUsd: 300,
          booking: { url: 'https://www.agoda.com/partners/partnersearch.aspx?hid=1' } } }],
        backendLegs: [
          { mode: 'flight', departureDate: '2027-02-12', from: { city: 'Toronto', airportCode: 'YYZ' }, to: { city: 'Lisbon', airportCode: 'LIS' },
            booking: { url: 'https://www.aviasales.com/search/YYZ1202LIS1', liveBookingLinks: { ignavId: 'mockflight123', bookingProof: 'proof' } } },
          { mode: 'flight', departureDate: '2027-02-15', from: { city: 'Lisbon', airportCode: 'LIS' }, to: { city: 'Toronto', airportCode: 'YYZ' },
            booking: { url: 'https://www.aviasales.com/search/LIS1502YYZ1' } }
        ]
      } };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../frontend/runtime/api-client.js') });
    for (const file of ['booking-ignav-links.js', 'booking-trip-v2.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../../frontend/scripts', file) });
    }
    await page.locator('#gv-booking-v2 .gvb2-item').first().waitFor();
    assert.equal(await page.locator('#gv-booking-v2 .gvb2-item').count(), 3);
    assert.equal(await page.locator('#gv-booking-v2 a[target]').count(), 0, 'no partner link is offered');
    assert.equal(await page.getByRole('button', { name: 'See booking options' }).count(), 0, 'no live link lookup is offered');
    assert.equal(await page.locator('#gv-booking-v2').getByText('Revalidation required', { exact: true }).count(), 3);
    assert.match(await page.locator('#gv-booking-v2').innerText(), /Saved account snapshot — verification required/);
    assert.equal(await page.evaluate(() => window.calls), 0, 'no quote check or provider request');
  } finally { await browser.close(); }
});
