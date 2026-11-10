'use client';

import type { JsonObject, SavedTrip } from '@/lib/contracts';
import { getSavedTrip } from '@/lib/api';

const VERSION = 'GV-BOOK-706A';
const SAVED_TRIPS_VERSION = 'GV-ACCOUNT-705C';
const HANDOFF_PREFIX = 'gv.account.booking.handoff.706a.';
const HANDOFF_TTL_MS = 15 * 60 * 1000;
const MULTI_STORAGE = 'globevoy.multi.selected.v1';
const MULTI_SNAPSHOT_PREFIX = 'globevoy.generated.snapshot.v1.';
const SINGLE_STORAGE = 'gv-selected-offer';

function clean(value: unknown): string { return String(value == null ? '' : value).trim(); }
function number(value: unknown, fallback = 0): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clone<T>(value: T, fallback: T): T { try { return JSON.parse(JSON.stringify(value)) as T; } catch { return fallback; } }
function validTripId(value: unknown): boolean { return /^[A-Za-z0-9_-]{8,80}$/.test(clean(value)); }
function isRecord(value: unknown): value is JsonObject { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function records(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter(isRecord) : []; }

function stripUrlFields(subject: JsonObject): void {
  ['url', 'bookingUrl', 'providerUrl', 'directSearchUrl', 'groundBookingUrl', 'transportBookingUrl', 'railBookingUrl', 'busBookingUrl', 'hotelUrl', 'imageUrl', 'bookingLink']
    .forEach((key) => { if (Object.prototype.hasOwnProperty.call(subject, key)) delete subject[key]; });
}

function downgradeLeg(leg: JsonObject): void {
  stripUrlFields(leg);
  const providerDateEvidence = isRecord(leg.providerDateEvidence) ? leg.providerDateEvidence : null;
  if (providerDateEvidence) {
    stripUrlFields(providerDateEvidence);
    providerDateEvidence.providerBacked = false;
    providerDateEvidence.productionEligible = false;
    providerDateEvidence.historicalSnapshot = true;
  }
  const providerVerification = isRecord(leg.providerVerification) ? leg.providerVerification : null;
  if (providerVerification) {
    providerVerification.verified = false;
    providerVerification.exactDateMatch = false;
    providerVerification.productionEligible = false;
    providerVerification.historicalSnapshot = true;
  }
  const priceEvidence = isRecord(leg.priceEvidence) ? leg.priceEvidence : null;
  if (priceEvidence) priceEvidence.sourceType = 'ESTIMATED';
  const booking = isRecord(leg.booking) ? leg.booking : null;
  if (booking) {
    stripUrlFields(booking);
    booking.status = 'revalidation-required';
    booking.exactItineraryHint = false;
    const trust = isRecord(booking.trust) ? booking.trust : null;
    if (trust) {
      trust.handoffState = 'revalidation-required';
      trust.exactItineraryHint = false;
    }
  }
}

function downgradeHotel(hotel: JsonObject): void {
  stripUrlFields(hotel);
  if (isRecord(hotel.providerHotel)) stripUrlFields(hotel.providerHotel);
  const verification = isRecord(hotel.providerVerification) ? hotel.providerVerification : null;
  if (verification) {
    verification.verified = false;
    verification.exactStayDates = false;
    verification.productionEligible = false;
    verification.historicalSnapshot = true;
  }
  if (isRecord(hotel.priceEvidence)) hotel.priceEvidence.sourceType = 'ESTIMATED';
  if (isRecord(hotel.priceProvenance)) hotel.priceProvenance.sourceType = 'ESTIMATED';
  if (isRecord(hotel.booking)) stripUrlFields(hotel.booking);
}

function accountTourForBooking(trip: SavedTrip): JsonObject | null {
  const tour = clone<JsonObject | null>(trip.tripSnapshot.tour || null, null);
  if (!tour || !records(tour.cities).length) return null;
  const capturedAt = clean(trip.priceSnapshot?.capturedAt || trip.updatedAt || trip.createdAt);
  tour.savedAccountContext706A = {
    version: VERSION,
    tripId: clean(trip.tripId),
    capturedAt,
    snapshotOnly: true,
    requiresRevalidation: true
  };
  records(tour.backendLegs).forEach(downgradeLeg);
  records(tour.legs).forEach(downgradeLeg);
  records(tour.cities).forEach((city) => { if (isRecord(city.hotel)) downgradeHotel(city.hotel); });
  records(tour.stays).forEach((stay) => { if (isRecord(stay.hotel)) downgradeHotel(stay.hotel); });
  return tour;
}

function singleOfferForBooking(trip: SavedTrip): JsonObject | null {
  const snapshot = trip.tripSnapshot;
  const price = trip.priceSnapshot || { currency: 'CAD' };
  if (snapshot.kind !== 'single' || !clean(snapshot.city)) return null;
  return {
    ...(clone<JsonObject>(snapshot.offer || {}, {})),
    city: clean(snapshot.city),
    country: clean(snapshot.country),
    code: clean(snapshot.code).toUpperCase(),
    nights: Math.max(1, number(snapshot.nights, 1)),
    flight: number(price.flightEstimate, 0),
    stay: number(price.stayEstimate, 0),
    total: number(price.tripEstimate, 0),
    remaining: number(price.remaining, 0),
    _accountTrip706A: clean(trip.tripId),
    _accountSnapshotOnly706A: true
  };
}

function sameOriginSourceQuery(sourceUrl?: string): URLSearchParams {
  try {
    const url = new URL(clean(sourceUrl), window.location.origin);
    return url.origin === window.location.origin ? url.searchParams : new URLSearchParams();
  } catch {
    return new URLSearchParams();
  }
}

function bookingUrlForTrip(trip: SavedTrip): string {
  const snapshot = trip.tripSnapshot;
  const price = trip.priceSnapshot || { currency: 'CAD' };
  const params = new URLSearchParams({ accountTrip: clean(trip.tripId), accountSnapshot: '1' });
  if (snapshot.kind === 'multi') {
    params.set('multi', 'true');
    return `/booking.html?${params.toString()}`;
  }
  if (snapshot.kind !== 'single') return '';
  const source = sameOriginSourceQuery(snapshot.sourceUrl);
  params.set('multi', 'false');
  params.set('origin', clean(snapshot.origin));
  params.set('city', clean(snapshot.city));
  params.set('country', clean(snapshot.country));
  params.set('destinationCode', clean(snapshot.code).toUpperCase());
  params.set('passengers', String(Math.max(1, number(snapshot.travellers, 1))));
  params.set('currency', clean(price.currency || snapshot.currency || 'CAD').toUpperCase());
  params.set('budget', String(number(price.totalBudget, 0)));
  params.set('total', String(number(price.tripEstimate, 0)));
  params.set('reserve', String(number(price.reserve, 0)));
  params.set('remaining', String(number(price.remaining, 0)));
  ['departureDate', 'returnDate', 'adults', 'children', 'infants', 'rooms'].forEach((key) => {
    const value = clean(source.get(key));
    if (value) params.set(key, value);
  });
  return `/booking.html?${params.toString()}`;
}

function buildBookingHandoff(trip: SavedTrip): JsonObject {
  if (!validTripId(trip.tripId)) throw new Error('invalid-trip-id');
  const createdAt = Date.now();
  if (trip.tripSnapshot.kind === 'multi') {
    const tour = accountTourForBooking(trip);
    if (!tour) throw new Error('saved-multi-route-unavailable');
    return {
      version: VERSION,
      tripId: clean(trip.tripId),
      kind: 'multi',
      createdAt,
      expiresAt: createdAt + HANDOFF_TTL_MS,
      tour,
      priceSnapshot: clone(trip.priceSnapshot || {}, {})
    };
  }
  const offer = singleOfferForBooking(trip);
  if (!offer) throw new Error('saved-single-route-unavailable');
  return {
    version: VERSION,
    tripId: clean(trip.tripId),
    kind: 'single',
    createdAt,
    expiresAt: createdAt + HANDOFF_TTL_MS,
    offer,
    priceSnapshot: clone(trip.priceSnapshot || {}, {})
  };
}

export function openSavedTrip(trip: SavedTrip): boolean {
  const snapshot = trip.tripSnapshot;
  if (snapshot.kind === 'single' && snapshot.offer) {
    window.sessionStorage.setItem(SINGLE_STORAGE, JSON.stringify(snapshot.offer));
  }
  if (snapshot.kind === 'multi' && snapshot.tour) {
    window.sessionStorage.setItem(MULTI_STORAGE, JSON.stringify(snapshot.tour));
    if (snapshot.snapshotId) {
      window.localStorage.setItem(`${MULTI_SNAPSHOT_PREFIX}${snapshot.snapshotId}`, JSON.stringify({
        version: SAVED_TRIPS_VERSION,
        savedAt: new Date().toISOString(),
        tour: snapshot.tour
      }));
    }
  }
  try {
    const url = new URL(clean(snapshot.sourceUrl), window.location.origin);
    if (url.origin !== window.location.origin) return false;
    const name = url.pathname.split('/').pop() || '';
    if (!['trip.html', 'multicity-visualizer.html', 'multi-city-trip.html'].includes(name)) return false;
    window.location.assign(`/${name}${url.search}`);
    return true;
  } catch {
    return false;
  }
}

export async function continueSavedTripToBooking(accessToken: string, tripId: string): Promise<void> {
  const id = clean(tripId);
  if (!validTripId(id)) throw new Error('invalid-trip-id');
  // 706A trust boundary: always re-fetch the exact owner-private record immediately before handoff.
  const trip = await getSavedTrip(accessToken, id);
  if (!trip || clean(trip.tripId) !== id) throw new Error('saved-trip-not-found');
  const handoff = buildBookingHandoff(trip);
  window.sessionStorage.setItem(`${HANDOFF_PREFIX}${id}`, JSON.stringify(handoff));
  const path = bookingUrlForTrip(trip);
  if (!path) throw new Error('booking-route-unavailable');
  window.location.assign(path);
}

export const SAVED_TRIP_HANDOFF_CONTRACT = Object.freeze({
  version: VERSION,
  handoffPrefix: HANDOFF_PREFIX,
  handoffTtlMs: HANDOFF_TTL_MS,
  freshOwnerPrivateGetRequired: true,
  snapshotOnly: true,
  requiresRevalidation: true
});
