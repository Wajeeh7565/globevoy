#!/usr/bin/env node

import fs from 'node:fs';

const VERSION = 'GV-HOTEL-708B';
const RATE_URL = 'https://api.liteapi.travel/v3.0/hotels/rates';
const PREBOOK_URL = 'https://book.liteapi.travel/v3.0/rates/prebook';
const KEY_ENV = 'NUITEE_SANDBOX_API_KEY';
const DEFAULTS = {
  checkin: '2026-10-13',
  checkout: '2026-10-16',
  currency: 'CAD',
  guestNationality: 'CA'
};
const CITIES = [
  { cityName: 'Toronto', countryCode: 'CA' },
  { cityName: 'Dublin', countryCode: 'IE' },
  { cityName: 'Antalya', countryCode: 'TR' }
];

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function isoDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  return value;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSearchBody(city, options) {
  return {
    occupancies: [{ adults: 1 }],
    currency: options.currency,
    guestNationality: options.guestNationality,
    checkin: options.checkin,
    checkout: options.checkout,
    cityName: city.cityName,
    countryCode: city.countryCode,
    timeout: 10,
    limit: 8,
    maxRatesPerHotel: 1,
    roomMapping: true,
    includeHotelData: true,
    stream: false
  };
}

async function postJson(url, body, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { unparsed: true }; }
    }
    return { status: response.status, latencyMs: Date.now() - started, payload };
  } finally {
    clearTimeout(timer);
  }
}

function hotelName(hotel) {
  return String(hotel?.name || hotel?.hotelName || hotel?.hotel?.name || hotel?.hotel?.hotelName || '').trim();
}

