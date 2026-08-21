/* GV-BOOK-706A — consume an exact Saved Trips booking handoff before legacy booking scripts run. */
(function () {
  'use strict';

  const VERSION = 'GV-BOOK-706A';
  const HANDOFF_PREFIX = 'gv.account.booking.handoff.706a.';
  const MULTI_STORAGE = 'globevoy.multi.selected.v1';
  const SINGLE_STORAGE = 'gv-selected-offer';
  const q = new URLSearchParams(location.search);
  const tripId = String(q.get('accountTrip') || '').trim();

  if (!tripId) return;

  function validTripId(value) { return /^[A-Za-z0-9_-]{8,80}$/.test(String(value || '').trim()); }
  function read(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function write(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
  function remove(key) { try { sessionStorage.removeItem(key); } catch (_) {} }
  function redirectFail(reason) {
    try {
      remove(`${HANDOFF_PREFIX}${tripId}`);
      const multi = read(MULTI_STORAGE);
      if (multi?.savedAccountContext706A?.tripId && multi.savedAccountContext706A.tripId !== tripId) remove(MULTI_STORAGE);
      const single = read(SINGLE_STORAGE);
      if (single?._accountTrip706A && single._accountTrip706A !== tripId) remove(SINGLE_STORAGE);
    } catch (_) {}
    const params = new URLSearchParams({ bookingError: reason || 'account-trip-unavailable' });
    location.replace(`my-trips.html?${params.toString()}`);
  }
  function publishMarker(kind, capturedAt, refreshed) {
    window.GLOBEVOY_BOOKING_ACCOUNT_SNAPSHOT_706A = Object.freeze({
      version: VERSION,
      tripId,
      kind,
      capturedAt: String(capturedAt || ''),
      snapshotOnly: true,
      requiresRevalidation: true,
      refreshed: Boolean(refreshed)
    });
    document.documentElement.dataset.gvBookingAccount = '706a';
  }

  if (!validTripId(tripId)) {
    redirectFail('invalid-account-trip');
    return;
  }

  const key = `${HANDOFF_PREFIX}${tripId}`;
  const handoff = read(key);
  const now = Date.now();
  if (handoff) {
    const exact = handoff.version === VERSION && handoff.tripId === tripId;
    const fresh = Number(handoff.expiresAt) > now && Number(handoff.createdAt) <= now;
    if (!exact || !fresh) {
      redirectFail('expired-account-trip');
      return;
    }
    if (handoff.kind === 'multi' && Array.isArray(handoff.tour?.cities) && handoff.tour.cities.length) {
      if (!write(MULTI_STORAGE, handoff.tour)) { redirectFail('account-trip-storage-failed'); return; }
      remove(key);
      publishMarker('multi', handoff.priceSnapshot?.capturedAt || handoff.tour?.savedAccountContext706A?.capturedAt, false);
      return;
    }
    if (handoff.kind === 'single' && handoff.offer?._accountTrip706A === tripId) {
      if (!write(SINGLE_STORAGE, handoff.offer)) { redirectFail('account-trip-storage-failed'); return; }
      remove(key);
      publishMarker('single', handoff.priceSnapshot?.capturedAt, false);
      return;
    }
    redirectFail('invalid-account-trip-handoff');
    return;
  }

  // Same-tab refresh is allowed only when the existing browser copy carries the
  // exact private tripId marker produced by a successful 706A owner-private GET.
  const multi = read(MULTI_STORAGE);
  if (String(q.get('multi') || '').toLowerCase() === 'true' && multi?.savedAccountContext706A?.tripId === tripId) {
    publishMarker('multi', multi.savedAccountContext706A.capturedAt, true);
    return;
  }
  const single = read(SINGLE_STORAGE);
  if (String(q.get('multi') || '').toLowerCase() !== 'true' && single?._accountTrip706A === tripId) {
    publishMarker('single', '', true);
    return;
  }

  redirectFail('account-trip-handoff-required');
})();