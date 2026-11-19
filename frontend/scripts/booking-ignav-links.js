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
  // Same flight order the Booking Hub uses for its flight steps.
  function flightLookups(tour) {
    return legsOf(tour).filter(leg => !isGround(leg)).map(leg => {
      const live = leg?.booking?.liveBookingLinks;
      const id = String(live?.ignavId || '');
      return live && /^[A-Za-z0-9_-]{8,128}$/.test(id) ? { ignavId: id, bookingProof: live.bookingProof, endpoint: '/api/flight-booking-links' } : null;
    });
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

  async function fetchLinks(lookup, fetchFn = root.fetch) {
    const base = apiBase();
    if (!base || typeof fetchFn !== 'function') return { ok: false, reason: 'api-not-configured' };
    try {
      const response = await fetchFn(base + lookup.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignavId: lookup.ignavId, bookingProof: lookup.bookingProof })
      });
      return await response.json();
    } catch (_) {
      return { ok: false, reason: 'network-error' };
    }
  }

  function decorate(document, tour, fetchFn) {
    const timeline = document.querySelector('#gv-booking-timeline');
    if (!timeline) return 0;
    const lookups = flightLookups(tour);
    const flightItems = [...timeline.querySelectorAll('li[data-kind="flight"]')];
    let added = 0;
    flightItems.forEach((li, i) => {
      const lookup = lookups[i];
      if (!lookup || li.querySelector('.gv-booking-live-options')) return;
      const side = li.querySelector('.gv-booking-journey-side') || li;
      const wrap = document.createElement('div');
      wrap.className = 'gv-booking-live-options';
      wrap.innerHTML = '<button type="button" class="gv-booking-journey-action">See live booking options</button><div class="gv-booking-live-result" aria-live="polite"></div>';
      const button = wrap.querySelector('button');
      const out = wrap.querySelector('.gv-booking-live-result');
      button.addEventListener('click', async () => {
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

  function start() {
    const document = root.document;
    if (!document) return;
    let done = false;
    const tryRun = () => {
      const tour = root.GlobevoyBooking673FR1?.tour;
      if (done || !tour) return false;
      const timeline = document.querySelector('#gv-booking-timeline');
      if (!timeline || !timeline.querySelector('li[data-kind="flight"]')) return false;
      decorate(document, tour);
      done = true;
      return true;
    };
    root.addEventListener?.('globevoy:booking-tour-ready', () => root.setTimeout?.(tryRun, 0));
    let attempts = 0;
    const timer = root.setInterval?.(() => { if (tryRun() || ++attempts > 80) root.clearInterval?.(timer); }, 250);
  }

  return { VERSION, start, decorate, flightLookups, linksHtml, fetchLinks };
});
