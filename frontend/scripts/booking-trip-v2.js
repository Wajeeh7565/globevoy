// GV-BOOK-V2-001 — booking page ("Editorial Travel" design since GV-WEB-3).
//
// One row per flight and per hotel, in travel order: price, where the price
// came from (live provider or estimate), one main book button, one comparison
// link, and a "Booked" tick. Optional "Start booking" guide highlights the next
// unbooked item. Referral only: every button opens a partner site in a new tab.
//
// Reads the trip with trip-handoff.js (or a tour an embedder publishes as
// window.GlobevoyBooking673FR1.tour) and renders into #gv-booking-v2.
(function (root) {
  'use strict';
  const VERSION = 'GV-BOOK-V2-004';
  const AGODA_CID = '1963873';
  // How long a Nuitee offerId is trusted for one-click checkout. Older than
  // this, the main button opens the hotel page (current price) instead.
  const OFFER_FRESH_MINUTES = 30;

  function safeUrl(value) {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; }
  }
  function num(value) { if (value == null || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
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
    const fare = leg?.cheapestOneWay || {};
    const shown = String(cp.currency || '').toUpperCase() === cur.code ? num(cp.amountDisplay) :
      String(fare.displayCurrency || fare.currency || '').toUpperCase() === cur.code ? num(fare.partyTotalAmountDisplay ?? fare.displayPrice) : null;
    const from = leg?.from || {}, to = leg?.to || {};
    const date = isoDate(leg?.departureDate);
    const compareUrl = safeUrl(leg?.booking?.url || leg?.bookingUrl || leg?.providerUrl);
    const ground = isGround(leg);
    return {
      kind: ground ? 'ground' : 'flight',
      title: `${cityName(from)}${code(from) ? ` (${code(from)})` : ''} → ${cityName(to)}${code(to) ? ` (${code(to)})` : ''}`,
      route: `${cityName(from)} → ${cityName(to)}`,
      codes: code(from) && code(to) ? [code(from), code(to)] : null,
      when: dateLabel(date, true),
      info: leg?.airline || leg?.operator || leg?.cheapestOneWay?.carrier || '',
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

  function hotelRow(city, stay, cur, now, party, line) {
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
    else if (num(hotel.totalStayUsd) != null && cur.fx) price = num(hotel.totalStayUsd) * cur.fx;
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
    price = num(line?.room) ?? price;
    payAtHotel = num(line?.mandatoryFees) ?? payAtHotel;
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
      city: cityName(city),
      country: String(city?.country || ''),
      when: checkIn && checkOut ? `${dateLabel(checkIn)} – ${dateLabel(checkOut)}` : '',
      nights,
      info: detailBits.slice(checkIn && checkOut ? 1 : 0).filter(x => !/^\d+ nights?$/.test(x)).join(' · '),
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
    const lines = tour.displayBudget?.lineItems;
    legs.forEach((leg, i) => {
      const flight = flightRow(leg, cur, now, party);
      flight.price = num(lines?.flights?.[i]) ?? flight.price;
      if (!flight.codes) {
        const from = code(i === 0 ? tour?.origin : cities[i - 1]), to = code(cities[i] || tour?.origin);
        if (from && to) flight.codes = [from, to];
      }
      items.push(flight);
      if (cities[i]) items.push(hotelRow(cities[i], stays[i], cur, now, party, lines?.stays?.[i]));
    });
    if (!legs.length) cities.forEach((c, i) => items.push(hotelRow(c, stays[i], cur, now, party)));
    items.forEach((it, i) => { it.id = `${it.kind}-${i}`; it.index = i; });
    return { items, cur };
  }

  function summaryOf(tour, items, cur) {
    const d = tour?.displayBudget || {};
    const flights = num(d.flightEstimate) ?? items.filter(x => x.kind !== 'hotel').reduce((s, x) => s + (x.price || 0), 0);
    // The trip total the rest of the site shows also includes airport-access /
    // transfer estimates and other extras; show those as their own line so the
    // two pages agree.
    const payAtHotel = items.filter(x => x.kind === 'hotel').reduce((s, x) => s + (x.payAtHotel || 0), 0);
    const siteTotal = num(d.tripEstimate);
    const accommodation = num(d.accommodationEstimate);
    const hotels = accommodation != null ? accommodation - payAtHotel :
      items.filter(x => x.kind === 'hotel').reduce((s, x) => s + (x.price || 0), 0);
    const extras = siteTotal != null && siteTotal - (flights + hotels + payAtHotel) > 1 ? siteTotal - (flights + hotels + payAtHotel) : 0;
    const total = siteTotal ?? flights + hotels + payAtHotel + extras;
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
      left: num(d.amountLeft) ?? (budget != null ? budget - reserve - total : null),
      flightCount: items.filter(x => x.kind !== 'hotel').length,
      hotelCount: items.filter(x => x.kind === 'hotel').length,
      liveCount: items.filter(x => x.live).length,
      cur
    };
  }

  // ---------- rendering (DOM only; no trip data goes through innerHTML) ----------
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

  function readVerifiedQuote(tour, fetchFn) {
    const quotes = root.GlobevoyJourneyQuote ||
      (typeof module === 'object' && module.exports ? require('../runtime/api-client') : null);
    return quotes?.readVerifiedQuote(tour, fetchFn) || Promise.resolve(null);
  }

  const ICONS = {
    flight: '<path d="m3 10 7 2 6-8 2 1-3 9 5 3-1 2-7-2-4 4-2-1 2-5-5-3Z"/>',
    ground: '<path d="m3 10 7 2 6-8 2 1-3 9 5 3-1 2-7-2-4 4-2-1 2-5-5-3Z"/>',
    hotel: '<path d="M3 18V8m18 10v-5a2 2 0 0 0-2-2H3m0 5h18M7 11V8h5a2 2 0 0 1 2 2v1"/>'
  };
  function icon(doc, kind) {
    const span = el(doc, 'span', { class: 'step-icon', 'aria-hidden': 'true' });
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.innerHTML = ICONS[kind] || ICONS.flight; // fixed markup, no trip data
    span.appendChild(svg);
    return span;
  }
  // Cities with a bundled scene photo use it first, as the results page does.
  const SCENES = ['lisbon', 'seville', 'tokyo', 'prague', 'vienna', 'budapest', 'seoul', 'taipei', 'marrakech'];
  const photoCache = new Map();
  function cityPhotos(city, country) {
    const key = city + '|' + country;
    if (!photoCache.has(key)) {
      const scene = String(city || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
      const local = SCENES.includes(scene) ? [{ url: `./assets/media/scenes/${scene}.jpg` }] : [];
      photoCache.set(key, Promise.resolve(root.GlobevoyCityImages?.photos?.(city, country)).catch(() => []).then(list => local.concat(list || [])));
    }
    return photoCache.get(key);
  }
  async function paintPhoto(figure, item) {
    const photos = await cityPhotos(item.city, item.country);
    for (const photo of photos) {
      if (!figure.isConnected) return;
      const img = figure.ownerDocument.createElement('img');
      img.alt = [item.city, item.country].filter(Boolean).join(', ');
      img.decoding = 'async';
      const ok = await new Promise(resolve => { img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = photo.url; });
      if (!ok) continue;
      if (!figure.isConnected) return;
      figure.prepend(img);
      figure.classList.add('has-photo');
      root.GlobevoyCityImages?.setCredit?.(figure, photo);
      return;
    }
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
    // GV-BOOK-706A: a trip reopened from Saved Trips carries prices saved earlier. It
    // cannot open flight or stay partner handoffs until its prices are revalidated.
    const locked = root.GLOBEVOY_BOOKING_ACCOUNT_SNAPSHOT_706A?.snapshotOnly === true;
    if (locked) {
      for (const item of items) {
        Object.assign(item, { live: false, source: 'Saved account snapshot — verification required', ignav: null, checkoutExpiresAt: null,
          mainUrl: '', compareUrl: '', altUrl: '', mainLabel: 'Revalidation required', locked: true });
      }
    }
    const s = summaryOf(tour, items, cur);
    const key = storageKey(tour);
    const state = { booked: loadBooked(key), guiding: false };
    const kindLabel = it => (it.kind === 'hotel' ? 'Stay' : it.kind === 'ground' ? 'Transport' : 'Flight');

    function step(it, guiding, next) {
      const booked = !!state.booked[it.id];
      const best = it.ignav && it.links ? bestLink(it.links) : null;
      const mainUrl = best ? best.url : it.mainUrl;
      const mainLabel = best
        ? `${best.specificity === 'exact_flight' ? 'Book on' : 'Compare on'} ${best.providerName || 'partner'}`
        : it.mainLabel;
      const main = it.ignav && !it.links
        ? el(doc, 'button', { type: 'button', class: 'button primary gvb2-main gvb2-linkbtn', disabled: it.loadingLinks,
          onclick: () => loadLinks(it), text: it.loadingLinks ? 'Checking booking options…' : 'See booking options' })
        : mainUrl
        ? el(doc, 'a', { class: 'button primary gvb2-main', href: mainUrl, target: '_blank', rel: 'noopener nofollow',
          onclick: it.checkoutExpiresAt ? event => {
            if (Date.now() >= it.checkoutExpiresAt && it.altUrl) event.currentTarget.href = it.altUrl;
          } : null }, [`${mainLabel} `, el(doc, 'span', { 'aria-hidden': 'true', text: '↗' })])
        : el(doc, 'span', { class: 'button gvb2-main gvb2-disabled', 'aria-disabled': 'true', text: it.locked ? 'Revalidation required' : 'Link unavailable' });
      const side = el(doc, 'div', { class: 'step-side gvb2-right' }, [
        el(doc, 'strong', { class: 'offer-price gvb2-price', text: money(it.price, cur) }), main]);
      const extra = [];
      if (it.altUrl) extra.push(el(doc, 'a', { class: 'gvb2-compare', href: it.altUrl, target: '_blank', rel: 'noopener nofollow', text: it.altLabel }));
      if (it.compareUrl && (it.compareUrl !== mainUrl || it.ignav && !it.links)) extra.push(el(doc, 'a', { class: 'gvb2-compare', href: it.compareUrl, target: '_blank', rel: 'noopener nofollow', text: it.compareLabel }));
      const options = it.ignav && it.links && it.links.length > 1 ? it.links.map(l => ({ ...l, url: safeUrl(l.url) })).filter(l => l.url).slice(0, 6) : [];
      if (options.length > 1) extra.push(el(doc, 'button', { type: 'button', class: 'gvb2-compare gvb2-linkbtn', 'aria-expanded': it.open ? 'true' : 'false',
        onclick: () => { it.open = !it.open; draw(); } }, [it.open ? 'Hide other options' : `${options.length - 1} more option${options.length > 2 ? 's' : ''}`]));
      if (extra.length) side.appendChild(el(doc, 'div', { class: 'gvb2-links' }, extra));
      side.appendChild(el(doc, 'label', { class: 'check gvb2-tick' }, [
        el(doc, 'input', { type: 'checkbox', checked: booked, onchange: () => { state.booked[it.id] = !booked; saveBooked(key, state.booked); draw(); } }),
        ' Mark as booked'
      ]));
      const article = el(doc, 'article', { id: `step-${it.index + 1}`,
        class: `booking-step ${it.kind === 'hotel' ? 'stay' : 'flight'} gvb2-item${booked ? ' tracked is-booked' : ''}${guiding && next.id === it.id ? ' is-next' : ''}` });
      if (it.kind === 'hotel' && it.city) {
        const figure = el(doc, 'figure', { class: 'step-photo' }, [el(doc, 'figcaption', { text: [it.city, it.country].filter(Boolean).join(', ') })]);
        article.appendChild(figure);
        void paintPhoto(figure, it);
      }
      const meta = [`${it.index + 1} of ${items.length}`, kindLabel(it), it.kind === 'hotel' ? [it.when, it.nights ? `${it.nights} night${it.nights === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : it.when].filter(Boolean).join(' · ');
      const mainCol = el(doc, 'div', { class: 'step-main gvb2-body' }, [
        el(doc, 'div', { class: 'step-meta gvb2-step' }, [icon(doc, it.kind), el(doc, 'span', { text: meta })]),
        it.codes ? el(doc, 'div', { class: 'codes', 'aria-hidden': 'true' }, [it.codes[0], el(doc, 'span', { text: '→' }), it.codes[1]]) : null,
        el(doc, 'h3', { class: 'gvb2-item-title', text: it.kind === 'hotel' ? it.title : (it.route || it.title) }),
        it.info ? el(doc, 'p', { class: 'gvb2-detail', text: it.info }) : null,
        el(doc, 'p', { class: `quiet gvb2-source ${it.live ? 'gvb2-live' : 'gvb2-est'}`, text: [it.source, it.age].filter(Boolean).join(' · ') })
      ]);
      article.appendChild(el(doc, 'div', { class: 'step-core' }, [mainCol, side]));
      if (it.open && options.length > 1) {
        article.appendChild(el(doc, 'div', { class: 'gvb2-options' }, [el(doc, 'ul', {}, options.map(l => el(doc, 'li', {}, [
          el(doc, 'a', { href: l.url, target: '_blank', rel: 'noopener nofollow', text: `${l.providerName || 'Booking site'} ↗` }),
          ` ${l.providerType === 'airline' ? 'Airline' : 'Booking site'}${num(l.amount) != null ? ` · ${l.currency || ''} ${Math.round(l.amount)}` : ''}${l.specificity === 'exact_flight' ? ' · flight preselected' : ''}`
        ])))]));
      }
      article.appendChild(el(doc, 'details', { class: 'evidence' }, [el(doc, 'summary', { text: 'Price and terms' }), el(doc, 'p', { text:
        (it.live ? 'This is a live price GlobeVoy checked for your dates. ' : 'This price is an estimate until the partner site shows the current one. ') +
        (it.kind === 'hotel' ? 'Check the room, the cancellation terms and any local taxes paid at the hotel before you pay.' : 'Check the schedule, baggage and fare rules with the airline before you pay.') })]));
      return article;
    }

    function draw() {
      host.textContent = '';
      const count = items.filter(x => state.booked[x.id]).length;
      const next = items.find(x => !state.booked[x.id]);
      const guiding = state.guiding && next;
      const allLive = s.liveCount === items.length;

      const heading = el(doc, 'div', { class: 'booking-editorial' }, [
        el(doc, 'div', { class: 'page-heading' }, [
          el(doc, 'h1', { class: 'gvb2-title', text: 'Booking options' }),
          el(doc, 'p', { class: 'route-title', text: s.route }),
          el(doc, 'p', { class: 'quiet', text: s.dates })
        ]),
        el(doc, 'p', { text: 'Flights and stays, in travel order.' })
      ]);
      const mobile = el(doc, 'div', { class: 'mobile-total' }, [
        el(doc, 'a', { href: '#trip-summary' }, [el(doc, 'strong', { text: money(s.total, cur) }), el(doc, 'span', { class: 'quiet', text: `${cur.code} · trip total` })]),
        el(doc, 'a', { class: 'button', href: '#checklist-title', text: 'Checklist ↓' })
      ]);
      const progress = el(doc, 'section', { class: 'progress-box', 'aria-labelledby': 'checklist-title' }, [
        el(doc, 'div', { class: 'section-row' }, [el(doc, 'h2', { id: 'checklist-title', text: 'Booking checklist' }),
          el(doc, 'strong', { id: 'progress-text', class: 'gvb2-count', role: 'status', text: `${count} of ${items.length} marked` })]),
        el(doc, 'progress', { max: String(items.length), value: String(count), 'aria-labelledby': 'progress-text' }),
        el(doc, 'div', { class: 'section-row progress-foot' }, [
          el(doc, 'p', { class: 'quiet', text: 'Each partner site opens in a new tab. Tick each item after you book it.' }),
          el(doc, 'button', { type: 'button', class: 'button gvb2-start', disabled: count === items.length, onclick: () => { state.guiding = true; draw(); } },
            [count === items.length ? 'All booked ✓' : (state.guiding ? 'Booking in progress' : 'Start booking')])
        ])
      ]);
      const list = el(doc, 'section', { class: 'booking-list gvb2-list', 'aria-label': 'Flights and stays' });
      if (guiding) {
        list.appendChild(el(doc, 'div', { class: 'gvb2-guide', role: 'status' }, [
          el(doc, 'strong', { text: `Next: ${next.kind === 'hotel' ? next.title : (next.route || next.title)}` }),
          el(doc, 'p', { text: 'Book this one on the partner site, then come back and tick “Mark as booked”. Book flights first: if a flight changes, hotel dates may need to change too.' }),
          el(doc, 'a', { class: 'gvb2-jump', href: `#step-${next.index + 1}`, text: 'Go to this step ↓' })
        ]));
      }
      items.forEach(it => list.appendChild(step(it, guiding, next)));
      const left = el(doc, 'div', {}, [progress, list, el(doc, 'p', { class: 'quiet disclosure gvb2-legal',
        text: "You book each part on the partner's site, and the final price is shown there before you pay. GlobeVoy doesn't take payments; it may earn a referral fee from partners." })]);

      const denominator = Math.max(num(s.budget) || 0, s.flights + s.hotels + (s.payAtHotel || 0) + (s.reserve || 0), 1);
      const bar = el(doc, 'div', { class: 'allocation', 'aria-hidden': 'true' }, [s.flights, s.hotels + (s.payAtHotel || 0), s.reserve || 0]
        .map(v => el(doc, 'i', { style: `width:${Math.max(0, v) / denominator * 100}%` })));
      const line = (label, value, cls) => el(doc, 'div', { class: `gvb2-line${cls ? ' ' + cls : ''}` }, [el(doc, 'dt', { text: label }), el(doc, 'dd', { text: value })]);
      const aside = el(doc, 'aside', { class: 'summary gvb2-aside', id: 'trip-summary', 'aria-labelledby': 'summary-title' }, [
        el(doc, 'h2', { id: 'summary-title', text: 'Booking summary' }),
        el(doc, 'p', { class: 'quiet', text: `${cur.code} · ${allLive ? 'live prices' : 'some prices are estimates'}` }),
        el(doc, 'div', { class: 'grand gvb2-total' }, [el(doc, 'strong', { text: money(s.total, cur) })]),
        el(doc, 'details', { class: 'cost-details', open: true }, [el(doc, 'summary', { text: 'Cost breakdown' }), bar,
          el(doc, 'dl', {}, [
            line(`Flights (${s.flightCount})`, money(s.flights, cur)),
            line(`Hotels (${s.hotelCount})`, money(s.hotels, cur)),
            s.payAtHotel ? line('Local taxes paid at hotels', money(s.payAtHotel, cur)) : null,
            s.extras ? line('Airport transfers & extras (estimate)', money(s.extras, cur)) : null,
            s.reserve ? line('Spending money', money(s.reserve, cur)) : null,
            s.budget != null ? line('Your budget', money(s.budget, cur)) : null,
            s.left != null ? line(s.left >= 0 ? 'Left over' : 'Over budget', money(Math.abs(s.left), cur), s.left >= 0 ? 'balance' : 'balance over') : null
          ].filter(Boolean))]),
        el(doc, 'p', { class: 'quiet gvb2-note', text: allLive
          ? `All ${items.length} prices are live. Prices can change until you book.`
          : `${s.liveCount} of ${items.length} prices are live; the rest are estimates. Partner sites confirm the final price.` })
      ]);
      host.append(heading, mobile, el(doc, 'div', { class: 'workspace gvb2-wrap' }, [left, aside]));
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

  function setState(doc, name) {
    ['loading', 'error'].forEach(id => { const node = doc.getElementById('gv-booking-' + id); if (node) node.hidden = id !== name; });
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
        host = doc.createElement('div'); host.id = 'gv-booking-v2';
        (doc.querySelector('main') || doc.body).prepend(host);
      }
      if (!render(doc, tour, { historical: true })) return false;
      setState(doc, '');
      done = true;
      if (root.GLOBEVOY_BOOKING_ACCOUNT_SNAPSHOT_706A?.snapshotOnly === true) return true;
      void readVerifiedQuote(tour).then(evidence => {
        if (!evidence || root.GlobevoyBooking673FR1?.tour !== tour) return;
        tour.displayBudget = evidence.quote.displayBudget;
        render(doc, evidence.quote);
        root.setTimeout(() => {
          if (root.GlobevoyBooking673FR1?.tour === tour) render(doc, evidence.quote, { historical: true });
        }, Math.max(0, evidence.expiresAt - Date.now()));
      });
      return true;
    };
    root.addEventListener?.('globevoy:booking-tour-ready', () => root.setTimeout?.(run, 0));
    if (run()) return;
    // The booking page loads the trip itself (trip-handoff.js); embedders may publish
    // window.GlobevoyBooking673FR1.tour instead.
    if (root.GlobevoyTripHandoff) {
      // Single-city saved trips (from the retired single-trip page) are not multi-city
      // tours; never fall back to another trip stored in this tab.
      if (String(new URLSearchParams(root.location?.search || '').get('multi') || '').toLowerCase() === 'false') { setState(doc, 'error'); return; }
      root.GlobevoyTripHandoff.load().then(tour => {
        if (!tour) { setState(doc, 'error'); return; }
        root.GlobevoyBooking673FR1 = { ...(root.GlobevoyBooking673FR1 || {}), tour };
        if (!run()) setState(doc, 'error');
      }).catch(() => setState(doc, 'error'));
      return;
    }
    let attempts = 0;
    const timer = root.setInterval?.(() => { if (run() || ++attempts > 80) root.clearInterval?.(timer); }, 250);
  }

  const api = { VERSION, bestLink, buildItems, summaryOf, render, safeUrl, ageLabel, readVerifiedQuote, start };
  root.GlobevoyBookingV2 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
