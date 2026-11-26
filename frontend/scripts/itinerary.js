// GV-WEB-3 — itinerary page ("Cinematic Scroll Journey" design).
//
// Shows the trip the results page handed over, stop by stop: each flight, each
// city with its photo and hotel, and a map that follows the scroll. Prices come
// from the trip's displayBudget; they are labelled live only while the signed
// quote check (GlobevoyJourneyQuote) says so. This page never prices a trip.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const q = new URLSearchParams(location.search);
  const S = window.GlobevoyTripSearch;
  const H = window.GlobevoyTripHandoff;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- formatting (same as the results page) ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SYMBOL = { CAD: 'C$', USD: 'US$', EUR: '€', GBP: '£', AUD: 'A$' };
  const num = (v, d = NaN) => { const n = Number(v); return v === null || v === '' || !Number.isFinite(n) ? d : n; };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  function day(iso, opts) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return '';
    return new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-CA', opts || { month: 'short', day: 'numeric' });
  }
  function dateRange(a, b) {
    if (!a) return '';
    if (!b) return day(a, { month: 'short', day: 'numeric', year: 'numeric' });
    return day(a) + (String(a).slice(0, 4) !== String(b).slice(0, 4) ? ', ' + String(a).slice(0, 4) : '') + ' – ' + day(b, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const flightTime = m => (num(m) > 0 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '');
  const flag = cc => /^[a-z]{2}$/.test(cc || '') ? `<img class="flag" src="./assets/flags/${cc}.svg" alt="" width="20" height="15" loading="lazy">` : '';
  const ICON_FLIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 7 2 6-8 2 1-3 9 5 3-1 2-7-2-4 4-2-1 2-5-5-3Z"/></svg>';
  const ICON_BED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19V7m18 12v-6a2 2 0 0 0-2-2H3m0 5h18M7 11V8h5a2 2 0 0 1 2 2v1"/></svg>';

  let tour = null, view = null, verifiedUntil = 0;
  const money = v => (SYMBOL[view.cur] || '') + Math.round(num(v, 0)).toLocaleString('en-CA');
  const live = () => verifiedUntil > Date.now();

  // ---------- view model ----------
  function point(node) {
    const lat = num(node?.latitude ?? node?.lat), lng = num(node?.longitude ?? node?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
  }
  function airport(node) { const c = String(node?.displayCode || node?.airportCode || node?.code || '').toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : ''; }
  function buildView(t) {
    const legs = Array.isArray(t.legs) && t.legs.length ? t.legs : (Array.isArray(t.backendLegs) ? t.backendLegs : []);
    const b = t.displayBudget || {};
    const cur = String(b.currency || t.budget?.total?.currency || q.get('currency') || 'CAD').toUpperCase();
    const rate = num(b.exchangeRateFromUsd, 1);
    const o = t.origin || legs[0]?.from || {};
    const requested = String(q.get('origin') || '').replace(/\s*\([A-Za-z]{3}\)\s*$/, '').split(',')[0].trim();
    const origin = { name: o.displayCity || o.city || requested || 'Home', country: o.country || '', code: airport(o) || airport(legs[0]?.from),
      cc: String(o.countryCode || legs[0]?.from?.countryCode || '').toLowerCase(), point: point(o) };
    const cities = (t.cities || []).map((c, i) => {
      const inbound = legs[i] || {}, to = inbound.to || {};
      return { name: c.displayCity || c.city, country: c.country || '', code: airport(c) || airport(to),
        cc: String(to.countryCode || c.countryCode || '').toLowerCase(), point: point(c), nights: num(c.nights, 0),
        arrive: to.arrivalDate || inbound.arrivalDate || inbound.departureDate || c.hotel?.checkIn || c.arrivalDate,
        leave: legs[i + 1]?.departureDate || c.hotel?.checkOut || c.departureDate, hotel: c.hotel || {}, index: i };
    });
    const stays = cities.map(c => {
      const line = b.lineItems?.stays?.[c.index];
      const price = line ? num(line.room, 0) + num(line.mandatoryFees, 0) : num(c.hotel.totalStayUsd ?? c.hotel.estimatedStayUsd) * rate;
      const fee = line ? num(line.mandatoryFees, 0) : num(c.hotel.payAtHotel?.usd, 0) * rate;
      return { city: c, price, fee };
    });
    const flights = legs.map((leg, i) => {
      const f = leg.cheapestOneWay || leg.providerDateEvidence || {};
      let price = num(b.lineItems?.flights?.[i]);
      if (!Number.isFinite(price)) price = cur === String(f.displayCurrency || f.currency || '').toUpperCase() && Number.isFinite(num(f.partyTotalAmountDisplay ?? f.displayPrice)) ?
        num(f.partyTotalAmountDisplay ?? f.displayPrice) : num(leg.amountUsd ?? f.partyTotalAmountUsd) * rate;
      return { leg, price, carrier: f.carrier || leg.airline || leg.operator || '', stops: f.stops, minutes: f.durationMinutes,
        date: leg.departureDate || f.departureDate, from: i === 0 ? origin : cities[i - 1] || origin, to: cities[i] || origin, observedAt: f.observedAt };
    });
    const start = t.itineraryDatePlan?.canonicalDepartureDate || flights[0]?.date;
    const end = t.itineraryDatePlan?.canonicalReturnDate || flights[flights.length - 1]?.date;
    const nights = num(t.totalNights ?? t.tripDurationNights, 0) || cities.reduce((s, c) => s + c.nights, 0);
    const travellers = num(t.passengerPricing?.travellers, 0) || num(q.get('adults') || q.get('passengers'), 1);
    return { cur, origin, cities, flights, stays, start, end, nights, travellers, b,
      route: [origin, ...cities, origin] };
  }

  // ---------- price labels ----------
  function flightLive(leg) {
    const ev = [leg?.canonicalPricing?.evidence, leg?.providerVerification, leg?.priceProvenance].find(x => String(x?.sourceType || '').toUpperCase() === 'LIVE');
    return live() && (Boolean(ev) || leg?.liveFareVerified === true);
  }
  function stayLive(hotel) { return live() && (hotel?.nuiteeLiveRate?.sourceType === 'LIVE' || hotel?.livePriceVerified === true); }
  function checkedAgo(at) {
    const t = Date.parse(at || '');
    if (!Number.isFinite(t)) return 'checked just now';
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    return mins <= 1 ? 'checked just now' : mins < 90 ? `checked ${mins} minutes ago` : `checked ${Math.round(mins / 60)} hours ago`;
  }

  // ---------- markup ----------
  function photoFigure(city, cls = '') {
    return `<figure class="destination-media ${cls}" data-photo-city="${esc(city.name)}" data-photo-country="${esc(city.country)}">` +
      `<div class="media-fallback" aria-hidden="true"><strong>${esc(city.code || city.name.slice(0, 3).toUpperCase())}</strong><span>${esc([city.name, city.country].filter(Boolean).join(', '))}</span></div></figure>`;
  }
  function flightSegment(f) {
    const pair = [f.from.code, f.to.code].filter(Boolean).join(' → ');
    const how = [f.stops === 0 ? 'Nonstop' : (num(f.stops) > 0 ? plural(num(f.stops), 'stop', 'stops') : ''), flightTime(f.minutes)].filter(Boolean).join(', ');
    const isLive = flightLive(f.leg);
    return `<details class="segment flight-segment"><summary><span class="segment-icon">${ICON_FLIGHT}</span>` +
      `<span><strong>${esc(f.from.name)} → ${esc(f.to.name)}</strong><small>${esc([pair, f.carrier].filter(Boolean).join(' · '))}${isLive ? ' <em class="live-tag">Live price</em>' : ''}</small></span>` +
      `<b>${Number.isFinite(f.price) ? money(f.price) : '—'}</b></summary>` +
      `<div class="segment-detail"><p>${esc([day(f.date, { weekday: 'short', month: 'short', day: 'numeric' }), how].filter(Boolean).join(' · '))}</p>` +
      `<p class="quiet">${isLive ? `Live price · Ignav · ${esc(checkedAgo(f.observedAt))}` : 'Estimate · the airline confirms the final price when you book'}</p></div></details>`;
  }
  function staySegment(s) {
    const c = s.city, h = c.hotel, rating = num(h.rating);
    const name = h.name || h.hotelName || `Hotel in ${c.name}`;
    const isLive = stayLive(h);
    return `<details class="segment stay-segment"><summary><span class="segment-icon">${ICON_BED}</span>` +
      `<span><strong>${esc(/central value stay/i.test(name) ? `Hotel in ${c.name}` : name)}</strong><small>${esc([dateRange(c.arrive, c.leave).replace(/, \d{4}$/, ''), plural(c.nights, 'night', 'nights'), Number.isFinite(rating) ? `rated ${rating.toFixed(1)}` : ''].filter(Boolean).join(' · '))}${isLive ? ' <em class="live-tag">Live rate</em>' : ''}</small></span>` +
      `<b>${Number.isFinite(s.price) ? money(s.price) : '—'}</b></summary>` +
      `<div class="segment-detail">${s.fee > 0 ? `<p>Includes ${money(s.fee)} local taxes paid at the hotel.</p>` : ''}` +
      `<p class="quiet">${isLive ? 'Live rate · Nuitee · confirmed again when you book' : 'Estimate · the hotel confirms the final price when you book'}</p>` +
      '<p class="quiet">Check the room and cancellation terms with the hotel.</p></div></details>';
  }
  const navLabel = (i, last) => i === 0 ? 'Depart ' + view.origin.name : i === last ? 'Back in ' + view.origin.name : view.route[i].name;
  function stopMarkup(stop, i) {
    const last = view.route.length - 1, edge = i === 0 || i === last;
    const inbound = i > 0 ? view.flights[i - 1] : null;
    const stay = edge ? null : view.stays[i - 1];
    const when = i === 0 ? day(view.start) : i === last ? day(view.end) : dateRange(stop.arrive, stop.leave).replace(/, \d{4}$/, '');
    return `<article class="stream-stop${edge ? '' : ' gv-mtd-destination'}" id="stop-${i}" data-observe="${i}"><span class="stream-pin" aria-hidden="true"></span>` +
      (inbound ? `<div class="stream-flight">${flightSegment(inbound)}</div>` : '') +
      `<div class="stream-place"><header><p class="chapter-date">${esc([when, stop.nights ? plural(stop.nights, 'night', 'nights') : ''].filter(Boolean).join(' · '))}</p>` +
      `<h2>${esc(navLabel(i, last))}</h2><p class="quiet place-line">${flag(stop.cc)}${esc([stop.country, stop.code].filter(Boolean).join(' · '))}</p></header>` +
      (edge ? '' : photoFigure(stop)) + (stay ? staySegment(stay) : '') + '</div></article>';
  }
  function render() {
    const v = view = buildView(tour), last = v.route.length - 1;
    const names = v.cities.map(c => c.name);
    document.title = names.join(' → ') + ' | GlobeVoy';
    $('#gv-mtd-title').textContent = `${v.origin.name} to ${names[names.length - 1] || v.origin.name}, and home.`;
    $('#gv-mtd-route').innerHTML = v.route.map(s => `<span>${esc(s.name)}</span>`).join('<span aria-hidden="true"> → </span>');
    $('#gv-mtd-meta').innerHTML = [dateRange(v.start, v.end), plural(v.nights, 'night', 'nights'), plural(v.travellers, 'traveller', 'travellers')]
      .filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
    $('#gv-mtd-hero').outerHTML = photoFigure(v.origin, 'hero').replace('<figure', '<figure id="gv-mtd-hero"');
    $('#gv-mtd-nav').innerHTML = v.route.map((s, i) => `<a href="#stop-${i}" data-stop-link="${i}"${i === 0 ? ' aria-current="location"' : ''}><span>${esc(i === 0 ? 'Departure' : i === last ? 'Return' : dateRange(s.arrive, s.leave).replace(/, \d{4}$/, ''))}</span><strong>${esc(s.name)}</strong></a>`).join('');
    $('#gv-mtd-timeline').innerHTML = '<div class="stream-line" aria-hidden="true"><i></i></div>' + v.route.map(stopMarkup).join('');
    renderPrices();
    $$('[data-photo-city]').forEach(paintPhoto);
    $('#gv-mtd-loading').hidden = true;
    $('#gv-mtd-app').hidden = false;
    $('#gv-mtd-bar').hidden = false;
    document.body.classList.add('has-bar');
    buildMap();
    watchScroll();
  }
  function renderPrices() {
    const v = view, b = v.b;
    const flights = num(b.flightEstimate, v.flights.reduce((s, f) => s + (num(f.price, 0)), 0));
    const stays = num(b.accommodationEstimate, v.stays.reduce((s, x) => s + num(x.price, 0), 0));
    const total = num(b.tripEstimate, flights + stays);
    const budget = num(b.totalBudget ?? tour.budget?.total?.amount ?? q.get('budget'), 0);
    const reserve = num(b.reserveAmount ?? tour.budget?.personalReserve?.amount, 0);
    const left = num(b.amountLeft, budget - reserve - total);
    $('#gv-mtd-flights').textContent = money(flights);
    $('#gv-mtd-stays').textContent = money(stays);
    $('#gv-mtd-reserve').textContent = money(reserve);
    $('#gv-mtd-budget-total').textContent = money(budget);
    $('#gv-mtd-remaining-label').textContent = left < 0 ? 'Over budget' : 'Left over';
    $('#gv-mtd-remaining').textContent = money(Math.abs(left));
    $('#gv-mtd-total').textContent = money(total);
    $('#gv-mtd-total-label').textContent = `${v.cur} · ${live() ? 'Live trip total' : 'Trip total'}`;
    const times = v.flights.map(f => Date.parse(f.observedAt || '')).filter(Number.isFinite);
    const note = $('#gv-mtd-live');
    note.textContent = live() ? 'Live prices, ' + checkedAgo(times.length ? new Date(Math.min(...times)).toISOString() : '') : 'Previous prices · verification required';
    note.classList.toggle('is-live', live());
  }
  // Prices are labelled live only while the signed quote is valid.
  function refreshLabels() {
    renderPrices();
    $$('.flight-segment').forEach((el, i) => { el.outerHTML = flightSegment(view.flights[i]); });
    $$('.stay-segment').forEach((el, i) => { el.outerHTML = staySegment(view.stays[i]); });
  }

  // ---------- photos (licensed, with credit) ----------
  // Cities with a bundled scene photo use it first, as the results page does.
  const SCENES = ['lisbon', 'seville', 'tokyo', 'prague', 'vienna', 'budapest', 'seoul', 'taipei', 'marrakech'];
  const sceneKey = name => String(name || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  async function paintPhoto(figure) {
    const name = figure.dataset.photoCity, country = figure.dataset.photoCountry;
    let photos = [];
    try { photos = (await window.GlobevoyCityImages?.photos?.(name, country)) || []; } catch (_) { photos = []; }
    if (SCENES.includes(sceneKey(name))) photos = [{ url: `./assets/media/scenes/${sceneKey(name)}.jpg` }, ...photos];
    for (const photo of photos) {
      if (!figure.isConnected) return;
      const img = new Image();
      img.alt = `${name}${country ? ', ' + country : ''}`;
      img.decoding = 'async';
      const ok = await new Promise(resolve => { img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = photo.url; });
      if (!ok) continue;
      figure.querySelector('img')?.remove();
      figure.appendChild(img);
      window.GlobevoyCityImages?.setCredit?.(figure, photo);
      return;
    }
  }

  // ---------- map ----------
  let map = null, markers = [];
  async function ensurePoints() {
    const missing = [view.origin, ...view.cities].some(s => !s.point);
    if (!missing) return;
    if (!window.GLOBEVOY_DESTINATIONS) {
      await new Promise(resolve => { const s = document.createElement('script'); s.src = './runtime/destination-data.js'; s.onload = s.onerror = resolve; document.head.appendChild(s); });
    }
    const list = Array.isArray(window.GLOBEVOY_DESTINATIONS) ? window.GLOBEVOY_DESTINATIONS : [];
    [view.origin, ...view.cities].forEach(s => {
      if (s.point) return;
      const rec = list.find(d => String(d.code || '').toUpperCase() === s.code || String(d.city || '').toLowerCase() === String(s.name).toLowerCase());
      s.point = point(rec);
    });
  }
  async function buildMap() {
    if (!window.L || !$('#map')) return;
    await ensurePoints();
    const stops = view.route.filter(s => s.point);
    if (stops.length < 2) { $('.journey-map').hidden = true; return; }
    // Unwrap longitudes so a route across the Pacific stays one short line.
    const pts = [];
    stops.forEach((s, i) => { let [lat, lng] = s.point; if (i) { const prev = pts[i - 1][1]; while (lng - prev > 180) lng -= 360; while (prev - lng > 180) lng += 360; } pts.push([lat, lng]); });
    map = L.map('map', { zoomControl: false, scrollWheelZoom: false, attributionControl: true, worldCopyJump: false });
    L.control.zoom({ position: 'topright' }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>').addAttribution('© Natural Earth · public domain');
    if (!map.getPane('land')) map.createPane('land').style.zIndex = 250;
    fetch('./assets/map/countries.geo.json').then(r => r.json()).then(geo => {
      const renderer = L.canvas({ padding: 0.5, pane: 'land' });
      [-360, 0, 360].forEach(shift => L.geoJSON(geo, { pane: 'land', renderer, interactive: false,
        coordsToLatLng: c => L.latLng(c[1], c[0] + shift), style: { fillColor: '#f4f1e5', fillOpacity: 1, color: '#aebfb4', weight: 1 } }).addTo(map));
    }).catch(() => { /* lines and pins still show */ });
    L.polyline(pts, { color: '#075a59', weight: 2, dashArray: '5 6', interactive: false }).addTo(map);
    const seen = new Set();
    markers = stops.map((s, i) => {
      const key = s === view.origin ? 'origin' : 'c' + s.index;
      if (seen.has(key)) return null;
      seen.add(key);
      const m = L.marker(pts[i], { title: s.name, alt: s.name, keyboard: true,
        icon: L.divIcon({ className: 'map-pin', html: esc(s.code || s.name.slice(0, 3).toUpperCase()), iconSize: [42, 30], iconAnchor: [21, 15] }) }).addTo(map);
      m.on('click', () => { const idx = view.route.indexOf(s); document.getElementById('stop-' + idx)?.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth' }); setActive(idx); });
      return { m, key };
    }).filter(Boolean);
    map.fitBounds(pts, { padding: [30, 26], maxZoom: 6, animate: false });
    setActive(activeIndex, true);
  }

  // ---------- scroll ----------
  let activeIndex = 0;
  function setActive(index, force) {
    if (index === activeIndex && !force) return;
    activeIndex = index;
    const stop = view.route[index], key = index === 0 || index === view.route.length - 1 ? 'origin' : 'c' + stop.index;
    $$('[data-stop-link]').forEach(a => { if (+a.dataset.stopLink === index) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    $$('[data-observe]').forEach(el => el.classList.toggle('current', +el.dataset.observe === index));
    markers.forEach(({ m, key: k }) => m.getElement()?.classList.toggle('current', k === key));
    $('#map-city').textContent = navLabel(index, view.route.length - 1);
    const link = $('[data-stop-link][aria-current]'), nav = link?.parentElement;
    if (nav) {
      const a = link.getBoundingClientRect(), f = nav.getBoundingClientRect();
      if (a.left < f.left) nav.scrollLeft += a.left - f.left;
      if (a.right > f.right) nav.scrollLeft += a.right - f.right;
    }
  }
  function watchScroll() {
    const stops = $$('[data-observe]');
    let pending = false;
    const update = () => {
      pending = false;
      const threshold = innerHeight * 0.45;
      let index = 0;
      stops.forEach((s, i) => { if (s.getBoundingClientRect().top <= threshold) index = i; });
      setActive(index);
      const line = $('.stream-line')?.getBoundingClientRect();
      if (line) $('.stream-line i').style.transform = `scaleY(${reduce.matches ? 1 : Math.min(1, Math.max(0, (threshold - line.top) / line.height))})`;
    };
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(update); } };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    update();
  }

  // ---------- links + actions ----------
  function resultsUrl() {
    const p = new URLSearchParams(q);
    p.delete('handoff');
    return './results.html?' + p.toString();
  }
  function homeUrl() {
    const s = S?.readSearch ? S.readSearch(q) : null;
    return s && s.budget ? './index.html?' + new URLSearchParams({ origin: s.origin, budget: String(s.budget), currency: s.currency, adults: String(s.adults) }) : './index.html';
  }
  function bookingUrl() {
    const p = new URLSearchParams(q);
    p.set('multi', 'true');
    p.delete('handoff');
    p.set('currency', view.cur);
    if (view.start) p.set('departureDate', view.start);
    if (view.end) p.set('returnDate', view.end);
    p.set('passengers', String(view.travellers));
    return './booking.html?' + p.toString();
  }
  function bindActions() {
    $('#gv-mtd-back').href = resultsUrl();
    $('#gv-mtd-error-back').href = resultsUrl();
    $('#new-search').href = homeUrl();
    $('#gv-mtd-adjust').href = homeUrl();
    $('#gv-mtd-booking').href = bookingUrl();
    const signin = $('#signin');
    if (S?.isMember?.()) { signin.textContent = 'Your account'; signin.onclick = () => { location.href = './account.html'; }; }
    else signin.onclick = () => S?.signIn?.();
    // Guests keep the trip in this browser. Signed-in travellers are handled by the
    // saved-trips runtime (saved-trips-705c-r3-route-details.js), which saves to their account.
    $('#gv-mtd-save').onclick = () => {
      const id = String(q.get('snapshot') || '');
      let ok = false;
      try { if (id) { localStorage.setItem(H.SNAPSHOT_PREFIX + id, JSON.stringify({ version: 'GV-WEB-3', savedAt: new Date().toISOString(), tour })); ok = true; } } catch (_) { ok = false; }
      $('#gv-mtd-save').textContent = ok ? 'Saved in this browser ✓' : 'Save trip';
      $('#gv-mtd-save').setAttribute('aria-pressed', String(ok));
      $('#gv-mtd-account-save-status').textContent = ok ? 'Saved in this browser. Sign in to keep it in your account.' : 'This browser can’t store the trip right now.';
    };
  }

  function showError(message) {
    $('#gv-mtd-loading').hidden = true;
    $('#gv-mtd-app').hidden = true;
    $('#gv-mtd-error').hidden = false;
    if (message) $('#gv-mtd-error-copy').textContent = message;
    $('#gv-mtd-error-back').href = resultsUrl();
  }

  async function start() {
    try {
      tour = await H.load(q);
      if (!tour) { showError('This trip isn’t saved in this browser. Open your trips again and choose it.'); return; }
      const verified = await window.GlobevoyJourneyQuote?.readVerifiedQuote?.(tour);
      if (verified) {
        tour = { ...tour, displayBudget: verified.quote.displayBudget };
        verifiedUntil = Number(verified.expiresAt) || 0;
        setTimeout(() => { if (view) refreshLabels(); }, Math.max(0, verifiedUntil - Date.now()));
      }
      H.remember(tour);
      render();
      bindActions();
    } catch (error) {
      showError();
      console.error(error);
    }
  }
  window.GlobevoyItinerary = { getState: () => ({ live: live(), stops: view?.route.length || 0, active: activeIndex }) };
  start();
})();
