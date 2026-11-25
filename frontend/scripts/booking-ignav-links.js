// GV-FLIGHT-IGNAV-003 — live booking options on the booking page.
//
// Adds a "See live booking options" button to each flight step whose backend leg
// carries booking.liveBookingLinks (Ignav-priced). On click it asks GlobeVoy's own
// backend (POST /api/flight-booking-links) for airline/OTA links and lists them.
// It never sends provider keys, never books, and labels links honestly: Ignav
// links do not earn GlobeVoy a referral fee and may open a search page.
(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlobevoyBookingIgnavLinks = api;
  if (root && root.document) api.start();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = 'GV-FLIGHT-IGNAV-003';
  const SYMBOLS = { USD: '$', CAD: 'C$', AUD: 'A$', EUR: '€', GBP: '£' };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function safeUrl(value) {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; }
    catch (_) { return ''; }
  }
  function money(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    const code = String(currency || '').toUpperCase();
    return `${code} ${SYMBOLS[code] || ''}${Math.round(n)}`;
  }
  function isFlight(leg) {
    const text = `${leg?.mode || ''} ${leg?.transportType || ''}`.toLowerCase();
    if (text.includes('flight')) return true;
    return (Array.isArray(leg?.segments) ? leg.segments : []).some(s => `${s?.mode || ''} ${s?.transportType || ''}`.toLowerCase().includes('flight'));
  }
  function isGround(leg) {
    if (isFlight(leg)) return false;
    return /(ground|rail|bus|train|transfer)/i.test(`${leg?.mode || ''} ${leg?.transportType || ''} ${leg?.operator || ''}`);
  }
  function legsOf(tour) {
    return Array.isArray(tour?.backendLegs) ? tour.backendLegs : (Array.isArray(tour?.legs) ? tour.legs : []);
  }
  function flightLookup(leg, party = {}) {
    const live = leg?.booking?.liveBookingLinks;
    const id = String(live?.ignavId || '');
    const code = node => String(node?.airportCode || node?.code || '').toUpperCase();
    if (!live || !/^[A-Za-z0-9_-]{8,128}$/.test(id) || !live.bookingProof) return null;
    if (live.origin && live.origin !== code(leg.from) || live.destination && live.destination !== code(leg.to) ||
        live.departureDate && live.departureDate !== String(leg.departureDate || '').slice(0, 10) ||
        live.passengers != null && party.travellers != null && Number(live.passengers) !== Number(party.travellers)) return null;
    return { ignavId: id, bookingProof: live.bookingProof, endpoint: '/api/flight-booking-links' };
  }

  // Same flight order the Booking Hub uses for its flight steps.
  function flightLookups(tour) {
    return legsOf(tour).filter(leg => !isGround(leg)).map(leg => flightLookup(leg, tour.passengerPricing));
  }
  function apiBase() {
    const cfg = (root.GLOBEVOY_CONFIG && typeof root.GLOBEVOY_CONFIG === 'object') ? root.GLOBEVOY_CONFIG : {};
    return String(cfg.apiBaseUrl || '').trim().replace(/\/+$/, '');
  }

  function linksHtml(result) {
    const links = (Array.isArray(result?.links) ? result.links : []).map(link => ({ ...link, url: safeUrl(link.url) })).filter(link => link.url).slice(0, 6);
    if (!links.length) return '<p class="gv-booking-evidence-note">No booking options were returned for this flight right now. Use the comparison link above.</p>';
    const items = links.map(link => {
      const kind = link.providerType === 'airline' ? 'Airline' : 'Booking site';
      const exact = link.specificity === 'exact_flight' ? 'Flight preselected' : 'May open a search page';
      const price = money(link.amount, link.currency);
      return `<li><a class="gv-booking-link" href="${esc(link.url)}" target="_blank" rel="noopener nofollow">${esc(link.providerName)} ↗</a> <span>${esc(kind)}</span>${price ? ` · <strong>${esc(price)}</strong>` : ''} · <span>${esc(exact)}</span></li>`;
    }).join('');
    return `<ul class="gv-booking-live-links">${items}</ul><p class="gv-booking-evidence-note">Live options found by Ignav. Prices can change; the booking site confirms the final fare. GlobeVoy does not earn a referral fee on these links.</p>`;
  }

  const pendingLinks = new Map();
  async function fetchLinks(lookup, fetchFn = root.fetch) {
    const base = apiBase();
    if (!base || typeof fetchFn !== 'function') return { ok: false, reason: 'api-not-configured' };
    const { ignavId, bookingProof } = lookup;
    const key = JSON.stringify([base, ignavId, bookingProof]);
    if (pendingLinks.has(key)) return pendingLinks.get(key);
    const lookupResult = (async () => {
      try {
        const response = await fetchFn(base + '/api/flight-booking-links', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ignavId, bookingProof })
        });
        return await response.json();
      } catch (_) { return { ok: false, reason: 'network-error' }; }
    })();
    pendingLinks.set(key, lookupResult);
    try { return await lookupResult; }
    finally { pendingLinks.delete(key); }
  }

  function decorate(document, tour, fetchFn) {
    const timeline = document.querySelector('#gv-booking-workspace') || document.querySelector('#gv-booking-timeline');
    if (!timeline) return 0;
    const lookups = flightLookups(tour);
    const flightItems = [...timeline.querySelectorAll('#gv-workspace-panel-2 .gv-workspace-item[data-workspace-item^="flight-"],li[data-kind="flight"]')];
    let added = 0;
    flightItems.forEach((li, i) => {
      const lookup = lookups[i];
      if (!lookup || li.querySelector('.gv-booking-live-options')) return;
      const side = li.querySelector('.gv-workspace-item-side,.gv-booking-journey-side') || li;
      const wrap = document.createElement('div');
      wrap.className = 'gv-booking-live-options';
      wrap.innerHTML = '<button type="button" class="gv-booking-journey-action">See live booking options</button><div class="gv-booking-live-result" aria-live="polite"></div>';
      const button = wrap.querySelector('button');
      const out = wrap.querySelector('.gv-booking-live-result');
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        out.innerHTML = '<p class="gv-booking-evidence-note">Checking live booking options…</p>';
        const result = await fetchLinks(lookup, fetchFn);
        out.innerHTML = result && result.ok ? linksHtml(result)
          : '<p class="gv-booking-evidence-note">Live booking options are unavailable right now. Use the comparison link above.</p>';
        button.disabled = false;
      });
      side.appendChild(wrap);
      added += 1;
    });
    return added;
  }

  // GV-HOTEL-NUITEE-WL-001: "Book this hotel" on stays priced live by Nuitee.
  function propertyLink(hotel, checkIn, checkOut, party = {}) {
    const whitelabel = hotel?.nuiteeWhitelabel || hotel?.booking?.whitelabel;
    const href = safeUrl(whitelabel?.url);
    if (!href) return null;
    const url = new URL(href);
    if (!/(?:\.nuitee\.link|(?:^|\.)globevoy\.com)$/i.test(url.hostname)) return null;
    const property = url.pathname.match(/\/hotels\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
    const expectedProperty = hotel.nuiteeHotelId || whitelabel.hotelId;
    if (!property || expectedProperty && property !== String(expectedProperty)) return null;
    const bookedIn = url.searchParams.get('checkin'), bookedOut = url.searchParams.get('checkout');
    if (bookedIn && checkIn && bookedIn !== checkIn || bookedOut && checkOut && bookedOut !== checkOut) return null;
    const encoded = url.searchParams.get('occupancies');
    let matchesParty = false;
    if (encoded) {
      try {
        const rows = JSON.parse(root.atob(encoded));
        if (!Array.isArray(rows) || !rows.length || !rows.every(r => Number.isInteger(r.adults) && r.adults > 0 &&
            Array.isArray(r.children) && r.children.every(age => Number.isInteger(age) && age >= 0 && age <= 17))) return null;
        const adults = rows.reduce((n, r) => n + r.adults, 0);
        const children = rows.reduce((n, r) => n + r.children.length, 0);
        if (party.rooms != null && rows.length !== party.rooms || party.adults != null && adults !== party.adults ||
            party.minors != null && children !== party.minors ||
            Array.isArray(party.occupancies) && JSON.stringify(rows) !== JSON.stringify(party.occupancies.map(r => ({ adults: r.adults, children: r.children || [] })))) return null;
        matchesParty = party.rooms != null && party.adults != null && party.minors != null;
      } catch (_) { return null; }
    }
    return { url: href, name: String(hotel.name || hotel.hotelName || '').trim(),
      matchesStay: !!(expectedProperty && bookedIn && bookedOut && bookedIn === checkIn && bookedOut === checkOut && matchesParty) };
  }

  function stayWhitelabels(tour) {
    const direct = Array.isArray(tour?.stays) ? tour.stays : [];
    const cities = Array.isArray(tour?.cities) ? tour.cities : [];
    const party = tour.passengerPricing || {};
    return (direct.length ? direct : cities).map((stay, i) => {
      const hotel = stay?.hotel || cities[i]?.hotel || {};
      return propertyLink(hotel, stay.checkIn || stay.arrivalDate || hotel.checkIn,
        stay.checkOut || stay.departureDate || hotel.checkOut,
        { adults: party.adults, rooms: party.rooms, minors: Number(party.children || 0) + Number(party.infants || 0), occupancies: party.occupancies });
    });
  }
  function decorateStays(document, tour) {
    const host = document.querySelector('#gv-booking-workspace') || document.querySelector('#gv-booking-timeline');
    if (!host) return 0;
    const links = stayWhitelabels(tour);
    if (!links.some(Boolean)) return 0;
    const items = [...host.querySelectorAll('#gv-workspace-panel-3 .gv-workspace-item,li[data-kind="stay"]')];
    let added = 0;
    items.forEach((item, i) => {
      if (item.querySelector('.gv-booking-whitelabel')) return;
      const link = links[i];
      if (!link) return;
      const side = item.querySelector('.gv-workspace-item-side,.gv-booking-journey-side') || item;
      const wrap = document.createElement('div');
      wrap.className = 'gv-booking-whitelabel';
      wrap.innerHTML = `<a class="gv-booking-journey-action gv-booking-link" href="${esc(link.url)}" target="_blank" rel="noopener">Book this hotel ↗</a><p class="gv-booking-evidence-note">Opens GlobeVoy's hotel booking site (powered by Nuitee) to review the property, dates, travellers and final price before paying.</p>`;
      side.appendChild(wrap);
      added += 1;
    });
    return added;
  }

  function start() {
    const document = root.document;
    if (!document) return;
    const tryRun = () => {
      const tour = root.GlobevoyBooking673FR1?.tour;
      if (!tour) return false;
      const host = document.querySelector('#gv-booking-workspace') || document.querySelector('#gv-booking-timeline');
      if (!host || !host.querySelector('[data-workspace-item^="flight-"],li[data-kind="flight"]')) return false;
      decorate(document, tour);
      decorateStays(document, tour);
      return true;
    };
    // Workspace rendering can replace the legacy cards after tour-ready fires.
    // Decoration is idempotent; observe actual visible-card insertions, not page loads.
    const host = document.querySelector('#gv-booking-workspace') || document.querySelector('#gv-booking-timeline');
    if (host && root.MutationObserver) new root.MutationObserver(tryRun).observe(host, { childList: true, subtree: true });
    root.addEventListener?.('globevoy:booking-tour-ready', () => root.setTimeout?.(tryRun, 0));
    tryRun();
    let attempts = 0;
    const timer = root.setInterval?.(() => { if (tryRun() || ++attempts > 80) root.clearInterval?.(timer); }, 250);
  }

  return { VERSION, start, decorate, decorateStays, propertyLink, stayWhitelabels, flightLookup, flightLookups, linksHtml, fetchLinks };
});
