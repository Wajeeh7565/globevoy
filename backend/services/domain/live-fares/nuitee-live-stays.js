'use strict';

// GV-HOTEL-NUITEE-WL-001 — live Nuitee hotel rates for the FINAL selected tour,
// handed off to GlobeVoy's Nuitee White Label site.
//
// - Search only (POST /hotels/rates). No Prebook, no booking, no payment.
//   The White Label site is Nuitee's checkout; Nuitee is merchant of record.
// - Per stop: if Nuitee returns a usable production rate in the request
//   currency, that hotel and price replace the planning estimate and the stay
//   gets a White Label hotel-page link with the same dates and occupancy.
//   Otherwise the stop keeps its previous hotel/price and Agoda link.
// - Off unless ENABLE_NUITEE_LIVE_STAYS=true and NUITEE_SECRET_ID is set.

const nuitee = require('../../providers/stays/nuitee/nuitee-hotel-708c');
const { applyTravellerPricingToTour } = require('../pricing/traveller-pricing');
const { currencyToUsdRate, normalizeCurrency } = require('../pricing/budget-presentation');

const VERSION = 'GV-HOTEL-NUITEE-WL-001';
const FLAG = 'ENABLE_NUITEE_LIVE_STAYS';
const DEFAULT_WL_DOMAIN = 'wajeeh-4443-racp8.nuitee.link';
const MAX_STOPS = 4;
const GOOD_RATING = 7.0;
const RATE_URL = nuitee.RATE_URL;
const internal = nuitee._internal;

function clean(v) { return String(v == null ? '' : v).trim(); }
function enabled(env = process.env) {
  return clean(env[FLAG]).toLowerCase() === 'true' && Boolean(clean(env.NUITEE_SECRET_ID));
}
function whitelabelDomain(env = process.env) {
  const d = clean(env.NUITEE_WHITELABEL_DOMAIN || DEFAULT_WL_DOMAIN).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : '';
}
function status(env = process.env) {
  return { version: VERSION, enabled: enabled(env), provider: 'Nuitee', handoff: 'whitelabel', whitelabelDomain: whitelabelDomain(env) || null, prebook: false, bookingCapability: false, maxStops: MAX_STOPS };
}

function whitelabelUrl(domain, hotelId, checkin, checkout, occupancies) {
  if (!domain || !/^[A-Za-z0-9_-]{2,64}$/.test(hotelId)) return '';
  const url = new URL(`https://${domain}/hotels/${encodeURIComponent(hotelId)}`);
  url.searchParams.set('checkin', checkin);
  url.searchParams.set('checkout', checkout);
  url.searchParams.set('occupancies', Buffer.from(JSON.stringify(occupancies)).toString('base64'));
  return url.toString();
}

// "Cheap but good": among offers with a decent review score, prefer refundable,
// then cheapest. Fall back to all valid offers when none are well rated.
function chooseOffer(payload = {}, currency) {
  const rateHotels = Array.isArray(payload.data) ? payload.data : [];
  const content = new Map((Array.isArray(payload.hotels) ? payload.hotels : []).map(h => [clean(h.hotelId || h.id), h]));
  const offers = [];
  for (const rh of rateHotels) {
    for (const rt of (Array.isArray(rh.roomTypes) ? rh.roomTypes : [])) {
      offers.push(internal.offerFromRoomType(rh, rt, content.get(clean(rh.hotelId || rh.id)) || null));
    }
  }
  const valid = offers.filter(o => o.hotelId && o.amount > 0 && o.currency === currency && o.excludedFeesPresent !== true);
  if (!valid.length) return null;
  // Cheapest offer from a hotel rated 7.0+ (if any are rated); refundable only
  // breaks exact ties. Budget-first: price matters more than free cancellation.
  const good = valid.filter(o => Number(o.rating) >= GOOD_RATING);
  const pool = good.length ? good : valid;
  return pool.slice().sort((a, b) => a.amount - b.amount || (a.refundableTag === 'RFN' ? 0 : 1) - (b.refundableTag === 'RFN' ? 0 : 1))[0];
}

async function priceStop(stop, index, tour, query, env, options, apiKey, currency) {
  const stayWindow = internal.deriveStayWindow(tour, stop, index);
  const countryCode = internal.resolveCountryCode(stop);
  const today = new Date().toISOString().slice(0, 10);
  if (!clean(stop.city) || !countryCode || !stayWindow.checkin || !stayWindow.checkout || stayWindow.checkin < today) {
    return { index, applied: false, reason: !countryCode ? 'country-code-unresolved' : 'stay-dates-unavailable' };
  }
  let body;
  try {
    body = internal.searchBody({ ...stop, hotel: {} }, { ...query, guestNationality: query.guestNationality || query.nationality || env.NUITEE_GUEST_NATIONALITY || 'CA', currency }, stayWindow, countryCode, env);
  } catch (error) {
    return { index, applied: false, reason: clean(error.code || 'occupancy-invalid') };
  }
  body.limit = 50;
  body.maxRatesPerHotel = 1;
  const result = await nuitee.postJson(RATE_URL, body, apiKey, options);
  if (result.status !== 200 || result.payload?.error) return { index, applied: false, reason: `rates-http-${result.status}`, providerRequests: 1 };
  if (result.payload?.sandbox === true) return { index, applied: false, reason: 'sandbox-response', providerRequests: 1 };
  const offer = chooseOffer(result.payload || {}, currency);
  if (!offer) return { index, applied: false, reason: 'no-usable-offer', providerRequests: 1 };
  return { index, applied: true, offer, stayWindow, occupancies: body.occupancies, roomCount: body.occupancies.length, providerRequests: 1 };
}

