// GlobeVoy results page: live trips on the route map from the Route Preview design.
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const S = window.GlobevoyTripSearch;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const constrained = () => reduce.matches || Boolean(navigator.connection?.saveData);
  const search = S.readSearch();
  const member = S.isMember();

  // ---------- formatting ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SYMBOL = { CAD: 'C$', USD: 'US$', EUR: '€', GBP: '£', AUD: 'A$' };
  function money(amount, currency) {
    const n = Math.round(Number(amount) || 0);
    return (SYMBOL[currency] || '') + n.toLocaleString('en-CA');
  }
  function day(iso, opts) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return '';
    const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    return d.toLocaleDateString('en-CA', opts || { month: 'short', day: 'numeric' });
  }
  function dateRange(a, b) {
    if (!a) return '';
    const yA = String(a).slice(0, 4), yB = String(b || '').slice(0, 4);
    if (!b) return day(a, { month: 'short', day: 'numeric', year: 'numeric' });
    return day(a) + (yA !== yB ? ', ' + yA : '') + ' – ' + day(b, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const cityName = c => c?.displayCity || c?.city || '';
  const originName = () => String(search.origin).replace(/\s*\([A-Z]{3}\)\s*$/, '');

  // ---------- loading screen ----------
  const loadingStarted = performance.now();
  let loadingTimer = null;
  function startLoading() {
    $('#loading-budget').textContent = search.budget ? money(search.budget, search.currency) : 'your budget';
    $('#loading-origin').textContent = originName();
    $('#loading-party').textContent = plural(search.adults, 'traveller', 'travellers');
    if (search.month) $('#loading-sub').lastChild.textContent = ' · ' + day(search.month + '-15', { month: 'long', year: 'numeric' });
    drawLoadingArcs();
    const steps = $$('#loading-steps li');
    const tick = () => {
      const s = (performance.now() - loadingStarted) / 1000;
      steps.forEach((li, i) => {
        const at = Number(li.dataset.at), next = steps[i + 1] ? Number(steps[i + 1].dataset.at) : Infinity;
        li.classList.toggle('is-done', s >= next);
        li.classList.toggle('is-active', s >= at && s < next);
      });
      // Eases toward 92% over ~40 s; the last stretch completes when results arrive.
      $('#loading-bar').style.transform = `scaleX(${0.92 * (1 - Math.exp(-s / 16))})`;
      if (s > 45) $('#loading-hint').textContent = 'Still checking live prices. Busy routes can take up to a minute.';
    };
    tick();
    loadingTimer = setInterval(tick, 250);
  }
  function drawLoadingArcs() {
    // Decorative: arcs from the origin dot to points across the "globe".
    const targets = [[205, 92], [268, 120], [318, 70], [362, 104], [410, 64], [455, 118], [500, 84], [538, 132], [250, 160], [430, 150], [340, 150], [560, 98]];
    const ox = 110, oy = 185;
    const arcs = targets.map(([x, y], i) => {
      const mx = (ox + x) / 2, my = Math.min(oy, y) - 55 - (i % 3) * 14;
      return `<path class="arc" style="--i:${i}" d="M${ox} ${oy} Q${mx} ${my} ${x} ${y}" pathLength="1"/>`;
    }).join('');
    const dots = targets.map(([x, y], i) => `<circle class="dot" style="--i:${i}" cx="${x}" cy="${y}" r="3.5"/>`).join('');
    $('.loading-arcs').innerHTML = arcs;
    $('.loading-dots').innerHTML = dots;
  }
  function stopLoading() {
    clearInterval(loadingTimer);
    $('#loading-bar').style.transform = 'scaleX(1)';
    const film = $('.loading-film');
    const done = () => { $('#loading').hidden = true; film.pause(); film.removeAttribute('src'); film.load(); };
    document.body.classList.remove('is-loading');
    if (constrained()) { done(); return; }
    $('#loading').classList.add('is-leaving');
    setTimeout(done, 650);
  }

  // ---------- state pages (no trip / error) ----------
  function showState(kind, opts) {
    stopLoading();
    $('#results').hidden = true;
    const st = $('#state');
    st.hidden = false;
    st.dataset.kind = kind;
    $('#state-kicker').textContent = opts.kicker;
    $('#state-title').textContent = opts.title;
    $('#state-copy').textContent = opts.copy;
    const primary = $('#state-primary');
    primary.textContent = opts.primaryText;
    primary.href = opts.primaryHref;
    if (opts.primaryClick) primary.addEventListener('click', opts.primaryClick, { once: true });
    $('#state-secondary').href = homeUrl();
    document.title = opts.title + ' | GlobeVoy';
    $('#main').focus();
  }
  function homeUrl() {
    const p = new URLSearchParams({ origin: search.origin, budget: String(search.budget), currency: search.currency, adults: String(search.adults) });
    if (search.month) p.set('month', search.month);
    p.set('pace', search.pace);
    return './index.html?' + p.toString() + '#search';
  }
  function retryUrl(budget) {
    return S.resultsUrl({ ...search, budget });
  }

  // ---------- trip view model ----------
  let trips = [], active = 0, view = null;
  function buildView(tour) {
    const cur = tour.displayBudget?.currency || search.currency;
    const origin = tour.origin || tour.legs?.[0]?.from || {};
    const legs = tour.legs || [];
    const cities = (tour.cities || []).map((c, i) => {
      const inbound = legs[i] || {};
      const stopInfo = inbound.to || {};
      return {
        id: 'c' + i,
        name: c.city,
        country: c.country,
        coords: [Number(c.latitude ?? c.lat), Number(c.longitude ?? c.lng)],
        nights: Number(c.nights) || 0,
        arrive: stopInfo.arrivalDate || inbound.arrivalDate || inbound.departureDate || c.hotel?.checkIn,
        leave: stopInfo.departureDate || c.hotel?.checkOut,
        hotel: c.hotel || null,
        vibes: c.vibes || [],
        inbound
      };
    });
    return {
      tour, cur,
      origin: { name: cityName(origin) || originName(), country: origin.country || '', coords: [Number(origin.latitude), Number(origin.longitude)] },
      cities, legs,
      start: tour.itineraryDatePlan?.canonicalDepartureDate || legs[0]?.departureDate,
      end: tour.itineraryDatePlan?.canonicalReturnDate || legs[legs.length - 1]?.departureDate,
      nights: Number(tour.totalNights || tour.tripDurationNights) || cities.reduce((s, c) => s + c.nights, 0)
    };
  }

  // ---------- option tabs ----------
  function renderTabs() {
    const wrap = $('#option-tabs');
    wrap.innerHTML = trips.map((t, i) => {
      const v = t.view;
      return `<button class="option-tab" role="tab" id="option-${i}" aria-selected="${i === active}" tabindex="${i === active ? 0 : -1}" data-option="${i}">
        <span class="option-role">${esc(t.meta.label)}</span>
        <strong>${esc(v.cities.map(c => c.name).join(' → '))}</strong>
        <span class="option-meta"><span>${plural(v.nights, 'night', 'nights')}</span><span>${money(t.tour.displayBudget?.tripEstimate, v.cur)}</span></span>
      </button>`;
    }).join('') + (!member ? `<div class="option-locked">
        <span class="option-role">2 more trips</span>
        <strong>In other parts of the world</strong>
        <button id="unlock" class="btn primary" type="button">Sign in to see them</button>
      </div>` : '');
    $$('.option-tab').forEach(b => {
      b.addEventListener('click', () => selectTrip(Number(b.dataset.option)));
      b.addEventListener('keydown', e => {
        const n = trips.length;
        let to = null;
        if (e.key === 'ArrowRight') to = (active + 1) % n;
        if (e.key === 'ArrowLeft') to = (active + n - 1) % n;
        if (to !== null) { e.preventDefault(); selectTrip(to); $('#option-' + to).focus(); }
      });
    });
    $('#unlock')?.addEventListener('click', () => S.signIn());
    $('#options-note').textContent = member
      ? (trips.length > 1 ? '' : 'One trip passed every live price check')
      : '';
  }

  function selectTrip(i) {
    if (!trips[i]) return;
    active = i;
    $$('.option-tab').forEach((b, n) => { b.setAttribute('aria-selected', String(n === i)); b.tabIndex = n === i ? 0 : -1; });
    view = trips[i].view;
    stopFrame();
    renderTrip(trips[i]);
    resetJourney();
  }

  // ---------- trip details ----------
  function renderTrip(t) {
    const v = t.view, tour = t.tour, b = tour.displayBudget || {};
    const names = v.cities.map(c => c.name);
    $('#trip-title').textContent = names.join(' → ');
    $('#trip-meta').innerHTML = [plural(v.nights, 'night', 'nights'), dateRange(v.start, v.end), plural(search.adults, 'traveller', 'travellers')]
      .map(x => `<span>${esc(x)}</span>`).join('');
    $('#live-note').textContent = 'Live prices, checked ' + checkedAgo(tour);
    const parts = [['Flights', b.flightEstimate, 'f'], ['Hotels', b.accommodationEstimate, 'h'], ['Spending money', b.reserveAmount, 'r'], ['Left over', b.amountLeft, 'l']];
    const total = Number(b.totalBudget) || parts.reduce((n, x) => n + (Number(x[1]) || 0), 0) || 1;
    $('#budget-bar').innerHTML = parts.map(([k, val, c]) => `<span class="seg seg-${c}" style="width:${Math.max(0, Number(val) || 0) / total * 100}%"></span>`).join('');
    $('#budget-bar').setAttribute('aria-label', parts.map(([k, val]) => `${k} ${money(val, v.cur)}`).join(', ') + ' of ' + money(total, v.cur));
    $('#summary-currency').textContent = v.cur + ' · ' + (search.adults === 1 ? 'for 1 traveller' : 'for ' + search.adults + ' travellers');
    $('#summary-total').innerHTML = money(b.tripEstimate, v.cur) + ' <small>flights and hotels</small>';
    $('#summary-line').textContent = 'of your ' + money(b.totalBudget || search.budget, v.cur) + ' budget';
    $('#summary-list').innerHTML = [
      ['Flights', money(b.flightEstimate, v.cur), 'f', 'Live'],
      ['Hotels, ' + plural(v.nights, 'night', 'nights'), money(b.accommodationEstimate, v.cur), 'h', 'Live'],
      ['Spending money', money(b.reserveAmount, v.cur), 'r'],
      ['Left over', money(b.amountLeft, v.cur), 'l']
    ].map(([k, val, c, tag]) => `<div><dt><i class="key seg-${c}"></i>${esc(k)}${tag ? ` <em class="tag">${tag}</em>` : ''}</dt><dd>${esc(val)}</dd></div>`).join('');
    $('#summary-budget').textContent = money(b.totalBudget || search.budget, v.cur) + ' ' + v.cur;
    $('#summary-note').textContent = 'You confirm the final price when you book with the airline and hotel.';
    $('#summary-origin').textContent = [v.origin.name, v.origin.country].filter(Boolean).join(', ');
    $('#book').href = S.tripDetailsUrl(tour, search);

    $('#destinations').innerHTML = v.cities.map(c => {
      const leg = c.inbound, flight = leg.cheapestOneWay || {};
      const flightText = [flight.carrier, flight.stops === 0 ? 'nonstop' : (flight.stops ? plural(flight.stops, 'stop', 'stops') : ''), day(leg.departureDate)].filter(Boolean).join(' · ');
      const hotel = c.hotel?.name || c.hotel?.hotelName;
      const rating = Number(c.hotel?.rating);
      return `<article id="card-${c.id}" class="destination">
        <button class="city-card" type="button" data-city="${c.id}" aria-pressed="false">
          <div class="card-photo"><img data-photo="${c.id}" alt="${esc(c.name)}, ${esc(c.country)}" hidden><div class="map-card" data-mapcard="${c.id}"><svg width="100" height="80" viewBox="0 0 100 80" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="m9 25 27-14 29 12 26-14v45L65 68 36 56 9 70Zm27-14v45m29-33v45"/><path d="M54 24a11 11 0 0 1 22 0c0 8-11 20-11 20S54 32 54 24Z"/><circle cx="65" cy="24" r="3"/></svg><span class="map-caption">${Math.abs(c.coords[0]).toFixed(2)}° ${c.coords[0] >= 0 ? 'N' : 'S'} · ${Math.abs(c.coords[1]).toFixed(2)}° ${c.coords[1] >= 0 ? 'E' : 'W'}</span></div><span class="exploring">Exploring now</span></div>
          <div class="card-title"><h3>${esc(c.name)}</h3><span>${esc(c.country)}</span></div>
          <div class="card-meta"><span>${plural(c.nights, 'night', 'nights')}</span><span>${esc(dateRange(c.arrive, c.leave))}</span></div>
        </button>
        <div class="card-foot">
          ${c.vibes.length ? `<p class="vibes">${esc(vibeLine(c.vibes))}</p>` : ''}
          ${hotel ? `<p><strong>Stay</strong> ${esc(hotel)}${rating ? ` · ${rating.toFixed(1)}/10` : ''}</p>` : ''}
          ${flightText ? `<p><strong>Fly in</strong> ${esc(flightText)}</p>` : ''}
        </div>
      </article>`;
    }).join('');
    $$('#destinations [data-city]').forEach(btn => btn.addEventListener('click', () => manualSelect(btn.dataset.city)));
    v.cities.forEach(loadCityPhoto);
    renderRail();
    $('.mobile-breakdown')?.remove();
    const d = document.createElement('details');
    d.className = 'mobile-breakdown';
    d.innerHTML = '<summary>Price breakdown</summary>' + $('#summary-list').outerHTML.replace('id="summary-list"', '') + `<p>Budget ${esc($('#summary-budget').textContent)}. ${esc($('#summary-note').textContent)}</p><a class="btn primary" href="${esc($('#book').href)}">View trip &amp; book</a>`;
    $('.dest-section').before(d);
  }
  const VIBES = { beach: 'beaches', relaxation: 'slow days', culture: 'culture', nightlife: 'nightlife', food: 'food', nature: 'nature', history: 'history', architecture: 'architecture', adventure: 'adventure', shopping: 'shopping', family: 'family time', romance: 'romance', art: 'art', music: 'music' };
  const vibeLine = list => 'For ' + list.slice(0, 3).map(v => VIBES[v] || v).join(', ').replace(/, ([^,]*)$/, ' and $1');
  function checkedAgo(tour) {
    const times = (tour.legs || []).map(l => Date.parse(l.cheapestOneWay?.observedAt || '')).filter(Number.isFinite);
    if (!times.length) return 'just now';
    const mins = Math.round((Date.now() - Math.min(...times)) / 60000);
    return mins <= 1 ? 'just now' : mins + ' minutes ago';
  }

  // ---------- city media ----------
  const SCENES = { lisbon: 'video', seville: 'video', tokyo: 'video', prague: 'video', vienna: 'video', budapest: 'video', seoul: 'video', taipei: 'video', marrakech: 'photo' };
  const mediaCache = {};
  function sceneKey(name) { return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''); }
  async function mediaFor(c) {
    if (mediaCache[c.id + view.tour.routeId]) return mediaCache[c.id + view.tour.routeId];
    const key = sceneKey(c.name);
    let media = { kind: 'map' };
    if (SCENES[key]) {
      const poster = `./assets/media/scenes/${key}.jpg`;
      media = SCENES[key] === 'video' ? { kind: 'video', url: `./assets/media/scenes/${key}.mp4`, poster } : { kind: 'photo', url: poster };
    } else if (window.GlobevoyCityImages?.get) {
      try {
        const found = await window.GlobevoyCityImages.get(c.name, c.country, '');
        const url = typeof found === 'string' ? found : found?.url || found?.src || '';
        if (url) media = { kind: 'photo', url };
      } catch (_) { /* map only */ }
    }
    mediaCache[c.id + view.tour.routeId] = media;
    return media;
  }
  async function loadCityPhoto(c) {
    const forView = view;
    const media = await mediaFor(c);
    if (forView !== view) return;
    const img = document.querySelector(`[data-photo="${c.id}"]`), card = document.querySelector(`[data-mapcard="${c.id}"]`);
    if (!img || media.kind === 'map') return;
    img.onload = () => { img.hidden = false; card.hidden = true; };
    img.onerror = () => { img.hidden = true; card.hidden = false; };
    img.src = media.poster || media.url;
  }

  // ---------- map + journey (Route Preview engine, any number of cities) ----------
  let map, routeLine, ghostLine, plane, originMarker, cityMarkers = {}, phases = [], duration = 0, phaseIndex = -1,
    clockFrame = null, playing = false, elapsed = 0, lastTick = 0, activeCity = null, mediaVersion = 0, panelShown = false,
    manualPreview = false, mediaExitTimer = null, countriesLoaded = null;
  const planeSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 10 7 2 6-8 2 1-3 9 5 3-1 2-7-2-4 4-2-1 2-5-5-3Z"/></svg>';
  const DEG = Math.PI / 180;
  const stops = () => [view.origin, ...view.cities, view.origin];
  function geodesic(a, b, t) {
    const A = a.map(n => n * DEG), B = b.map(n => n * DEG), v = p => [Math.cos(p[0]) * Math.cos(p[1]), Math.cos(p[0]) * Math.sin(p[1]), Math.sin(p[0])], u = v(A), w = v(B),
      d = Math.acos(Math.min(1, Math.max(-1, u.reduce((s, n, i) => s + n * w[i], 0))));
    if (d < 1e-8) return a;
    const x = Math.sin((1 - t) * d) / Math.sin(d), y = Math.sin(t * d) / Math.sin(d), c = u.map((n, i) => x * n + y * w[i]);
    return [Math.atan2(c[2], Math.hypot(c[0], c[1])) / DEG, Math.atan2(c[1], c[0]) / DEG];
  }
  // Keep longitudes continuous so routes across the Pacific don't wrap around the map.
  function unwrap(list, ref) {
    let prev = ref;
    return list.map(([lat, lng]) => {
      if (prev !== undefined) { while (lng - prev > 180) lng -= 360; while (lng - prev < -180) lng += 360; }
      prev = lng;
      return [lat, lng];
    });
  }
  let legCache = [];
  function computeLegs() {
    const s = stops();
    legCache = [];
    let ref = s[0].coords[1];
    for (let i = 0; i < s.length - 1; i += 1) {
      const a = s[i].coords, b = s[i + 1].coords;
      const pts = unwrap(Array.from({ length: 81 }, (_, n) => geodesic(a, b, n / 80)), ref);
      ref = pts[pts.length - 1][1];
      legCache.push(pts);
    }
    // Unwrapped city positions follow the route.
    view.cities.forEach((c, i) => { c.mapCoords = legCache[i][legCache[i].length - 1]; });
    view.origin.mapCoords = legCache[0][0];
  }
  function legPoints(i, f = 1) {
    const pts = legCache[i];
    const upto = Math.max(1, Math.ceil(f * (pts.length - 1)));
    const out = pts.slice(0, upto + 1);
    if (f < 1) out[out.length - 1] = pointAt(i, f);
    return out;
  }
  function pointAt(i, f) {
    const pts = legCache[i], x = f * (pts.length - 1), n = Math.min(pts.length - 2, Math.floor(x)), t = x - n;
    return [pts[n][0] + (pts[n + 1][0] - pts[n][0]) * t, pts[n][1] + (pts[n + 1][1] - pts[n][1]) * t];
  }
  function routePoints(leg = legCache.length - 1, f = 1) { let all = []; for (let i = 0; i <= leg; i += 1) all = all.concat(legPoints(i, i === leg ? f : 1)); return all; }
  function bearing(a, b) { const p = a[0] * DEG, q = b[0] * DEG, d = (b[1] - a[1]) * DEG; return Math.atan2(Math.sin(d) * Math.cos(q), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d)) / DEG - 35; }
  function fitFull(animate = true) { if (map) map.fitBounds(routePoints(), { paddingTopLeft: [55, 80], paddingBottomRight: [55, 62], animate: animate && !constrained(), duration: 0.75, maxZoom: 5 }); }
  function setStatus(s) { $('#journey-status').textContent = s; }
  function controls() {
    const btn = $('#play');
    btn.setAttribute('aria-pressed', String(playing));
    btn.querySelector('span').textContent = constrained() ? 'Select a destination' : playing ? 'Pause' : elapsed > 0 && elapsed < duration ? 'Resume' : 'Play journey';
    btn.disabled = constrained();
    $('#replay').disabled = constrained();
  }
  function buildPhases() {
    phases = []; duration = 0;
    const add = (kind, length, leg) => { phases.push({ kind, start: duration, length, leg }); duration += length; };
    add('overview', 900);
    const n = view.cities.length;
    for (let i = 0; i <= n; i += 1) { add('flight', 3200, i); if (i < n) add('arrival', 3900, i); else add('complete', 800, i); }
  }
  const markerIcon = (i, on) => L.divIcon({ className: 'map-point' + (on ? ' active' : ''), html: String(i + 1), iconSize: [29, 29], iconAnchor: [14.5, 14.5] });

  async function initMap() {
    map = L.map('map', { zoomControl: false, scrollWheelZoom: false, keyboard: true, worldCopyJump: false, preferCanvas: true }).setView([30, -30], 2);
    L.control.zoom({ position: 'topright' }).addTo(map);
    map.attributionControl.addAttribution('© Natural Earth · public domain');
    countriesLoaded = fetch('./assets/map/countries.geo.json').then(r => r.json()).then(data => {
      const renderer = L.canvas({ padding: 0.5 });
      // Three copies so routes that cross the Pacific still have land under them.
      [-360, 0, 360].forEach(offset => L.geoJSON(data, {
        renderer, interactive: false,
        style: { color: '#b4c5b7', weight: 1, fillColor: '#f3f1e6', fillOpacity: 1 },
        coordsToLatLng: c => L.latLng(c[1], c[0] + offset)
      }).addTo(map));
    }).catch(() => { /* map lines still work without country shapes */ });
  }
  function drawRoute() {
    computeLegs();
    buildPhases();
    [ghostLine, routeLine, plane, originMarker, ...Object.values(cityMarkers)].forEach(l => l && l.remove());
    cityMarkers = {};
    ghostLine = L.polyline(routePoints(), { color: '#075a59', weight: 1.8, dashArray: '5 7', opacity: 0.42 }).addTo(map);
    routeLine = L.polyline([], { color: '#075a59', weight: 3, opacity: 1 }).addTo(map);
    view.cities.forEach((c, i) => {
      cityMarkers[c.id] = L.marker(c.mapCoords, { icon: markerIcon(i, false), title: `Explore ${c.name}`, alt: `Explore ${c.name}`, keyboard: true })
        .addTo(map).bindTooltip(c.name, { permanent: true, direction: 'top', offset: [0, -13], className: 'city-tip' })
        .on('click', () => manualSelect(c.id));
    });
    originMarker = L.marker(view.origin.mapCoords, { icon: L.divIcon({ className: 'origin-point', iconSize: [19, 19], iconAnchor: [9.5, 9.5] }), keyboard: false })
      .addTo(map).bindTooltip(view.origin.name + ' · departure & return', { permanent: true, direction: 'bottom', offset: [0, 12], className: 'city-tip' });
    plane = L.marker(view.origin.mapCoords, { icon: L.divIcon({ className: 'plane-marker', html: planeSVG, iconSize: [35, 35], iconAnchor: [17.5, 17.5] }), keyboard: false, interactive: false }).addTo(map);
    fitFull(false);
  }
  const PLANE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 7 2 6-8 2 1-3 9 5 3-1 2-7-2-4 4-2-1 2-5-5-3Z"/></svg>';
  function renderRail() {
    const v = view;
    const hop = leg => {
      const f = leg?.cheapestOneWay || {};
      const info = [f.carrier, f.stops === 0 ? 'nonstop' : ''].filter(Boolean).join(', ');
      return `<li class="tl-hop" aria-hidden="true">${PLANE}<span>${esc(info)}</span></li>`;
    };
    let html = `<li class="tl-end"><strong>${esc(v.origin.name)}</strong><span>Leave ${esc(day(v.start))}</span></li>`;
    v.cities.forEach((c, i) => {
      html += hop(v.legs[i]) + `<li class="tl-stop"><button type="button" data-city="${c.id}" aria-pressed="false"><strong>${esc(c.name)}</strong><span>${plural(c.nights, 'night', 'nights')}</span></button></li>`;
    });
    html += hop(v.legs[v.cities.length]) + `<li class="tl-end"><strong>${esc(v.origin.name)}</strong><span>Home ${esc(day(v.end))}</span></li>`;
    $('#route-rail').innerHTML = html;
    $$('#route-rail [data-city]').forEach(b => b.addEventListener('click', () => manualSelect(b.dataset.city)));
  }
  function resetJourney() {
    clearMedia();
    elapsed = 0; phaseIndex = -1; manualPreview = false;
    if (map) { drawRoute(); markCity(null); }
    updateProgress();
    controls();
    setStatus(constrained() ? 'Motion is off. Select any destination to explore.' : 'Ready when you are.');
  }

  function cancelMediaExit() { if (mediaExitTimer) clearTimeout(mediaExitTimer); mediaExitTimer = null; }
  function fadeOutPanel() {
    cancelMediaExit();
    const version = mediaVersion, panel = $('#media-panel'), img = $('#media-photo');
    panel.classList.add('entering'); panel.setAttribute('aria-hidden', 'true'); panel.inert = true;
    const hide = () => { if (version !== mediaVersion) return; panel.hidden = true; img.removeAttribute('src'); mediaExitTimer = null; };
    if (panel.hidden || constrained()) hide(); else mediaExitTimer = setTimeout(hide, 320);
  }
  function clearMedia() {
    mediaVersion += 1; panelShown = false;
    const v = $('#city-video'); v.pause(); v.hidden = true; v.removeAttribute('src'); v.load();
    fadeOutPanel();
  }
  function markCity(id) {
    activeCity = id;
    $$('[data-city]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.city === id)));
    $$('.destination').forEach(card => card.classList.toggle('active', card.id === 'card-' + id));
    view.cities.forEach((c, i) => cityMarkers[c.id]?.setIcon(markerIcon(i, c.id === id)));
  }
  const cityById = id => view.cities.find(c => c.id === id);
  async function showMedia(id) {
    const token = ++mediaVersion; cancelMediaExit(); panelShown = true;
    const c = cityById(id); if (!c) return;
    const media = await mediaFor(c);
    if (token !== mediaVersion || activeCity !== id || !panelShown) return;
    renderMedia(c, media);
  }
  function renderMedia(c, media) {
    const v = $('#city-video'), img = $('#media-photo'), panel = $('#media-panel');
    v.pause(); v.onloadeddata = null; v.onerror = null; v.ontimeupdate = null; v.hidden = true; v.removeAttribute('src'); img.hidden = true; img.onerror = null;
    if (media.kind === 'map') { fadeOutPanel(); setStatus(`${c.name} · ${plural(c.nights, 'night', 'nights')}`); return; }
    $('#media-city').textContent = c.name; $('#media-country').textContent = c.country;
    cancelMediaExit(); panel.hidden = false; panel.inert = false; panel.setAttribute('aria-hidden', 'false'); panel.classList.add('entering');
    const visibleVersion = mediaVersion;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (visibleVersion === mediaVersion && panelShown) panel.classList.remove('entering'); }));
    const poster = media.poster || media.url;
    img.src = poster; img.alt = `${c.name}, ${c.country}`; img.hidden = false;
    img.onerror = () => { v.pause(); panel.hidden = true; };
    const stay = c.hotel?.name ? ' · ' + c.hotel.name : '';
    $('#media-state').textContent = plural(c.nights, 'night', 'nights') + ' · ' + dateRange(c.arrive, c.leave) + stay;
    if (media.kind === 'video' && !constrained()) {
      v.poster = poster; v.src = media.url; v.muted = true; v.currentTime = 0;
      v.onloadeddata = () => { if (activeCity !== c.id || !panelShown || document.hidden) return; v.hidden = false; if (playing || manualPreview) v.play().catch(() => { v.hidden = true; }); };
      v.onerror = () => { v.hidden = true; };
      v.ontimeupdate = () => { if (v.currentTime >= 3 && playing) v.pause(); };
      v.load();
    }
  }
  function stopFrame() { if (clockFrame) cancelAnimationFrame(clockFrame); clockFrame = null; playing = false; map?.stop(); $('#city-video').pause(); controls(); }
  function manualSelect(id) {
    if (!routeLine) { setStatus('The map is loading. Try again shortly.'); return; }
    const c = cityById(id); if (!c) return;
    stopFrame(); clearMedia(); manualPreview = true; markCity(id);
    const idx = view.cities.indexOf(c);
    const p = phases.find(x => x.kind === 'arrival' && x.leg === idx);
    elapsed = p.start + 900; phaseIndex = phases.indexOf(p);
    routeLine.setLatLngs(routePoints(p.leg, 1)); plane.setLatLng(c.mapCoords);
    map.flyTo(c.mapCoords, 6.5, { animate: !constrained(), duration: constrained() ? 0 : 0.8 });
    setStatus(`${c.name} · exploring now`);
    showMedia(id); controls(); updateProgress();
    if (matchMedia('(max-width:600px)').matches) $('.map-shell').scrollIntoView({ behavior: constrained() ? 'auto' : 'smooth', block: 'center' });
  }
  function enterPhase(p) {
    clearMedia(); manualPreview = false;
    const s = stops();
    if (p.kind === 'overview') { markCity(null); routeLine.setLatLngs([]); plane.setLatLng(view.origin.mapCoords); fitFull(); setStatus(view.origin.name + ' · the journey begins'); }
    else if (p.kind === 'flight') {
      markCity(null);
      map.fitBounds(legPoints(p.leg), { paddingTopLeft: [60, 85], paddingBottomRight: [60, 65], maxZoom: 6, animate: !constrained(), duration: 0.7 });
      const leg = view.legs[p.leg], carrier = leg?.cheapestOneWay?.carrier;
      setStatus(`${s[p.leg].name} → ${s[p.leg + 1].name}${carrier ? ' · ' + carrier : ''}`);
    } else if (p.kind === 'arrival') {
      const c = view.cities[p.leg]; markCity(c.id);
      map.flyTo(c.mapCoords, 6.5, { animate: !constrained(), duration: 0.85 });
      setStatus(`${c.name} · ${plural(c.nights, 'night', 'nights')}`);
    } else if (p.kind === 'complete') { markCity(null); fitFull(); setStatus('Back to ' + view.origin.name + ' · full route'); }
  }
  function updateProgress() {
    const val = duration ? Math.min(elapsed / duration * 100, 100) : 0;
    $('#progress').style.width = val + '%';
    $('.journey-progress').setAttribute('aria-valuenow', String(Math.round(val)));
  }
  function advance() {
    const i = Math.min(phases.findIndex(p => elapsed < p.start + p.length), phases.length - 1), p = phases[i];
    if (i !== phaseIndex) { phaseIndex = i; enterPhase(p); }
    const local = elapsed - p.start;
    if (p.kind === 'flight') {
      const f = Math.min(local / p.length, 1), a = pointAt(p.leg, f), b = pointAt(p.leg, Math.min(f + 0.01, 1));
      routeLine.setLatLngs(routePoints(p.leg, f)); plane.setLatLng(a);
      plane.getElement()?.style.setProperty('--bearing', bearing(a, b) + 'deg');
    } else if (p.kind === 'arrival') {
      const c = view.cities[p.leg];
      routeLine.setLatLngs(routePoints(p.leg)); plane.setLatLng(c.mapCoords);
      if (local >= 900 && !panelShown) showMedia(c.id);
    }
    updateProgress();
  }
  function start(replay = false) {
    if (constrained()) { setStatus('Motion is off. Select any destination to explore.'); return; }
    if (!routeLine) { setStatus('The map is still loading. Try again shortly.'); return; }
    if (playing && !replay) { stopFrame(); setStatus('Paused · resume whenever you’re ready.'); return; }
    if (replay || elapsed >= duration) { stopFrame(); clearMedia(); elapsed = 0; phaseIndex = -1; }
    manualPreview = false; playing = true; lastTick = performance.now();
    const resume = phases[phaseIndex];
    if (resume?.kind === 'arrival') map.flyTo(view.cities[resume.leg].mapCoords, 6.5, { animate: true, duration: 0.45 });
    else if (resume?.kind === 'flight') map.fitBounds(legPoints(resume.leg), { paddingTopLeft: [60, 85], paddingBottomRight: [60, 65], maxZoom: 6, animate: true, duration: 0.45 });
    const v = $('#city-video'); if (panelShown && v.src && v.currentTime < 3) v.play().catch(() => {});
    controls();
    const tick = now => {
      if (!playing) return;
      elapsed = Math.min(elapsed + Math.min(now - lastTick, 100), duration); lastTick = now;
      if (elapsed >= duration) { skip(true); return; }
      advance(); clockFrame = requestAnimationFrame(tick);
    };
    clockFrame = requestAnimationFrame(tick);
  }
  function skip(completed = false) {
    stopFrame(); clearMedia(); elapsed = duration; phaseIndex = phases.length - 1; markCity(null);
    routeLine?.setLatLngs(routePoints()); plane?.setLatLng(view.origin.mapCoords); fitFull(); updateProgress();
    setStatus(completed ? `Journey complete · ${view.origin.name} to ${view.origin.name}.` : 'Full route · animation skipped.'); controls();
  }

  function bind() {
    $('#play').onclick = () => start();
    $('#replay').onclick = () => start(true);
    $('#skip').onclick = () => skip();
    $('#fit').onclick = () => { stopFrame(); clearMedia(); fitFull(); setStatus('Full route. Select a city or resume.'); };
    $('#close-media').onclick = () => { clearMedia(); $('#play').focus(); };
    $('#new-search').href = homeUrl();
    const signin = $('#signin');
    if (member) { signin.textContent = 'Your account'; signin.onclick = () => { location.href = './account.html'; }; }
    else signin.onclick = () => S.signIn();
    reduce.addEventListener('change', () => { if (constrained()) stopFrame(); controls(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { manualPreview = false; stopFrame(); $$('video').forEach(v => { if (!v.classList.contains('loading-film')) v.pause(); }); } });
  }

  async function run() {
    bind();
    if (!search.budget) {
      showState('input', { kicker: 'Almost there', title: 'Tell us your budget first', copy: 'GlobeVoy plans the whole trip around one number: your total budget for flights and hotels.', primaryText: 'Enter a budget', primaryHref: homeUrl() });
      return;
    }
    startLoading();
    let result;
    try {
      result = await S.findTrips(search, { member });
    } catch (error) {
      showState('error', {
        kicker: 'Connection problem', title: 'We couldn’t reach our trip planner',
        copy: error?.message === 'not-configured' ? 'This copy of the site isn’t connected to the GlobeVoy trip planner.' : 'Live prices didn’t come back in time. Your search is saved, so trying again is quick.',
        primaryText: 'Try again', primaryHref: location.href
      });
      return;
    }
    if (!result.trips.length) {
      const nt = result.noTrip;
      if (nt) {
        const suggested = Number(nt.suggestedBudget);
        showState('no-trip', {
          kicker: 'Close, but not quite', title: nt.title || 'No complete trip fits this budget yet', copy: nt.message || 'Try a slightly higher budget or a different month.',
          primaryText: suggested ? `Search with ${money(suggested, nt.currency || search.currency)}` : 'Change search',
          primaryHref: suggested ? retryUrl(suggested) : homeUrl()
        });
      } else {
        showState(result.failed ? 'error' : 'no-trip', {
          kicker: result.failed ? 'Connection problem' : 'No live trip yet',
          title: result.failed ? 'We couldn’t reach our trip planner' : 'No trip passed every live price check',
          copy: result.failed ? 'Live prices didn’t come back in time. Please try again.' : 'We only show trips where every flight and hotel price was confirmed live, and none did this time. Prices move quickly; a new search often finds one.',
          primaryText: 'Search again', primaryHref: location.href
        });
      }
      return;
    }
    trips = result.trips.map(t => ({ ...t, view: buildView(t.tour) }));
    active = 0; view = trips[0].view;
    $('#results').hidden = false;
    $('#options-heading').textContent = `Trips from ${originName()} for ${money(search.budget, search.currency)}`;
    renderTabs();
    renderTrip(trips[0]);
    await initMap();
    drawRoute();
    controls();
    if (constrained()) setStatus('Motion is off. Select any destination to explore.');
    document.title = trips[0].view.cities.map(c => c.name).join(' + ') + ' | GlobeVoy';
    stopLoading();
    map.invalidateSize();
    fitFull(false);
    countriesLoaded?.then(() => map.invalidateSize());
  }

  window.GlobevoyResults = { getState: () => ({ trips: trips.length, active, playing, elapsed, duration, activeCity }) };
  run();
})();
