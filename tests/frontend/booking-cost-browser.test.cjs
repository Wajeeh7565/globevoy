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
      window.fetch = async (_url, options) => {
        window.lookups++;
        const { ignavId, bookingProof } = JSON.parse(options.body);
        if (ignavId !== 'mockflight123' || bookingProof !== 'offline-proof') throw Error('Unexpected identity');
        await new Promise(resolve => { window.releaseLookup = resolve; });
        return { json: async () => ({ ok: true, links: [
          { url: 'https://partner.example.test/search', providerName: 'Example Airline', providerType: 'airline', specificity: 'search_results' }
        ] }) };
      };
      window.GlobevoyBooking673FR1 = { tour: {
        passengerPricing: { travellers: 1, adults: 1, rooms: 1 },
        backendLegs: [{ mode: 'flight', departureDate: '2027-02-12', from: { airportCode: 'YYZ' }, to: { airportCode: 'LIS' },
          booking: { liveBookingLinks: { ignavId: 'mockflight123', bookingProof: 'offline-proof',
            origin: 'YYZ', destination: 'LIS', departureDate: '2027-02-12', passengers: 1 } } }]
      } };
    });
    for (const file of ['booking-ignav-links.js', 'booking-trip-v2.js']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../../frontend/scripts', file) });
    }
    const action = page.getByRole('button', { name: 'See booking options' });
    await action.waitFor();
    assert.equal(await page.evaluate(() => window.lookups), 0);
    await action.evaluate(button => { button.click(); button.click(); });
    assert.equal(await page.evaluate(() => window.lookups), 1);
    assert.equal(await page.getByRole('button', { name: 'Checking booking options…' }).isDisabled(), true);
    await page.evaluate(() => window.releaseLookup());
    await page.getByRole('link', { name: /Compare on Example Airline/ }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Book on Example Airline/ }).count(), 0);
    assert.equal(await page.evaluate(() => window.lookups), 1);
  } finally { await browser.close(); }
});
