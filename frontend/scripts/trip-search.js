// GlobeVoy trip search: shared by the homepage (builds the search) and the
// results page (asks the API and keeps only fully live-priced trips).
(function () {
  'use strict';

  const ROLES = [
    { id: 'best-balance', label: 'Best use of your budget', line: 'The most from your budget.' },
    { id: 'lowest-cost', label: 'Lowest cost', line: 'More trip, less spend.' },
    { id: 'most-memorable', label: 'Something different', line: 'Somewhere new entirely.' }
  ];
  const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];
  const PACES = { relaxed: 'Relaxed', balanced: 'Balanced', 'see-more': 'See more' };
  const CACHE_MS = 10 * 60 * 1000;
  const SESSION_KEY = 'globevoy.auth.session.705b-r3';

  function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  // Search from the homepage form -> results page URL. Dates stay open
  // (next ~6 months) unless the traveller picks a month.
  function resultsUrl(input) {
    const p = new URLSearchParams();
    p.set('origin', String(input.origin || 'Toronto (YYZ)'));
    p.set('budget', String(clampInt(input.budget, 1, 1000000, 0)));
    p.set('currency', CURRENCIES.includes(input.currency) ? input.currency : 'CAD');
    p.set('adults', String(clampInt(input.adults, 1, 12, 1)));
    if (/^\d{4}-\d{2}$/.test(String(input.month || ''))) p.set('month', input.month);
    if (PACES[input.pace]) p.set('pace', input.pace);
    return 'results.html?' + p.toString();
  }

  function readSearch(query) {
    const q = query || new URLSearchParams(location.search);
    const month = q.get('month') || q.get('preferredMonth') || '';
    const pace = String(q.get('pace') || q.get('travelPace') || 'balanced').toLowerCase().replace(' ', '-');
    return {
      origin: q.get('origin') || 'Toronto (YYZ)',
      budget: clampInt(q.get('budget'), 0, 1000000, 0),
      currency: CURRENCIES.includes(q.get('currency')) ? q.get('currency') : 'CAD',
      adults: clampInt(q.get('adults') || q.get('passengers'), 1, 12, 1),
      // Old links always pinned the current month (flexibility=month); only a month
      // chosen on the new form (no flexibility param) is kept.
      month: q.get('flexibility') ? '' : (/^\d{4}-\d{2}$/.test(month) ? month : ''),
      pace: PACES[pace] ? pace : 'balanced'
    };
  }

  // GV-ANALYTICS-9A: a random reference for this page view only (not stored anywhere in
  // the browser), sent with the search and with feedback clicks so the two can be linked.
  const PAGE_SID = (() => {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('-');
  })();

  // GV-ANALYTICS-V1: a random guest ID kept in this browser (local storage only), so one
  // person's searches can be counted together. Cleared with the browser's site data.
  const GUEST_ID = (() => {
    const k = 'globevoy.analytics.gid.v1';
    try { const v = localStorage.getItem(k); if (/^[A-Za-z0-9-]{16,64}$/.test(v || '')) return v; } catch (_) {}
    let v; try { v = crypto.randomUUID(); } catch (_) { v = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('-'); }
    try { localStorage.setItem(k, v); } catch (_) {}
    return v;
  })();

  // Signed in: tell the backend once per page which search this is. The backend verifies
  // the access token itself and stores only a keyed hash of the account ID.
  let identified = false;
  function identify(search) {
    if (identified) return;
    identified = true;
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      const api = window.GlobevoyApi;
      if (!s || !s.accessToken || !(Number(s.expiresAt) > Date.now() + 30000) || !api?.sendAnalyticsIdentify) return;
      api.sendAnalyticsIdentify(s.accessToken, { sid: PAGE_SID, gid: GUEST_ID, origin: search.origin, budget: search.budget, currency: search.currency, adults: search.adults || search.travellers });
    } catch (_) {}
  }

  // GV-ANALYTICS-V1: partner (booking) link clicks on trip pages, attributed to the search
  // and trip the traveller came from. Only the provider's site name, kind and price shown.
  function partnerClick(e) {
    try {
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a || !/^https?:/i.test(a.href) || a.host === location.host || !/_blank/.test(a.target || '')) return;
      const ref = JSON.parse(sessionStorage.getItem('globevoy.analytics.ref.v1') || 'null');
      if (!ref || !ref.sid || Date.now() - ref.at > 6 * 3600000) return;
      const host = a.hostname.replace(/^www\./, '');
      // Booking partners only: photo credits, maps and licence links are not partner clicks.
      if (!/(^|\.)(nuitee\.link|nuitee\.com|agoda\.com|tp\.media|aviasales\.[a-z.]+|travelpayouts\.com|ignav\.com|kiwi\.com|skyscanner\.[a-z.]+|booking\.com|expedia\.[a-z.]+|hotels\.com|trip\.com)$/i.test(host)) return;
      const text = (a.textContent + ' ' + (a.closest('[data-kind],section,li,article')?.textContent || '')).slice(0, 400);
      const kind = /hotel|stay|room|nuitee|agoda/i.test(host + ' ' + a.textContent) ? 'hotel' : /flight|fly|air|aviasales|ignav|kiwi|skyscanner/i.test(host + ' ' + text) ? 'flight' : 'other';
      // Price only when the link carries it; nearby page text gave wrong amounts (e.g. per night).
      const val = Number(a.dataset && a.dataset.gvValue);
      const clickId = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
      window.GlobevoyApi?.sendTripFeedback?.({ sid: ref.sid, role: ref.role, rank: ref.rank, action: 'partner_click', provider: host.slice(0, 40), kind, value: val > 0 ? val : null, currency: val > 0 && /^[A-Z]{3}$/.test(a.dataset.gvCurrency || '') ? a.dataset.gvCurrency : null, clickId });
    } catch (_) {}
  }
  if (typeof document !== 'undefined') document.addEventListener('click', partnerClick, true);

  function apiParams(search, role, slot) {
    const p = {
      sid: PAGE_SID,
      gid: GUEST_ID,
      mode: 'generated-tour',
      recommendationScope: 'generated-multicity-tour',
      origin: search.origin,
      budget: String(search.budget),
      currency: search.currency,
      passengers: String(search.adults),
      adults: String(search.adults),
      children: '0',
      travellers: search.adults === 1 ? '1 adult' : search.adults + ' adults',
      tripLength: 'auto',
      adaptiveDuration: 'true',
      dateMode: 'flexible',
      flexible: 'true',
      interests: 'No preference',
      hotelStyle: 'Best balance',
      region: 'All continents',
      travelPace: PACES[search.pace],
      flightPreference: 'Best overall',
      routeRole: role,
      pickRole: role,
      threePickRequest: 'true',
      diversityRequest: 'true',
      diversitySlot: String(slot),
      diversityExcludedRoutes: '[]',
      routeRankingCandidateLimit: '3',
      diversityCandidateLimit: '12'
    };
    if (search.month) {
      p.preferredMonth = search.month;
      p.month = search.month;
      p.flexibility = 'month';
    }
    return p;
  }

  function isMember() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return !!(s && s.version === 'GV-ACCOUNT-705B-R3' && s.accessToken && s.user && s.user.sub &&
        Number(s.expiresAt) > Date.now() + 30000);
    } catch (_) {
      return false;
    }
  }

  // GV-WEB-4: every Sign In opens the GlobeVoy sign-in page, which hands over to Cognito.
  function signIn(returnTo) {
    const target = returnTo || location.pathname + location.search + location.hash;
    // Local development signs in on staging (production-only builds have no staging origin).
    const stagingOrigin = window.GLOBEVOY_ENVIRONMENT_POLICY && window.GLOBEVOY_ENVIRONMENT_POLICY.stagingOrigin;
    if (stagingOrigin && (location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
      location.href = stagingOrigin + '/account.html';
      return;
    }
    location.href = 'sign-in.html?returnTo=' + encodeURIComponent(target);
  }

  // GlobeVoy shows only trips whose every flight and hotel was priced live.
  function isFullyLive(tour) {
    if (!tour || !Array.isArray(tour.cities) || !tour.cities.length) return false;
    const legs = Array.isArray(tour.legs) ? tour.legs : [];
    if (!legs.length) return false;
    if (tour.ignavLiveFares && tour.ignavLiveFares.partial === true) return false;
    if (!legs.every(leg => leg && leg.liveFareVerified === true)) return false;
    return tour.cities.every(city => !city.hotel || city.hotel.livePriceVerified === true);
  }

  function routeKey(tour) {
    return (tour.cities || []).map(c => c.id || c.cityId || c.city).join('>');
  }
  function cityKey(tour) {
    return (tour.cities || []).map(c => c.id || c.cityId || c.city).sort().join('|');
  }
  function tripTotal(tour) {
    const n = Number(tour?.displayBudget?.tripEstimate);
    return Number.isFinite(n) ? n : Number(tour?.estimatedTotalUsd) || 0;
  }

  function cacheKey(search, member) {
    return 'globevoy.results.v2:' + JSON.stringify([search, member]);
  }

  // Trips this tab has already shown for a search, so "Show other trips" rotates
  // through the API's pool instead of repeating them (GV-POOL-001).
  function seenKey(search, member) { return 'globevoy.results.seen.v1:' + JSON.stringify([search, member]); }
  function readSeen(search, member) { try { const v = JSON.parse(sessionStorage.getItem(seenKey(search, member)) || '[]'); return Array.isArray(v) ? v.slice(-60) : []; } catch (_) { return []; } }
  function writeSeen(search, member, list) { try { sessionStorage.setItem(seenKey(search, member), JSON.stringify(list.slice(-60))); } catch (_) { /* storage full */ } }

  // One request returns up to three live trips from the search's pool. options.refresh
  // skips the saved result and the trips already shown; when the pool is used up the
  // rotation starts again. An older API without pool mode falls back to one request
  // per option.
  async function findTrips(search, options) {
    const member = !!(options && options.member);
    if (member) identify(search);
    const refresh = !!(options && options.refresh);
    const key = cacheKey(search, member);
    if (!refresh) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (saved && Date.now() - saved.at < CACHE_MS && (saved.trips?.length || saved.noTrip)) return saved;
        if (saved?.trips?.length && Date.now() - saved.at < 15 * 60000 && window.GlobevoyJourneyQuote) {
          const quotes = await Promise.all(saved.trips.map(trip => window.GlobevoyJourneyQuote.readVerifiedQuote(trip.tour)));
          if (quotes.some(Boolean)) return saved;
        }
      } catch (_) { /* no cache */ }
    }
    const api = window.GlobevoyApi;
    if (!api || !api.isConfigured || !api.isConfigured()) throw new Error('not-configured');

    let seen = refresh ? readSeen(search, member) : [];
    const ask = list => api.getGeneratedTour({ ...apiParams(search, 'best-balance', 1), pool: '1', poolShow: member ? '3' : '1', seenRoutes: JSON.stringify(list) });
    let payload = null;
    try { payload = await ask(seen); } catch (_) { payload = null; }
    if (payload && payload.poolMode) {
      let tours = [payload.tour].concat(Array.isArray(payload.tours) ? payload.tours : []).filter(Boolean);
      if (!tours.some(isFullyLive) && seen.length && !payload.poolRemaining) {
        // Every pool trip has been shown: start the rotation again.
        seen = [];
        try { payload = await ask(seen); } catch (_) { payload = null; }
        tours = payload ? [payload.tour].concat(Array.isArray(payload.tours) ? payload.tours : []).filter(Boolean) : [];
      }
      const unique = [];
      const keys = new Set();
      tours.filter(isFullyLive).forEach(t => { const k = routeKey(t); if (!keys.has(k)) { keys.add(k); unique.push(t); } });
      const labelled = unique.slice(0, member ? 3 : 1).map(tour => {
        const role = ROLES.find(r => r.id === (tour.tourRole || tour.fareMapRole)) || ROLES[0];
        return { tour, role: role.id, meta: role };
      });
      writeSeen(search, member, seen.concat(payload?.poolShownRoutes || []));
      const result = { at: Date.now(), trips: labelled, noTrip: labelled.length ? null : (payload?.noTrip || null), failed: !payload,
        poolSize: Number(payload?.poolSize) || 0, poolRemaining: Number(payload?.poolRemaining) || 0 };
      if (labelled.length || result.noTrip) {
        try { sessionStorage.setItem(key, JSON.stringify(result)); } catch (_) { /* storage full */ }
      }
      return result;
    }
    // Older API: its answer to this request is the main option's answer; reuse it.
    return findTripsByRole(search, member, key, payload || undefined);
  }

  // Older API: one request per option (kept so the page works with either backend).
  async function findTripsByRole(search, member, key, prefetched) {
    const api = window.GlobevoyApi;
    const roles = member ? ROLES : ROLES.slice(0, 1);
    const settled = await Promise.allSettled(roles.map((role, i) => (i === 0 && prefetched ? Promise.resolve(prefetched) : api.getGeneratedTour(apiParams(search, role.id, i + 1)))));

    let noTrip = null;
    let failures = 0;
    const byRole = {};
    const pool = [];
    const seen = new Set();
    settled.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) { failures += 1; return; }
      const payload = result.value;
      if (payload.noTrip && !noTrip) noTrip = payload.noTrip;
      const list = [payload.tour].concat(Array.isArray(payload.tours) ? payload.tours : []);
      list.forEach((tour, n) => {
        if (!isFullyLive(tour)) return;
        const k = routeKey(tour);
        if (n === 0 && !byRole[roles[i].id]) byRole[roles[i].id] = tour;
        if (seen.has(k)) return;
        seen.add(k);
        pool.push(tour);
      });
    });

    const chosen = [];
    const used = new Set();
    const take = tour => { chosen.push(tour); used.add(cityKey(tour)); };
    roles.forEach(role => {
      const own = byRole[role.id];
      if (own && !used.has(cityKey(own))) { take(own); return; }
      const sameRole = pool.find(t => !used.has(cityKey(t)) && (t.tourRole === role.id || t.fareMapRole === role.id));
      if (sameRole) { take(sameRole); return; }
      if (role.id === 'lowest-cost') {
        const cheapest = pool.filter(t => !used.has(cityKey(t))).sort((a, b) => tripTotal(a) - tripTotal(b))[0];
        if (cheapest) take(cheapest);
        return;
      }
      const any = pool.find(t => !used.has(cityKey(t)));
      if (any) take(any);
    });

    // Labels follow the trips as shown: "Lowest cost" is always the cheapest one.
    let labelled = chosen.map((tour, i) => ({ tour, role: roles[i] ? roles[i].id : 'best-balance' }));
    if (labelled.length > 1) {
      const lowestIndex = labelled.findIndex(x => x.role === 'lowest-cost');
      let cheapestIndex = 0;
      labelled.forEach((x, i) => { if (tripTotal(x.tour) < tripTotal(labelled[cheapestIndex].tour)) cheapestIndex = i; });
      if (lowestIndex >= 0 && cheapestIndex !== lowestIndex) {
        const a = labelled[lowestIndex].tour;
        labelled[lowestIndex].tour = labelled[cheapestIndex].tour;
        labelled[cheapestIndex].tour = a;
      }
    }
    labelled = labelled.map(x => ({ ...x, meta: ROLES.find(r => r.id === x.role) || ROLES[0] }));

    const result = { at: Date.now(), trips: labelled, noTrip: labelled.length ? null : noTrip, failed: !labelled.length && failures === roles.length };
    if (labelled.length || noTrip) {
      try { sessionStorage.setItem(key, JSON.stringify(result)); } catch (_) { /* storage full */ }
    }
    return result;
  }

  // Hand a trip to the existing trip-details and booking pages.
  function tripDetailsUrl(tour, search) {
    const id = 'gv2-' + Math.abs(hash(routeKey(tour) + '|' + (tour.itineraryDatePlan?.canonicalDepartureDate || '') + '|' + search.budget)).toString(36);
    const clone = JSON.parse(JSON.stringify(tour));
    try { localStorage.setItem('globevoy.generated.snapshot.v1.' + id, JSON.stringify({ version: 'GV-WEB-2', savedAt: new Date().toISOString(), tour: clone })); } catch (_) { /* private mode */ }
    try { sessionStorage.setItem('globevoy.multi.selected.v1', JSON.stringify(clone)); } catch (_) { /* private mode */ }
    try { window.name = 'globevoy.trip.handoff.v1:' + JSON.stringify({ id, tour: clone }); } catch (_) { /* too large */ }
    const p = new URLSearchParams();
    p.set('generated', 'true');
    p.set('saved', 'true');
    p.set('snapshot', id);
    p.set('variant', id);
    p.set('origin', search.origin);
    p.set('budget', String(search.budget));
    p.set('currency', search.currency);
    p.set('passengers', String(search.adults));
    p.set('adults', String(search.adults));
    p.set('children', '0');
    p.set('tripLength', 'auto');
    p.set('dateMode', 'flexible');
    p.set('savedStops', (tour.cities || []).map(c => c.id || c.cityId || c.code).join(','));
    const departure = tour.itineraryDatePlan?.canonicalDepartureDate;
    if (departure) { p.set('savedDepartureDate', departure); p.set('departureDate', departure); }
    if (search.month) p.set('month', search.month);
    p.set('handoff', 'same-tab');
    return 'multi-city-trip.html?' + p.toString();
  }

  // Save on the results page: keep the trip in this browser and put its snapshot in
  // the address, where the saved-trips runtime (saved-trips-705c.js) picks it up for
  // signed-in travellers and My Trips reopens it later.
  function saveInBrowser(tour, search) {
    const details = new URL(tripDetailsUrl(tour, search), location.href);
    const p = details.searchParams;
    p.set('pace', search.pace);
    p.delete('handoff');
    try { history.replaceState(null, '', 'results.html?' + p.toString()); } catch (_) { /* sandboxed */ }
    return p.get('snapshot');
  }

  function savedTrip(query) {
    const q = query || new URLSearchParams(location.search);
    if (q.get('saved') !== 'true') return null;
    const id = q.get('snapshot');
    try {
      const env = id ? JSON.parse(localStorage.getItem('globevoy.generated.snapshot.v1.' + id) || 'null') : null;
      if (env?.tour?.cities?.length) return env.tour;
    } catch (_) { /* fall through */ }
    try {
      const tour = JSON.parse(sessionStorage.getItem('globevoy.multi.selected.v1') || 'null');
      if (tour?.cities?.length) return tour;
    } catch (_) { /* none */ }
    return null;
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  window.GlobevoyTripSearch = Object.freeze({
    pageSid: PAGE_SID,
    guestId: GUEST_ID,
    ROLES, CURRENCIES, PACES, resultsUrl, readSearch, apiParams, isMember, signIn, isFullyLive, findTrips, tripDetailsUrl, tripTotal, saveInBrowser, savedTrip
  });
})();
