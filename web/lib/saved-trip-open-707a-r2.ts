'use client';

import type { JsonObject, SavedTrip } from '@/lib/contracts';
import { openSavedTrip as openSavedTrip707A } from '@/lib/saved-trip-handoff';

export const GV_WEB_707A_R2_VERSION = 'GV-WEB-707A-R2';

const SAVED_TRIPS_VERSION = 'GV-ACCOUNT-705C';
const MULTI_STORAGE = 'globevoy.multi.selected.v1';
const MULTI_SNAPSHOT_PREFIX = 'globevoy.generated.snapshot.v1.';
const ALLOWED_MULTI_ROUTES = new Set(['multicity-visualizer.html', 'multi-city-trip.html']);

function clean(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function savedMultiOrigin(trip: SavedTrip): string {
  const snapshotOrigin = clean(trip.tripSnapshot.origin);
  if (snapshotOrigin) return snapshotOrigin;

  const tour = isRecord(trip.tripSnapshot.tour) ? trip.tripSnapshot.tour : null;
  const tourOrigin = tour && isRecord(tour.origin) ? tour.origin : null;
  return clean(tourOrigin?.city || tourOrigin?.name);
}

/**
 * R2 fixes a legacy-query precedence bug in Open Trip.
 *
 * 705C stores the authoritative saved origin on the account snapshot. Older
 * sourceUrl values can still contain the origin that happened to be active
 * when the route page URL was first produced. The legacy multi-city page gives
 * ?origin= precedence over the tour object, so forwarding sourceUrl unchanged
 * can display the wrong origin after an account trip is reopened.
 *
 * Preserve all safe legacy query parameters, but replace only `origin` with
 * the owner-private saved snapshot origin before navigation.
 */
export function openSavedTripPreservingOrigin(trip: SavedTrip): boolean {
  const snapshot = trip.tripSnapshot;
  if (snapshot.kind !== 'multi') return openSavedTrip707A(trip);
  if (!snapshot.tour) return false;

  try {
    const url = new URL(clean(snapshot.sourceUrl), window.location.origin);
    if (url.origin !== window.location.origin) return false;

    const name = url.pathname.split('/').pop() || '';
    if (!ALLOWED_MULTI_ROUTES.has(name)) return false;

    const savedOrigin = savedMultiOrigin(trip);
    if (!savedOrigin) return false;

    // Seed the exact saved account route before leaving React.
    window.sessionStorage.setItem(MULTI_STORAGE, JSON.stringify(snapshot.tour));
    if (snapshot.snapshotId) {
      window.localStorage.setItem(`${MULTI_SNAPSHOT_PREFIX}${snapshot.snapshotId}`, JSON.stringify({
        version: SAVED_TRIPS_VERSION,
        savedAt: new Date().toISOString(),
        tour: snapshot.tour
      }));
    }

    // Critical R2 rule: stale sourceUrl origin must never override saved origin.
    url.searchParams.set('origin', savedOrigin);
    window.location.assign(`/${name}${url.search}`);
    return true;
  } catch {
    return false;
  }
}
