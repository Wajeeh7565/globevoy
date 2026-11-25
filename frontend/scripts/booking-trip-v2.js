// GV-BOOK-V2-001 — simple KAYAK-style booking page.
//
// One row per flight and per hotel, in travel order: price, where the price
// came from (live provider or estimate), one main book button, one comparison
// link, and a "Booked" tick. Optional "Start booking" guide highlights the next
// unbooked item. Referral only: every button opens a partner site in a new tab.
//
// Reads the tour the existing booking runtime publishes
// (window.GlobevoyBooking673FR1.tour) and renders into #gv-booking-v2, hiding
// the older booking sections. "Show detailed view" brings them back.
(function (root) {
  'use strict';
  const VERSION = 'GV-BOOK-V2-003';
  const OLD_SECTIONS = ['.gv-booking-hero', '#gv-booking-workspace', '.gv-booking-summary', '#gv-booking-journey-section',
    '#gv-booking-profile-section', '#gv-booking-transport-section', '#gv-booking-stays-section', '.gv-booking-section'];
  const AGODA_CID = '1963873';
  // How long a Nuitee offerId is trusted for one-click checkout. Older than
  // this, the main button opens the hotel page (current price) instead.
  const OFFER_FRESH_MINUTES = 30;

  function safeUrl(value) {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; }
  }
  function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
  function isoDate(value) { const s = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
  function dateLabel(iso, withDay) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(withDay ? { weekday: 'short' } : {}) });
  }
  function ageLabel(observedAt, now) {
    const t = Date.parse(observedAt || '');
    if (!Number.isFinite(t)) return '';
    const mins = Math.max(0, Math.round(((now || Date.now()) - t) / 60000));
    if (mins < 1) return 'checked just now';
    if (mins < 60) return `checked ${mins} min ago`;
    const hrs = Math.round(mins / 60);
    return hrs < 48 ? `checked ${hrs} h ago` : 'checked over 2 days ago';
  }
  function providerName(raw) {
    const s = String(raw || '').toLowerCase();
    if (s.includes('ignav')) return 'Ignav';
    if (s.includes('duffel')) return 'Duffel';
    if (s.includes('nuitee')) return 'Nuitee';
    if (s.includes('agoda')) return 'Agoda';
    return raw ? String(raw) : '';
  }

  function currencyOf(tour) {
    const d = tour?.displayBudget || {};
    const code = String(d.currency || tour?.budget?.total?.currency || 'CAD').toUpperCase();
    const fx = num(d.exchangeRateFromUsd) || (code === 'USD' ? 1 : null);
    const symbol = d.symbol || (code === 'CAD' ? 'C$' : code === 'USD' ? 'US$' : code + ' ');
    return { code, fx, symbol };
  }
  function money(amount, cur) {
    const n = num(amount);
    return n == null ? '—' : `${cur.symbol}${Math.round(n).toLocaleString('en-CA')}`;
  }

  function legsOf(tour) {
    const legs = Array.isArray(tour?.backendLegs) && tour.backendLegs.length ? tour.backendLegs : (Array.isArray(tour?.legs) ? tour.legs : []);
    return legs;
  }
  function isGround(leg) { return /ground|bus|train|rail|ferry|drive/i.test(String(leg?.mode || leg?.transportType || leg?.canonicalPricing?.kind || '')); }
  function cityName(x) { return String(x?.city || x?.name || x?.code || '').trim(); }
  function code(x) { return String(x?.code || x?.airportCode || x?.iata || '').toUpperCase(); }

  const handoffs = () => root.GlobevoyBookingIgnavLinks ||
    (typeof module === 'object' && module.exports ? require('./booking-ignav-links') : null);

  function flightRow(leg, cur, now, party) {
    // Evidence can sit in canonicalPricing (shown amount), providerVerification
    // (667A/Ignav) or priceProvenance (Duffel); use the first that says LIVE.
    const cp = leg?.canonicalPricing || {};
    const sources = [cp.evidence, leg?.providerVerification, leg?.priceProvenance].filter(Boolean);
    const prov = sources.find(x => String(x.sourceType || '').toUpperCase() === 'LIVE') || leg?.priceProvenance || {};
    const live = String(prov.sourceType || '').toUpperCase() === 'LIVE';
    const usd = num(cp.amountUsd) ?? num(leg?.priceProvenance?.partyTotalAmountUsd) ?? num(leg?.estimatedTransportUsd) ?? num(leg?.amountUsd);
    const shown = String(cp.currency || '').toUpperCase() === cur.code ? num(cp.amountDisplay) : null;
    const from = leg?.from || {}, to = leg?.to || {};
    const date = isoDate(leg?.departureDate);
    const compareUrl = safeUrl(leg?.booking?.url || leg?.bookingUrl || leg?.providerUrl);
    const ground = isGround(leg);
    return {
      kind: ground ? 'ground' : 'flight',
      title: `${cityName(from)}${code(from) ? ` (${code(from)})` : ''} → ${cityName(to)}${code(to) ? ` (${code(to)})` : ''}`,
      detail: [dateLabel(date, true), leg?.airline || leg?.operator || ''].filter(Boolean).join(' · '),
      price: shown != null ? shown : (usd != null && cur.fx ? usd * cur.fx : null),
      source: live ? `Live price · ${providerName(prov.provider || prov.source) || 'provider'}` : 'Estimated price',
      live,
      age: live ? ageLabel(prov.observedAt || prov.checkedAt, now) : 'confirm on partner site',
      ignav: ground ? null : handoffs()?.flightLookup(leg, party) || null,
      mainUrl: compareUrl,
      mainLabel: ground ? 'Find transport' : 'Compare flights',
      compareUrl: compareUrl,
      compareLabel: 'Compare on Aviasales'
    };
  }

  function agodaCityUrl(hotel, checkIn, checkOut, rooms, adults) {
    const id = String(hotel?.agodaCityId || hotel?.providerCityId || '');
    if (!/^\d{1,9}$/.test(id) || !checkIn || !checkOut) return '';
    const p = new URLSearchParams({ city: id, cid: AGODA_CID, checkIn, checkOut, rooms: String(rooms || 1), adults: String(adults || 1) });
    return `https://www.agoda.com/search?${p}`;
  }

  function hotelRow(city, stay, cur, now, party) {
    const hotel = city?.hotel || {};
    const checkIn = isoDate(stay?.checkIn || city?.arrivalDate || city?.checkIn || hotel.checkIn);
    const checkOut = isoDate(stay?.checkOut || city?.departureDate || city?.checkOut || hotel.checkOut);
    const nights = num(city?.nights) || num(stay?.nights);
    const rate = hotel.nuiteeLiveRate;
    const wl = handoffs()?.propertyLink(hotel, checkIn, checkOut, party);
    const wlOk = wl?.url;
    let price = null;
    if (rate && String(rate.currency || '').toUpperCase() === cur.code && num(rate.amount) != null) price = num(rate.amount);
    else if (num(hotel.estimatedStayUsd) != null && cur.fx) price = num(hotel.estimatedStayUsd) * cur.fx;
    const live = Boolean(rate && rate.sourceType === 'LIVE');
    const agoda = safeUrl(hotel.booking?.url || hotel.bookingUrl || hotel.hotelUrl || hotel.providerUrl) || agodaCityUrl(hotel, checkIn, checkOut, party.rooms, party.adults);
    const wlInfo = hotel.nuiteeWhitelabel || hotel.booking?.whitelabel || {};
    const checkout = safeUrl(wlInfo.checkoutUrl);
    const checkoutOk = checkout && wlOk && new URL(checkout).origin === new URL(wlOk).origin &&
      new URL(checkout).pathname === '/booking' && !!new URL(checkout).searchParams.get('offerId');
    const offerAge = (now || Date.now()) - Date.parse(wlInfo.offerObservedAt || rate?.observedAt || '');
    const fresh = checkoutOk && wl.matchesStay && live && rate.checkin === checkIn && rate.checkout === checkOut && Number.isFinite(offerAge) && offerAge >= 0 && offerAge <= OFFER_FRESH_MINUTES * 60000;
    const refundable = rate?.refundableTag === 'RFN' ? 'Free cancellation' : rate?.refundableTag === 'NRFN' ? 'Non-refundable' : '';
    // GV-HOTEL-FEES-001: local taxes paid at the hotel are not in the hotel site's checkout
    // price (`price` here) but are in the trip total; show them as their own amount.
    let payAtHotel = 0;
    if (rate && String(rate.currency || '').toUpperCase() === cur.code && num(rate.payAtHotelAmount) > 0) payAtHotel = num(rate.payAtHotelAmount);
    else if (num(hotel.payAtHotel?.usd) > 0 && cur.fx) payAtHotel = num(hotel.payAtHotel.usd) * cur.fx;
    const detailBits = [
      checkIn && checkOut ? `${dateLabel(checkIn)} – ${dateLabel(checkOut)}` : '',
      nights ? `${nights} night${nights === 1 ? '' : 's'}` : '',
      rate?.boardName || '',
      num(hotel.rating) ? `${hotel.rating} rating` : '',
      payAtHotel > 0 ? `plus ${money(payAtHotel, cur)} local taxes paid at the hotel` : ''
    ].filter(Boolean);
    const genericName = /central value stay/i.test(String(hotel.name || ''));
    return {
      kind: 'hotel',
      title: genericName ? `Hotel in ${cityName(city)}` : (hotel.name || `Hotel in ${cityName(city)}`),
      detail: detailBits.join(' · '),
      price,
      payAtHotel,
      source: live ? 'Live rate · Nuitee' : 'Estimated price',
      live,
      age: live ? (refundable || ageLabel(rate.observedAt, now)) : 'choose a hotel on Agoda',
      ignav: null,
      mainUrl: fresh ? checkout : (wlOk || agoda),
      mainLabel: fresh ? 'Book this room' : (wlOk ? 'Book this hotel' : 'Find a hotel'),
      compareUrl: wlOk ? agoda : '',
      compareLabel: 'Compare on Agoda',
      altUrl: fresh && wlOk ? wlOk : '',
      altLabel: 'See hotel page',
      checkoutExpiresAt: fresh ? (now || Date.now()) - offerAge + OFFER_FRESH_MINUTES * 60000 : null
    };
  }

  // Prefer the airline itself, then an exact-flight booking site, then the cheapest.
  function bestLink(links) {
    const ok = (Array.isArray(links) ? links : []).map(l => ({ ...l, url: safeUrl(l.url) })).filter(l => l.url);
    if (!ok.length) return null;
    const price = l => (num(l.amount) == null ? Infinity : num(l.amount));
    const rank = l => (l.providerType === 'airline' ? 0 : l.specificity === 'exact_flight' ? 1 : 2);
    return ok.slice().sort((a, b) => rank(a) - rank(b) || price(a) - price(b))[0];
  }

  function buildItems(tour, now) {
    const cur = currencyOf(tour);
    const legs = legsOf(tour);
    const cities = Array.isArray(tour?.cities) ? tour.cities : (Array.isArray(tour?.stops) ? tour.stops : []);
    const stays = Array.isArray(tour?.stays) ? tour.stays : [];
    const party = {
      adults: num(tour?.passengerPricing?.adults) || num(cities[0]?.hotel?.adults) || 1,
      rooms: num(tour?.passengerPricing?.rooms) || num(cities[0]?.hotel?.rooms) || 1,
      minors: Number(tour?.passengerPricing?.children || 0) + Number(tour?.passengerPricing?.infants || 0),
      travellers: tour?.passengerPricing?.travellers,
      occupancies: tour?.passengerPricing?.occupancies
    };
    const items = [];
    legs.forEach((leg, i) => {
      items.push(flightRow(leg, cur, now, party));
      if (cities[i]) items.push(hotelRow(cities[i], stays[i], cur, now, party));
    });
    if (!legs.length) cities.forEach((c, i) => items.push(hotelRow(c, stays[i], cur, now, party)));
    items.forEach((it, i) => { it.id = `${it.kind}-${i}`; it.index = i; });
    return { items, cur };
  }

  function summaryOf(tour, items, cur) {
    const d = tour?.displayBudget || {};
    const flights = items.filter(x => x.kind !== 'hotel').reduce((s, x) => s + (x.price || 0), 0);
    const hotels = items.filter(x => x.kind === 'hotel').reduce((s, x) => s + (x.price || 0), 0);
    // The trip total the rest of the site shows also includes airport-access /
    // transfer estimates and other extras; show those as their own line so the
    // two pages agree.
    const payAtHotel = items.filter(x => x.kind === 'hotel').reduce((s, x) => s + (x.payAtHotel || 0), 0);
    const siteTotal = num(d.tripEstimate);
    const extras = siteTotal != null && siteTotal - (flights + hotels + payAtHotel) > 1 ? siteTotal - (flights + hotels + payAtHotel) : 0;
    const total = flights + hotels + payAtHotel + extras;
    const budget = num(d.totalBudget) ?? num(tour?.budget?.total?.amount);
    const reserve = num(d.reserveAmount) || 0;
    const cities = (Array.isArray(tour?.cities) ? tour.cities : []).map(cityName).filter(Boolean);
    const origin = cityName(tour?.origin) || cityName(legsOf(tour)[0]?.from);
    const legs = legsOf(tour);
    const start = isoDate(legs[0]?.departureDate), end = isoDate(legs[legs.length - 1]?.departureDate);
    const nights = num(tour?.totalNights);
    return {
      route: [origin, ...cities, origin].filter(Boolean).join(' → '),
      dates: [start && end ? `${dateLabel(start)} – ${dateLabel(end)}, ${end.slice(0, 4)}` : '', nights ? `${nights} nights` : '',
        `${tour?.passengerPricing?.travellers || 1} traveller${(tour?.passengerPricing?.travellers || 1) === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      flights, hotels, payAtHotel, extras, total, budget, reserve,
      left: budget != null ? budget - reserve - total : null,
      flightCount: items.filter(x => x.kind !== 'hotel').length,
      hotelCount: items.filter(x => x.kind === 'hotel').length,
      liveCount: items.filter(x => x.live).length,
      cur
    };
  }

  // ---------- rendering (DOM only, no innerHTML with data) ----------
  function el(doc, tag, attrs, children) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    (children || []).forEach(c => { if (c) node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return node;
  }

  function storageKey(tour) {
    const q = new URLSearchParams(root.location?.search || '');
    return 'globevoy.booking.v2.booked.' + String(q.get('snapshot') || tour?.tourId || 'trip').slice(0, 80);
  }
  function loadBooked(key) { try { return JSON.parse(root.localStorage.getItem(key) || '{}') || {}; } catch (_) { return {}; } }
  function saveBooked(key, value) { try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }

  function selectionKey(tour) {
    const party = tour.passengerPricing || {};
    const legs = legsOf(tour);
    const cities = tour.cities || tour.stops || [];
    const airport = n => String(n?.airportCode || n?.code || '');
    return JSON.stringify([
      tour.tourId, tour.displayBudget?.currency, party.adults, party.children, party.infants, party.rooms, party.travellers,
      legs.map(l => [airport(l.from), airport(l.to), l.departureDate, l.booking?.liveBookingLinks?.ignavId]),
      cities.map(c => [c.cityId, c.arrivalDate || c.checkIn || c.hotel?.checkIn, c.departureDate || c.checkOut || c.hotel?.checkOut,
        c.hotel?.nuiteeHotelId, c.hotel?.nuiteeLiveRate?.roomName, c.hotel?.nuiteeWhitelabel?.checkoutUrl])
    ]);
  }

  async function readVerifiedQuote(tour, fetchFn = root.fetch) {
    const base = String(root.GLOBEVOY_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
    if (!base || !tour?.bookingEvidence || typeof fetchFn !== 'function') return null;
    try {
      const response = await fetchFn(base + '/api/booking-evidence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ token: tour.bookingEvidence })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.ok && Number(data.expiresAt) > Date.now() &&
        selectionKey(data.quote) === selectionKey(tour) ? data : null;
    } catch (_) { return null; }
  }

  function render(doc, tour, opts) {
    const host = doc.getElementById('gv-booking-v2');
    if (!host) return false;
    const { items, cur } = buildItems(tour, opts?.now);
    if (!items.length) return false;
    if (opts?.historical) {
      for (const item of items) {
        item.live = false;
        item.source = 'Estimate · verification required';
        item.ignav = null;
        item.checkoutExpiresAt = null;
        if (item.kind === 'hotel') {
          item.mainUrl = item.compareUrl;
          item.mainLabel = 'Compare stays';
          item.altUrl = '';
        }
      }
    }
    const s = summaryOf(tour, items, cur);
    const key = storageKey(tour);
    const state = { booked: loadBooked(key), guiding: false };

    function draw() {
      host.textContent = '';
      const count = items.filter(x => state.booked[x.id]).length;
      const next = items.find(x => !state.booked[x.id]);
      const guiding = state.guiding && next;

      const startBtn = el(doc, 'button', { type: 'button', class: 'gvb2-start', onclick: () => { state.guiding = true; draw(); } },
        [count === items.length ? 'All booked ✓' : (state.guiding ? 'Booking in progress' : 'Start booking')]);
      const bar = el(doc, 'div', { class: 'gvb2-bar' }, [el(doc, 'div', { class: 'gvb2-bar-fill', style: `width:${Math.round(count / items.length * 100)}%` })]);
      const hero = el(doc, 'div', { class: 'gvb2-hero' }, [
        el(doc, 'div', { class: 'gvb2-kicker', text: 'BOOK YOUR TRIP' }),
        el(doc, 'h1', { class: 'gvb2-title', text: s.route }),
        el(doc, 'div', { class: 'gvb2-sub', text: s.dates }),
        el(doc, 'div', { class: 'gvb2-hero-row' }, [startBtn, el(doc, 'span', { class: 'gvb2-count', text: `${count} of ${items.length} booked` })]),
        bar
      ]);

      const list = el(doc, 'section', { class: 'gvb2-list', 'aria-label': 'Flights and hotels to book' }, [hero]);
      if (guiding) {
        list.appendChild(el(doc, 'div', { class: 'gvb2-guide', role: 'status' }, [
          el(doc, 'div', {}, [el(doc, 'div', { class: 'gvb2-guide-step', text: `NEXT · STEP ${next.index + 1} OF ${items.length}` }), el(doc, 'div', { class: 'gvb2-guide-title', text: next.title })]),
          el(doc, 'p', { class: 'gvb2-guide-note', text: 'Book this one on the partner site, then come back and tick “Booked”. Book flights first: if a flight changes, hotel dates may need to change too.' })
        ]));
      }

      items.forEach(it => {
        const booked = !!state.booked[it.id];
        const best = it.ignav && it.links ? bestLink(it.links) : null;
        const mainUrl = best ? best.url : it.mainUrl;
        const mainLabel = best
          ? `${best.specificity === 'exact_flight' ? 'Book on' : 'Compare on'} ${best.providerName || 'partner'}`
          : it.mainLabel;
        const main = it.ignav && !it.links
          ? el(doc, 'button', { type: 'button', class: 'gvb2-main gvb2-linkbtn', disabled: it.loadingLinks,
            onclick: () => loadLinks(it), text: it.loadingLinks ? 'Checking booking options…' : 'See booking options' })
          : mainUrl
          ? el(doc, 'a', { class: 'gvb2-main', href: mainUrl, target: '_blank', rel: 'noopener nofollow',
            onclick: it.checkoutExpiresAt ? event => {
              if (Date.now() >= it.checkoutExpiresAt && it.altUrl) event.currentTarget.href = it.altUrl;
            } : null }, [`${mainLabel} ↗`])
          : el(doc, 'span', { class: 'gvb2-main gvb2-disabled', text: 'Link unavailable' });
        const right = el(doc, 'div', { class: 'gvb2-right' }, [el(doc, 'div', { class: 'gvb2-price', text: money(it.price, cur) }), main]);
        if (it.altUrl) right.appendChild(el(doc, 'a', { class: 'gvb2-compare', href: it.altUrl, target: '_blank', rel: 'noopener nofollow', text: it.altLabel }));
        if (it.compareUrl && (it.compareUrl !== mainUrl || it.ignav && !it.links)) right.appendChild(el(doc, 'a', { class: 'gvb2-compare', href: it.compareUrl, target: '_blank', rel: 'noopener nofollow', text: it.compareLabel }));
        const optionsBox = el(doc, 'div', { class: 'gvb2-options', hidden: true });
        if (it.ignav && it.links && it.links.length > 1) {
          right.appendChild(el(doc, 'button', { type: 'button', class: 'gvb2-compare gvb2-linkbtn', 'aria-expanded': it.open ? 'true' : 'false', onclick: () => { it.open = !it.open; draw(); } }, [it.open ? 'Hide other options' : `${it.links.length - 1} more option${it.links.length > 2 ? 's' : ''}`]));
          if (it.open) {
            optionsBox.hidden = false;
            optionsBox.appendChild(el(doc, 'ul', {}, it.links.map(l => ({ ...l, url: safeUrl(l.url) })).filter(l => l.url).slice(0, 6).map(l => el(doc, 'li', {}, [
              el(doc, 'a', { href: l.url, target: '_blank', rel: 'noopener nofollow', text: `${l.providerName || 'Booking site'} ↗` }),
              ` ${l.providerType === 'airline' ? 'Airline' : 'Booking site'}${num(l.amount) != null ? ` · ${l.currency || ''} ${Math.round(l.amount)}` : ''}${l.specificity === 'exact_flight' ? ' · flight preselected' : ''}`
            ]))));
          }
        }
        right.appendChild(el(doc, 'label', { class: 'gvb2-tick' }, [
          el(doc, 'input', { type: 'checkbox', checked: booked, onchange: () => { state.booked[it.id] = !booked; saveBooked(key, state.booked); draw(); } }),
          ' Booked'
        ]));
        const row = el(doc, 'article', { class: `gvb2-item${booked ? ' is-booked' : ''}${guiding && next.id === it.id ? ' is-next' : ''}` }, [
          el(doc, 'div', { class: `gvb2-icon gvb2-icon-${it.kind}`, 'aria-hidden': 'true', text: it.kind === 'hotel' ? 'H' : '✈' }),
          el(doc, 'div', { class: 'gvb2-body' }, [
            el(doc, 'div', { class: 'gvb2-step', text: `Step ${it.index + 1} of ${items.length} · ${it.kind === 'hotel' ? 'Hotel' : it.kind === 'ground' ? 'Transport' : 'Flight'}` }),
            el(doc, 'div', { class: 'gvb2-item-title', text: it.title }),
            el(doc, 'div', { class: 'gvb2-detail', text: it.detail }),
            el(doc, 'div', { class: 'gvb2-chips' }, [
              el(doc, 'span', { class: `gvb2-chip ${it.live ? 'gvb2-live' : 'gvb2-est'}`, text: `● ${it.source}` }),
              it.age ? el(doc, 'span', { class: 'gvb2-chip', text: it.age }) : null
            ]),
            optionsBox
          ]),
          right
        ]);
        list.appendChild(row);
      });
      list.appendChild(el(doc, 'p', { class: 'gvb2-legal', text: "You book each part on the partner's site, and the final price is shown there before you pay. GlobeVoy doesn't take payments; it may earn a referral fee from partners." }));

      const aside = el(doc, 'aside', { class: 'gvb2-aside', 'aria-label': 'Trip total' }, [
        el(doc, 'div', { class: 'gvb2-kicker gvb2-kicker-dark', text: 'TRIP TOTAL' }),
        el(doc, 'div', { class: 'gvb2-line' }, [el(doc, 'span', { text: `Flights (${s.flightCount})` }), el(doc, 'strong', { text: money(s.flights, cur) })]),
        el(doc, 'div', { class: 'gvb2-line' }, [el(doc, 'span', { text: `Hotels (${s.hotelCount})` }), el(doc, 'strong', { text: money(s.hotels, cur) })]),
        s.payAtHotel ? el(doc, 'div', { class: 'gvb2-line' }, [el(doc, 'span', { text: 'Local taxes paid at hotels' }), el(doc, 'strong', { text: money(s.payAtHotel, cur) })]) : null,
        s.extras ? el(doc, 'div', { class: 'gvb2-line' }, [el(doc, 'span', { text: 'Airport transfers & extras (estimate)' }), el(doc, 'strong', { text: money(s.extras, cur) })]) : null,
        el(doc, 'div', { class: 'gvb2-rule' }),
        el(doc, 'div', { class: 'gvb2-line gvb2-total' }, [el(doc, 'span', { text: 'Total' }), el(doc, 'strong', { text: money(s.total, cur) })]),
        s.budget != null ? el(doc, 'div', { class: 'gvb2-line gvb2-muted' }, [el(doc, 'span', { text: 'Your budget' }), el(doc, 'span', { text: money(s.budget, cur) })]) : null,
        s.reserve ? el(doc, 'div', { class: 'gvb2-line gvb2-muted' }, [el(doc, 'span', { text: 'Safety reserve' }), el(doc, 'span', { text: money(s.reserve, cur) })]) : null,
        s.left != null ? el(doc, 'div', { class: `gvb2-line ${s.left >= 0 ? 'gvb2-good' : 'gvb2-bad'}` }, [el(doc, 'span', { text: s.left >= 0 ? 'Left for extras' : 'Over budget' }), el(doc, 'strong', { text: money(Math.abs(s.left), cur) })]) : null,
        el(doc, 'div', { class: 'gvb2-note', text: s.liveCount === items.length
          ? `All ${items.length} prices are live. Prices can change until you book.`
          : `${s.liveCount} of ${items.length} prices are live; the rest are estimates. Partner sites confirm the final price.` }),
        el(doc, 'button', { type: 'button', class: 'gvb2-classic', onclick: () => toggleClassic(doc, true) }, ['Show detailed view'])
      ]);

      host.appendChild(el(doc, 'div', { class: 'gvb2-wrap' }, [list, aside]));
    }
    async function loadLinks(it) {
      if (it.loadingLinks || it.links) return;
      it.loadingLinks = true;
      draw();
      const result = await handoffs()?.fetchLinks(it.ignav);
      it.links = Array.isArray(result?.links) ? result.links : [];
      it.loadingLinks = false;
      if (!bestLink(it.links)) it.ignav = null;
      draw();
    }
    draw();
    return true;
  }

  function toggleClassic(doc, show) {
    doc.body?.classList?.[show ? 'remove' : 'add']('gvb2-on');
    OLD_SECTIONS.forEach(sel => doc.querySelectorAll(sel).forEach(node => {
      if (node.id === 'gv-booking-v2' || node.closest('#gv-booking-v2')) return;
      if (show) { if (node.dataset.gvb2Hidden) { node.style.display = ''; delete node.dataset.gvb2Hidden; } }
      else if (node.style.display !== 'none') { node.dataset.gvb2Hidden = '1'; node.style.display = 'none'; }
    }));
  }

  function start() {
    const doc = root.document;
    if (!doc) return;
    let done = false;
    const run = () => {
      if (done) return true;
      const tour = root.GlobevoyBooking673FR1?.tour;
      if (!tour) return false;
      let host = doc.getElementById('gv-booking-v2');
      if (!host) {
        const main = doc.querySelector('.gv-booking-main') || doc.body;
        host = doc.createElement('div'); host.id = 'gv-booking-v2';
        const back = doc.getElementById('gv-booking-back');
        if (back && back.parentNode === main) back.after(host); else main.prepend(host);
      }
      if (!render(doc, tour, { historical: true })) return false;
      toggleClassic(doc, false);
      done = true;
      void readVerifiedQuote(tour).then(evidence => {
        if (!evidence || root.GlobevoyBooking673FR1?.tour !== tour) return;
        render(doc, evidence.quote);
        root.setTimeout(() => {
          if (root.GlobevoyBooking673FR1?.tour === tour) render(doc, evidence.quote, { historical: true });
        }, Math.max(0, evidence.expiresAt - Date.now()));
      });
      return true;
    };
    root.addEventListener?.('globevoy:booking-tour-ready', () => root.setTimeout?.(run, 0));
    if (!run()) {
      let attempts = 0;
      const timer = root.setInterval?.(() => { if (run() || ++attempts > 80) root.clearInterval?.(timer); }, 250);
    }
  }

  const api = { VERSION, bestLink, buildItems, summaryOf, render, safeUrl, ageLabel, readVerifiedQuote, start };
  root.GlobevoyBookingV2 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
