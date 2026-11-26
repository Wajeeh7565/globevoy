// GV-WEB-3 — booking page links: back to the trip, new search, sign in, saved-trip note.
// The booking list itself is drawn by booking-trip-v2.js.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const q = new URLSearchParams(location.search);
  const S = window.GlobevoyTripSearch;

  const back = new URLSearchParams(q);
  ['multi', 'accountTrip', 'accountSnapshot', 'departureDate', 'returnDate'].forEach(k => back.delete(k));
  const accountTrip = q.get('accountTrip');
  $('#gv-booking-back').href = accountTrip ? './my-trips.html' : './multi-city-trip.html?' + back.toString();
  if (accountTrip) $('#gv-booking-back').textContent = '← Back to your saved trips';

  const search = S?.readSearch ? S.readSearch(q) : null;
  if (search && search.budget) {
    $('#new-search').href = './index.html?' + new URLSearchParams({ origin: search.origin, budget: String(search.budget), currency: search.currency, adults: String(search.adults) });
  }

  const signin = $('#signin');
  if (S?.isMember?.()) { signin.textContent = 'Your account'; signin.onclick = () => { location.href = './account.html'; }; }
  else signin.onclick = () => S?.signIn?.();

  // Trips opened from My Trips carry prices saved earlier (GV-BOOK-706A).
  if (window.GLOBEVOY_BOOKING_ACCOUNT_SNAPSHOT_706A?.snapshotOnly) $('#gv-booking-account-note').hidden = false;
})();
