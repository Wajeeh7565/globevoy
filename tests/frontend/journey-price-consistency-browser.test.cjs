'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../web/node_modules/playwright');
const { attachTourPresentation, currencyToUsdRate } = require('../../backend/services/domain/pricing/budget-presentation');
const { issue, verify } = require('../../backend/services/domain/pricing/booking-evidence');

const SITE = 'https://offline.globevoy.test';
const SECRET = { BOOKING_EVIDENCE_SIGNING_KEY: 'offline-journey-fixture' };
const PACKAGED_ROOT = process.env.GLOBEVOY_TEST_FRONTEND_ROOT;
const ROOT = path.resolve(PACKAGED_ROOT || path.resolve(__dirname, '../../frontend'));
const origin = { cityId: 'toronto-ca', city: 'Toronto', airportCode: 'YYZ', country: 'Canada', latitude: 43.65, longitude: -79.38 };
const destinations = [
  { cityId: 'montreal-ca', city: 'Montreal', airportCode: 'YUL', country: 'Canada', latitude: 45.50, longitude: -73.57 },
  { cityId: 'boston-us', city: 'Boston', airportCode: 'BOS', country: 'United States', latitude: 42.36, longitude: -71.06 },
  { cityId: 'new-york-us', city: 'New York', airportCode: 'JFK', country: 'United States', latitude: 40.71, longitude: -74.00 }
];
const tripDates = ['2027-05-01','2027-05-06','2027-05-09','2027-05-12'];

function fixture({ size, currency, adults, rooms, validity = 'valid' }) {
  const now = Date.now();
  const observedAt = new Date(now - (validity === 'expired' ? 16 * 60000 : 0)).toISOString();
  const comparable = currencyToUsdRate(currency);
  const fare = size === 1 ? 170 : 170.49;
  const reservation = { adults, children: 0, infants: 0, travellers: adults, rooms,
    occupancies: Array.from({ length: rooms }, (_, index) => ({ adults: index === 0 ? adults - (rooms - 1) : 1, children: [] })) };
  const cities = destinations.slice(0, size).map((node, i) => ({
    ...node, nights: i ? 3 : 5, arrivalDate: tripDates[i], departureDate: tripDates[i + 1],
    hotel: { name: node.city + ' fixture hotel', nuiteeHotelId: 'test-hotel-' + i, livePriceVerified: true,
      estimatedStayUsd: Math.round((342 + i) * comparable),
      checkIn: tripDates[i], checkOut: tripDates[i + 1],
      nuiteeLiveRate: { sourceType: 'LIVE', amount: 330 + i, payAtHotelAmount: 12, currency,
        totalUsd: Math.round((342 + i) * comparable), roomName: 'Double',
        checkin: tripDates[i], checkout: tripDates[i + 1], observedAt } }
  }));
  const nodes = [origin, ...cities, origin];
  const legs = nodes.slice(0, -1).map((from, i) => ({
    from, to: nodes[i + 1], mode: 'flight', departureDate: tripDates[i], liveFareVerified: true,
    estimatedTransportUsd: Math.round(fare * comparable),
    providerDateEvidence: { sourceType: 'LIVE', productionEligible: true, exactDateMatch: true,
      departureDate: tripDates[i], providerPartyTotalAmount: fare, providerCurrency: currency, observedAt }
  }));
  const flightsUsd = legs.reduce((s, l) => s + l.estimatedTransportUsd, 0);
  const hotelsUsd = cities.reduce((s, c) => s + c.hotel.estimatedStayUsd, 0);
  const tour = attachTourPresentation({
    tourId: 'smoke-price-' + size, title: cities.map(c => c.city).join(' + '), tourRole: 'best-balance',
    fareMap: { arrivalDatesVerified: true }, origin, legs, backendLegs: legs, cities, stops: cities,
    passengerPricing: reservation, totalFlightEstimateUsd: flightsUsd, totalHotelEstimateUsd: hotelsUsd,
    estimatedTotalUsd: flightsUsd + hotelsUsd, totalBudgetUsd: 2500 * comparable,
    budget: { total: { amount: 2500, currency }, estimatedCoreTotal: { amount: 1122, currency } },
    itineraryDatePlan: { canonicalDepartureDate: tripDates[0], canonicalReturnDate: tripDates[size] }
  }, { budget: 2500, currency });
  const quote = tour.displayBudget;
  const exactTotal = fare * (size + 1) + cities.reduce((sum, _, i) => sum + 342 + i, 0);
  assert.equal(quote.lineItems.exactTotal, Math.round(exactTotal * 100) / 100);
  assert.equal(quote.tripEstimate, Math.round(exactTotal));
  assert.equal(quote.flightEstimate + quote.accommodationEstimate, quote.tripEstimate);
  assert.equal(tour.budget.estimatedCoreTotal.amount, quote.tripEstimate);
  assert.equal(quote.reserveAmount, 250);
  assert.equal(quote.amountLeft, 2250 - quote.tripEstimate);
  tour.bookingEvidence = issue(tour, SECRET, validity === 'expired' ? now - 16 * 60000 : now);
  // Recreate a v5-era stale legacy budget field in the saved/browser snapshot.
  tour.budget.estimatedCoreTotal.amount = 1122;
  if (validity === 'valid' && size === 1) {
    tour.displayBudget = { ...quote, tripEstimate: 1122, amountLeft: 1128 };
  }
  if (validity === 'invalid') tour.bookingEvidence += '!';
  if (validity === 'missing') delete tour.bookingEvidence;
  if (validity === 'mismatch') tour.passengerPricing.occupancies[0].adults++;
  return { tour, quote, validity };
}

