'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');

const MAX_TOKEN = 100000;
const MINUTE = 60000;
const pick = (object, keys) => Object.fromEntries(keys.filter(k => object?.[k] !== undefined).map(k => [k, object[k]]));
const sign = (body, secret) => createHmac('sha256', secret).update('gv-booking-quote-v1.' + body).digest();

function issue(tour, env = process.env, now = Date.now()) {
  const key = env.BOOKING_EVIDENCE_SIGNING_KEY || env.IGNAV_API_KEY;
  if (!key || !tour?.fareMap?.arrivalDatesVerified) return null;
  const legs = tour.backendLegs?.length ? tour.backendLegs : tour.legs || [];
  const stops = tour.cities?.length ? tour.cities : tour.stops || [];
  if (!stops.length || legs.length !== stops.length + 1) return null;
  const expiry = [now + 15 * MINUTE];
  for (const leg of legs) {
    const e = leg.providerDateEvidence;
    const seen = Date.parse(e?.observedAt);
    if (e?.sourceType !== 'LIVE' || !(seen <= now + MINUTE) || !leg.departureDate) return null;
    expiry.push(seen + 180 * MINUTE);
    if (e.expiresAt) expiry.push(Date.parse(e.expiresAt));
  }
  for (const stop of stops) {
    const rate = stop.hotel?.nuiteeLiveRate;
    const seen = Date.parse(rate?.observedAt);
    if (rate?.sourceType !== 'LIVE' || !(rate.totalUsd > 0) || !(seen <= now + MINUTE) ||
        !rate.checkin || !rate.checkout || !stop.hotel?.nuiteeHotelId) return null;
    expiry.push(seen + 30 * MINUTE);
    if (rate.expiresAt) expiry.push(Date.parse(rate.expiresAt));
  }
  const expiresAt = Math.min(...expiry);
  if (!(expiresAt > now)) return null;
  const quote = {
    ...pick(tour, ['tourId','displayBudget','totalNights','passengerPricing','origin','estimatedTotalUsd','usableTripBudgetUsd','reserveAmountUsd']),
    backendLegs: legs.map(leg => pick(leg, ['from','to','mode','transportType','departureDate','airline','estimatedTransportUsd',
      'priceProvenance','canonicalPricing','providerVerification','booking'])),
    cities: stops.map(stop => ({
      ...pick(stop, ['city','cityId','name','nights','arrivalDate','departureDate','checkIn','checkOut']),
      hotel: pick(stop.hotel, ['name','hotelName','rating','checkIn','checkOut','estimatedStayUsd','nuiteeHotelId',
        'nuiteeLiveRate','nuiteeWhitelabel','booking','payAtHotel','adults','rooms','agodaCityId','providerCityId'])
    }))
  };
  const body = Buffer.from(JSON.stringify({ issuedAt: now, expiresAt, quote })).toString('base64url');
  return body.length <= MAX_TOKEN - 45 ? body + '.' + sign(body, key).toString('base64url') : null;
}

function verify(token, env = process.env, now = Date.now()) {
  const key = env.BOOKING_EVIDENCE_SIGNING_KEY || env.IGNAV_API_KEY;
  if (!key || typeof token !== 'string' || token.length > MAX_TOKEN || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [body, signature] = token.split('.');
  if (!timingSafeEqual(sign(body, key), Buffer.from(signature, 'base64url'))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url'));
    return data.issuedAt <= now && now < data.expiresAt ? data : null;
  } catch (_) { return null; }
}

module.exports = { issue, verify, MAX_TOKEN };
