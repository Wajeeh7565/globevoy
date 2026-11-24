(function () {
  'use strict';

  const query = new URLSearchParams(location.search);
  const api = window.GlobevoyApi;
  const storageKey = 'globevoy.multi.selected.v1';
  const snapshotPrefix = 'globevoy.generated.snapshot.v1.';
  const roles = [
    ['lowest-cost', 'Lowest cost'],
    ['best-balance', 'Best use of your budget'],
    ['most-memorable', 'Something different'],
  ];
  const usable = tour => Boolean(tour && Array.isArray(tour.cities) && tour.cities.length);
  const snapshotId = () => query.get('snapshot') || '';
  const parse = (store, key) => {
    try { return JSON.parse(store.getItem(key)); } catch { return null; }
  };
  const write = (store, key, value) => {
    try { store.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const code = city => city.cityId || city.id || city.airportCode || city.code || city.city;
  const routeKey = tour => tour.cities.map(city => String(code(city) || '').toLowerCase()).sort().join('>');
  const options = Object.fromEntries(query);
  delete options.returnTo;
  delete options.generated;
  const isMember = () => Boolean(window.GlobevoyAuth705B?.getSession?.());

  function selectedTour(payload) {
    const tour = payload?.tour || payload?.tours?.[0];
    return payload?.supported !== false && tour?.pickRoleMatched !== false && usable(tour) ? tour : null;
  }

  function noTrip(details) {
    return Object.assign(new Error(details?.message || 'No trip matched this search.'), { noTrip: details || true });
  }

  async function fetchTrips() {
    if (query.get('saved') === 'true' && snapshotId()) {
      const local = parse(localStorage, snapshotPrefix + snapshotId())?.tour;
      if (usable(local)) return [local];
      if (query.has('savedStops') || query.has('savedStopRefs')) {
        const payload = await api.getGeneratedTourControl({
          ...options, action: 'restore', currentStops: query.get('savedStops') || '',
          currentStopRefs: query.get('savedStopRefs') || '', departureDate: query.get('savedDepartureDate') || '',
        });
        const restored = selectedTour(payload);
        if (restored) return [restored];
      }
      throw new Error('This saved trip is unavailable.');
    }
    if (query.get('generated') !== 'true') {
      const stored = parse(sessionStorage, storageKey);
      if (usable(stored) && (!query.has('routeId') || query.get('routeId') === stored.routeId)) return [stored];
      throw noTrip({ title: 'Start a trip search', message: 'Choose a starting city and enter a budget to find your trip.' });
    }

    const member = isMember();
    const key = 'globevoy.cinematic.search.v1.' + (member ? 'member.' : 'guest.') + query.toString();
    const cached = parse(sessionStorage, key);
    if (cached?.at > Date.now() - 15 * 60000 && Array.isArray(cached.tours) && cached.tours.every(usable) && cached.tours.length) return cached.tours;

    const wanted = member ? [roles[1], roles[0], roles[2]] : [roles[1]];
    const requests = wanted.map(([role]) => api.getGeneratedTour({
      ...options, routeRole: role, pickRole: role, threePickRequest: 'true',
      diversityRequest: 'true', routeRankingCandidateLimit: '3', diversityCandidateLimit: '12',
    }));
    const results = await Promise.allSettled(requests);
    const used = new Set();
    const trips = [];
    let explanation;
    for (const [index, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue;
      explanation ||= result.value?.noTrip;
      const tour = selectedTour(result.value);
      if (!tour || used.has(routeKey(tour))) continue;
      used.add(routeKey(tour));
      trips.push({ ...tour, pickRole: wanted[index][0], pickRoleLabel: wanted[index][1] });
    }
    if (!trips.length) {
      if (results.every(result => result.status === 'rejected')) throw results[0].reason;
      throw noTrip(explanation);
    }
    write(sessionStorage, key, { at: Date.now(), tours: trips });
    return trips;
  }

  function remember(tour) {
    return write(sessionStorage, storageKey, tour);
  }

  function save(tour) {
    const id = snapshotId() && window.__gvGeneratedTour === tour && query.get('saved') === 'true' ? snapshotId() : crypto.randomUUID();
    const params = new URLSearchParams(query);
    const departure = tour.itineraryDatePlan?.canonicalDepartureDate;
    params.set('generated', 'true');
    params.set('saved', 'true');
    params.set('snapshot', id);
    params.set('savedStops', tour.cities.map(code).filter(Boolean).join(','));
    params.set('savedStopRefs', JSON.stringify(tour.cities.map(city => ({
      cityId: city.cityId || city.id || '', airportCode: city.airportCode || city.code || '',
      city: city.city || '', countryCode: city.countryCode || '',
    }))));
    params.set('pickRole', tour.pickRole || 'best-balance');
    params.set('handoff', 'same-tab');
    if (departure) params.set('savedDepartureDate', departure);
    let stored = write(localStorage, snapshotPrefix + id, { version: 'cinematic-1', savedAt: new Date().toISOString(), tour });
    stored = remember(tour) || stored;
    try {
      window.name = 'globevoy.trip.handoff.v1:' + JSON.stringify({ id, tour });
      stored = true;
    } catch {}
    return stored ? params : null;
  }

  window.GlobevoyCinematicSearch = Object.freeze({ fetchTrips, remember, save, isMember });
})();