function localFile(url) {
  if (PACKAGED_ROOT) return path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  if (url.pathname === '/') return path.join(ROOT, 'pages/index.html');
  if (/^\/[^/]+\.html$/.test(url.pathname)) return path.join(ROOT, 'pages', url.pathname.slice(1));
  return path.join(ROOT, url.pathname.slice(1));
}

async function visit(browser, data, { mobile, member }) {
  const context = await browser.newContext({ viewport: mobile ? {width:390,height:844} : {width:1440,height:900},
    isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const errors = [];
  const search = [];
  const pricing = [];
  const attestations = [];
  const { tour, quote, validity } = data;
  const live = validity === 'valid';
  try {
    await context.addInitScript(isMember => {
      if (isMember) sessionStorage.setItem('globevoy.auth.session.705b-r3', JSON.stringify({
        version:'GV-ACCOUNT-705B-R3', accessToken:'offline-fixture', expiresAt:Date.now()+3600000, user:{sub:'fixture-user'}
      }));
    }, member);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== SITE) return route.abort();
      if (url.pathname === '/runtime/config.js') return route.fulfill({ contentType: 'text/javascript',
        body: 'window.GLOBEVOY_CONFIG={apiBaseUrl:"' + SITE + '",enableLiveApi:true};' });
      if (url.pathname === '/api/generated-tour') {
        search.push(url.searchParams.get('poolShow'));
        return route.fulfill({ json:{ok:true,poolMode:true,tour,tours:[tour],poolSize:1,poolRemaining:0} });
      }
      if (url.pathname === '/api/booking-evidence') {
        attestations.push(route.request().method());
        const data = verify(route.request().postDataJSON()?.token, SECRET);
        return route.fulfill({ status:data ? 200 : 400, json:data ? {...data,ok:true} : {ok:false} });
      }
      if (url.pathname.startsWith('/api/')) {
        if (/fare|price|hotel|generated|recommendation|booking-link/i.test(url.pathname)) pricing.push(url.pathname);
        return route.abort();
      }
      const assetPath = localFile(url);
      return fs.existsSync(assetPath) && fs.statSync(assetPath).isFile() ? route.fulfill({path:assetPath}) : route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const readMoney = async selector => Number((await page.locator(selector).innerText()).replace(/[^0-9]/g, ''));
    const url = SITE + '/results.html?origin=Toronto%20%28YYZ%29&budget=2500&adults=' + tour.passengerPricing.adults + '&currency=' + quote.currency;
    await page.goto(url);
    await page.locator('#results').waitFor({state:'visible'});
    assert.equal(await readMoney('#summary-total'), quote.tripEstimate);
    const resultsLines = (await page.locator('#summary-list dd').allTextContents()).map(text => Number(text.replace(/[^0-9]/g, '')));
    assert.deepEqual(resultsLines, [quote.flightEstimate, quote.accommodationEstimate, quote.reserveAmount, quote.amountLeft]);
    assert.match(await page.locator('#live-note').innerText(), live ? /Live prices/ : /verification required/);
    assert.deepEqual(search, [member ? '3' : '1']);
    await page.reload();
    await page.locator('#results').waitFor({state:'visible'});
    assert.equal(search.length, 1, 'results refresh reuses the cached search');
    const details = await page.locator('#book').getAttribute('href');
    await page.goto(new URL(details, SITE).href);
    await page.locator('#gv-mtd-app').waitFor({state:'visible'});
    assert.equal(await readMoney('#gv-mtd-total'), quote.tripEstimate);
    assert.equal(await readMoney('#gv-mtd-remaining'), quote.amountLeft);
    assert.equal(await readMoney('#gv-mtd-budget-total'), quote.totalBudget);
    assert.equal((await page.locator('#gv-mtd-timeline').innerText()).includes('Live rate'), live);
    await page.reload();
    await page.locator('#gv-mtd-app').waitFor({state:'visible'});
    assert.equal(await readMoney('#gv-mtd-total'), quote.tripEstimate);
    await page.locator('#gv-mtd-booking').click();
    await page.locator('#gv-booking-v2 .gvb2-total strong').waitFor();
    await page.waitForFunction(wanted => document.querySelector('#gv-booking-v2')?.innerText.includes('Live rate') === wanted, live);
    assert.equal(await readMoney('#gv-booking-v2 .gvb2-total strong'), quote.tripEstimate);
    assert.match(await page.locator('#gv-booking-v2').innerText(), /local taxes paid at the hotel/);
    const bookingAmount = label => readMoney('#gv-booking-v2 .gvb2-line:has-text("' + label + '") :last-child');
    assert.equal(await bookingAmount('Flights ('), quote.flightEstimate);
    assert.equal(await bookingAmount('Hotels ('), quote.lineItems.stays.reduce((sum, stay) => sum + stay.room, 0));
    assert.equal(await bookingAmount('Safety reserve'), quote.reserveAmount);
    const checks = attestations.length;
    await page.reload();
    await page.locator('#gv-booking-v2 .gvb2-total strong').waitFor();
    if (validity !== 'missing') {
      await page.waitForFunction(wanted => document.querySelector('#gv-booking-v2')?.innerText.includes('Live rate') === wanted, live);
      assert.ok(attestations.length >= checks + 1);
    }
    assert.equal(await readMoney('#gv-booking-v2 .gvb2-total strong'), quote.tripEstimate);
    await page.goto(new URL(details.replace('multi-city-trip.html?', 'results.html?'), SITE).href);
    await page.locator('#results').waitFor({state:'visible'});
    assert.match(await page.locator('#options-heading').innerText(), /Your saved trip/);
    assert.equal(await readMoney('#summary-total'), quote.tripEstimate);
    assert.equal(search.length,1,'saved trip reopening reuses its pricing snapshot');
    assert.deepEqual(pricing, []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

test('the same signed pricing breakdown survives the classic customer journey', { timeout: 90000 }, async t => {
  const browser = await chromium.launch({ headless:true, executablePath:process.env.GLOBEVOY_TEST_BROWSER_PATH,
    args:['--disable-background-networking'] });
  try {
    const cases = [
      { size:1, currency:'CAD', adults:1, rooms:1, mobile:false, member:false },
      { size:2, currency:'USD', adults:3, rooms:2, mobile:true, member:true },
      { size:3, currency:'GBP', adults:2, rooms:2, mobile:false, member:true },
      ...['expired','invalid','missing','mismatch'].map(validity => ({
        size:1,currency:'CAD',adults:1,rooms:1,mobile:true,member:false,validity
      }))
    ];
    for(const options of cases) await t.test(JSON.stringify(options), () => visit(browser, fixture(options), options));
  } finally { await browser.close(); }
});