async function applyNuiteeLiveStays(tour = {}, query = {}, options = {}) {
  const env = options.env || process.env;
  const base = { ...status(env), attempted: false, applied: false, appliedCount: 0 };
  if (!enabled(env)) return { tour, summary: { ...base, reason: 'nuitee-live-stays-disabled' } };
  const domain = whitelabelDomain(env);
  if (!domain) return { tour, summary: { ...base, reason: 'whitelabel-domain-invalid' } };
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  if (!stops.length) return { tour, summary: { ...base, reason: 'no-stays' } };

  let apiKey;
  try { apiKey = await nuitee.getApiKey(env, options); }
  catch (_) { return { tour, summary: { ...base, reason: 'nuitee-secret-unavailable' } }; }
  if (internal.keyMode(apiKey) !== 'production') return { tour, summary: { ...base, reason: 'nuitee-key-not-production' } };

  const currency = normalizeCurrency(query.currency || query.displayCurrency || 'CAD');
  const usdRate = currencyToUsdRate(currency);
  const targets = stops.slice(0, MAX_STOPS).map((stop, index) => ({ stop, index })).filter(({ stop }) => Number(stop.nights || 0) > 0);
  const rows = await Promise.all(targets.map(({ stop, index }) =>
    priceStop(stop, index, tour, query, env, { ...options, timeoutMs: options.timeoutMs || 9000 }, apiKey, currency)
      .catch(error => ({ index, applied: false, reason: error?.name === 'AbortError' ? 'rates-timeout' : 'rates-error', providerRequests: 1 }))));

  const nextStops = stops.map(stop => ({ ...stop }));
  const observedAt = new Date().toISOString();
  for (const row of rows) {
    if (!row.applied) continue;
    const stop = nextStops[row.index];
    const nights = Math.max(1, Math.round(row.stayWindow.nights || stop.nights || 1));
    const totalUsd = Math.round(row.offer.amount * usdRate);
    const nightlyPerRoomUsd = totalUsd / (nights * row.roomCount);
    const url = whitelabelUrl(domain, row.offer.hotelId, row.stayWindow.checkin, row.stayWindow.checkout, row.occupancies);
    if (!url) { row.applied = false; row.reason = 'whitelabel-link-invalid'; continue; }
    const previous = stop.hotel || {};
    stop.hotel = {
      ...previous,
      name: row.offer.hotelName || previous.name,
      hotelName: row.offer.hotelName || previous.hotelName,
      rating: row.offer.rating ?? previous.rating ?? null,
      photoUrl: row.offer.photoUrl || previous.photoUrl || null,
      address: row.offer.address || previous.address || null,
      provider: 'nuitee',
      source: 'nuitee-live-rate',
      nuiteeHotelId: row.offer.hotelId,
      estimatedNightlyUsd: Number(nightlyPerRoomUsd.toFixed(2)),
      averageNightlyUsd: Number(nightlyPerRoomUsd.toFixed(2)),
      estimatedStayUsd: totalUsd,
      totalStayUsd: totalUsd,
      providerBacked: true,
      livePriceVerified: true,
      checkIn: row.stayWindow.checkin,
      checkOut: row.stayWindow.checkout,
      pricingIntegrity: { ...(previous.pricingIntegrity || {}), nightlyPerRoomUsd: Number(nightlyPerRoomUsd.toFixed(2)), roomCount: row.roomCount, nights, rateBasis: 'per-room-per-night' },
      nuiteeLiveRate: {
        version: VERSION,
        amount: row.offer.amount,
        currency: row.offer.currency,
        totalUsd,
        roomName: row.offer.roomName || null,
        boardName: row.offer.boardName || null,
        refundableTag: row.offer.refundableTag,
        taxesAndFeesPresent: row.offer.taxesAndFeesPresent,
        checkin: row.stayWindow.checkin,
        checkout: row.stayWindow.checkout,
        dateBasis: row.stayWindow.dateBasis,
        observedAt,
        sourceType: 'LIVE',
        reserved: false,
        finalPriceRequiresPartnerConfirmation: true
      },
      nuiteeWhitelabel: { url, domain, hotelId: row.offer.hotelId, label: 'Book this hotel', merchant: 'Nuitee' }
    };
  }
  const appliedCount = rows.filter(r => r.applied).length;
  const patched = appliedCount ? applyTravellerPricingToTour({ ...tour, stops: nextStops }, query) : tour;
  return {
    tour: patched,
    summary: {
      ...base,
      attempted: true,
      applied: appliedCount > 0,
      appliedCount,
      stopCount: stops.length,
      providerRequests: rows.reduce((s, r) => s + (r.providerRequests || 0), 0),
      currency,
      reason: appliedCount === targets.length ? null : 'partial-hotel-coverage',
      rows: rows.map(r => ({ index: r.index, applied: r.applied, reason: r.reason || null, hotelId: r.offer?.hotelId || null }))
    }
  };
}

module.exports = { VERSION, FLAG, enabled, status, applyNuiteeLiveStays, _internal: { chooseOffer, whitelabelUrl } };