function hasVisualContent(value, depth = 0) {
  if (!value || depth > 5) return false;
  if (typeof value === 'string') return /^https?:\/\//i.test(value) && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(value);
  if (Array.isArray(value)) return value.some((item) => hasVisualContent(item, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => {
    if (/(photo|image|thumbnail)/i.test(key) && hasVisualContent(item, depth + 1)) return true;
    return depth < 2 && hasVisualContent(item, depth + 1);
  });
}

function offerFromRoomType(hotel, roomType) {
  const rate = Array.isArray(roomType?.rates) ? roomType.rates[0] : null;
  const offerRetail = roomType?.offerRetailRate || {};
  const rateTotal = rate?.retailRate?.total?.[0] || {};
  const amount = finite(offerRetail.amount) ?? finite(rateTotal.amount);
  const currency = String(offerRetail.currency || rateTotal.currency || '').trim();
  const taxes = Array.isArray(rate?.retailRate?.taxesAndFees) ? rate.retailRate.taxesAndFees : [];
  return {
    hotelName: hotelName(hotel),
    hotelIdPresent: Boolean(hotel?.hotelId || hotel?.id),
    hotelContentPresent: Boolean(hotelName(hotel) || hotel?.address || hotel?.hotel?.address),
    photoPresent: hasVisualContent(hotel),
    offerId: typeof roomType?.offerId === 'string' ? roomType.offerId : '',
    amount,
    currency,
    roomName: String(rate?.name || '').trim(),
    boardName: String(rate?.boardName || rate?.boardType || '').trim(),
    refundableTag: String(rate?.cancellationPolicies?.refundableTag || '').trim(),
    cancellationDetailsPresent: Array.isArray(rate?.cancellationPolicies?.cancelPolicyInfos),
    taxesAndFeesPresent: Array.isArray(rate?.retailRate?.taxesAndFees),
    excludedFeesPresent: taxes.some((fee) => fee?.included === false)
  };
}

function summarizeSearch(city, result) {
  const hotels = Array.isArray(result.payload?.data) ? result.payload.data : [];
  const offers = [];
  for (const hotel of hotels) {
    const roomTypes = Array.isArray(hotel?.roomTypes) ? hotel.roomTypes : [];
    for (const roomType of roomTypes) offers.push(offerFromRoomType(hotel, roomType));
  }
  const priced = offers.filter((offer) => offer.amount !== null && offer.amount > 0 && offer.offerId);
  priced.sort((a, b) => a.amount - b.amount);
  const refundable = priced.filter((offer) => offer.refundableTag === 'RFN');
  const selected = refundable[0] || priced[0] || null;
  return {
    city: city.cityName,
    countryCode: city.countryCode,
    status: result.status,
    latencyMs: result.latencyMs,
    hotelCount: hotels.length,
    offerCount: offers.length,
    pricedOfferCount: priced.length,
    contentHotelCount: hotels.filter((hotel) => Boolean(hotelName(hotel) || hotel?.address || hotel?.hotel?.address)).length,
    photoHotelCount: hotels.filter((hotel) => hasVisualContent(hotel)).length,
    cheapest: selected ? {
      hotelName: selected.hotelName || '(hotel name not returned)',
      amount: selected.amount,
      currency: selected.currency,
      refundableTag: selected.refundableTag || 'UNKNOWN',
      roomName: selected.roomName || '(room name not returned)',
      boardName: selected.boardName || 'UNKNOWN',
      cancellationDetailsPresent: selected.cancellationDetailsPresent,
      taxesAndFeesPresent: selected.taxesAndFeesPresent,
      excludedFeesPresent: selected.excludedFeesPresent
    } : null,
    _selectedOfferId: selected?.offerId || ''
  };
}

function prebookPrice(payload) {
  const data = payload?.data || {};
  const direct = finite(data.price);
  if (direct !== null) return { amount: direct, currency: String(data.currency || '').trim() };
  let sum = 0;
  let currency = '';
  let found = false;
  for (const roomType of Array.isArray(data.roomTypes) ? data.roomTypes : []) {
    for (const rate of Array.isArray(roomType?.rates) ? roomType.rates : []) {
      const total = rate?.retailRate?.total?.[0];
      const amount = finite(total?.amount);
      if (amount !== null) {
        sum += amount;
        currency = currency || String(total?.currency || '').trim();
        found = true;
      }
    }
  }
  return found ? { amount: sum, currency } : { amount: null, currency: '' };
}

function prebookEvidence(payload) {
  const data = payload?.data || {};
  let refundableTag = '';
  let cancellationDetailsPresent = false;
  let taxesAndFeesPresent = false;
  let excludedFeesPresent = false;
  for (const roomType of Array.isArray(data.roomTypes) ? data.roomTypes : []) {
    for (const rate of Array.isArray(roomType?.rates) ? roomType.rates : []) {
      refundableTag ||= String(rate?.cancellationPolicies?.refundableTag || '').trim();
      cancellationDetailsPresent ||= Array.isArray(rate?.cancellationPolicies?.cancelPolicyInfos);
      const fees = rate?.retailRate?.taxesAndFees;
      taxesAndFeesPresent ||= Array.isArray(fees);
      if (Array.isArray(fees)) excludedFeesPresent ||= fees.some((fee) => fee?.included === false);
    }
  }
  return { refundableTag: refundableTag || 'UNKNOWN', cancellationDetailsPresent, taxesAndFeesPresent, excludedFeesPresent };
}

async function main() {
  const dryRun = hasFlag('dry-run');
  const doPrebook = hasFlag('prebook');
  const options = {
    checkin: isoDate(argValue('checkin', DEFAULTS.checkin), 'checkin'),
    checkout: isoDate(argValue('checkout', DEFAULTS.checkout), 'checkout'),
    currency: argValue('currency', DEFAULTS.currency).toUpperCase(),
    guestNationality: argValue('guest-nationality', DEFAULTS.guestNationality).toUpperCase()
  };
  if (options.checkout <= options.checkin) throw new Error('checkout must be after checkin');

  console.log(`=== ${VERSION} Nuitee/LiteAPI sandbox evaluation ===`);
  console.log(`Dates: ${options.checkin} -> ${options.checkout}; 1 adult; ${options.currency}; nationality ${options.guestNationality}`);
  console.log(`Mode: ${doPrebook ? 'SEARCH + PREBOOK verification' : 'SEARCH only'}`);
  console.log('Safety: this harness contains no BOOK endpoint and performs no payment or reservation.');

  if (dryRun) {
    for (const city of CITIES) console.log(JSON.stringify(buildSearchBody(city, options)));
    if (doPrebook) console.log('PREBOOK body template: {"offerId":"<selected offer, never printed>","usePaymentSdk":false}');
    console.log('DRY RUN PASS');
    return;
  }

  const apiKey = process.env[KEY_ENV];
  if (!apiKey) throw new Error(`${KEY_ENV} is not set. Keep the key in your shell environment; do not paste it into chat or commit it.`);

  const summaries = [];
  for (const city of CITIES) {
    const search = await postJson(RATE_URL, buildSearchBody(city, options), apiKey);
    const summary = summarizeSearch(city, search);
    summaries.push(summary);
    console.log(`\n[${city.cityName}] SEARCH HTTP ${summary.status}; ${summary.latencyMs} ms; hotels=${summary.hotelCount}; offers=${summary.offerCount}; priced=${summary.pricedOfferCount}`);
    console.log(`  content hotels=${summary.contentHotelCount}; photo hotels=${summary.photoHotelCount}`);
    if (summary.cheapest) {
      const c = summary.cheapest;
      console.log(`  selected=${c.hotelName}; ${c.amount} ${c.currency}; ${c.refundableTag}; room=${c.roomName}; board=${c.boardName}`);
      console.log(`  cancellation-details=${c.cancellationDetailsPresent}; taxes-fees-field=${c.taxesAndFeesPresent}; excluded-fees=${c.excludedFeesPresent}`);
    } else {
      console.log('  no priced offer selected');
    }

    if (doPrebook && summary._selectedOfferId) {
      await sleep(350);
      const prebook = await postJson(PREBOOK_URL, { offerId: summary._selectedOfferId, usePaymentSdk: false }, apiKey);
      const final = prebookPrice(prebook.payload);
      const evidence = prebookEvidence(prebook.payload);
      const searchPrice = summary.cheapest?.amount ?? null;
      const delta = final.amount !== null && searchPrice !== null ? final.amount - searchPrice : null;
      summary.prebook = {
        status: prebook.status,
        latencyMs: prebook.latencyMs,
        finalAmount: final.amount,
        currency: final.currency,
        deltaFromSearch: delta,
        ...evidence
      };
      console.log(`  PREBOOK HTTP ${prebook.status}; ${prebook.latencyMs} ms; final=${final.amount ?? 'n/a'} ${final.currency || ''}; delta=${delta ?? 'n/a'}`);
      console.log(`  PREBOOK cancellation=${evidence.refundableTag}; cancellation-details=${evidence.cancellationDetailsPresent}; taxes-fees-field=${evidence.taxesAndFeesPresent}; excluded-fees=${evidence.excludedFeesPresent}`);
    }

    await sleep(350);
  }

  const clean = summaries.map(({ _selectedOfferId, ...summary }) => summary);
  const output = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    environment: 'sandbox',
    bookingAttempted: false,
    paymentAttempted: false,
    criteria: options,
    cities: clean
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `GV-HOTEL-708B-Nuitee-${stamp}.json`;
  fs.writeFileSync(file, JSON.stringify(output, null, 2));
  console.log(`\nSafe summary written: ${file}`);
  console.log('The file contains no API key, offerId, prebookId, payment secret, or raw provider response.');
}

main().catch((error) => {
  console.error(`FAIL: ${error?.message || error}`);
  process.exitCode = 1;
});
