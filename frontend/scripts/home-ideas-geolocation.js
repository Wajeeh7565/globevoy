(function () {
  'use strict';

  const Origins = window.GlobevoySupportedOrigins || {};
  const Api = window.GlobevoyApi || {};
  const pool = Array.isArray(window.GLOBEVOY_PUBLIC_DISCOVERY_500) ? window.GLOBEVOY_PUBLIC_DISCOVERY_500 : [];
  const q = (selector) => document.querySelector(selector);

  const originInput = q('#gv-origin');
  const budgetInput = q('#gv-budget');
  const tripLength = q('#gv-trip-length');
  const preferredMonth = q('#gv-preferred-month');
  const interestInput = q('#gv-interests');
  const regionInput = q('#gv-continent');
  const locationButton = q('#gv-use-location');
  const locationStatus = q('#gv-location-status');
  const ideasTitle = q('#gv-home-ideas-title');
  const ideasCopy = q('#gv-home-ideas-copy');
  const ideasState = q('#gv-home-ideas-state');
  const ideasGrid = q('#gv-home-ideas-grid');
  const ideasSection = q('#gv-home-ideas');
  const shuffleButton = q('#gv-home-ideas-shuffle');

  if (!originInput || !budgetInput || !ideasGrid) return;

  const FX = { USD: 1, CAD: 1.36, AUD: 1.52, EUR: 0.92, GBP: 0.79 };
  const LAST_ORIGIN_KEY = 'globevoy.last-origin.v1';
  const IDEAS_CACHE_PREFIX = 'globevoy.home-ideas.v2:';
  const IDEAS_CACHE_TTL = 6 * 60 * 60 * 1000;
  const AUTO_PROMPT_KEY = 'globevoy.location-auto-prompted.v1';
  const byKey = new Map();

  pool.forEach((item) => {
    byKey.set(String(item.city || '').toLowerCase(), item);
    byKey.set(String(item.code || '').toUpperCase(), item);
    byKey.set(String(item.cityId || '').toLowerCase(), item);
  });

  let loadSerial = 0;
  let timer = null;
  let locationBusy = false;
  let ideaVariant = 0;
  let lastIdeaPool = [];
  let lastIdeaCurrency = 'CAD';
  let lastIdeaOriginCode = '';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }


  function hashHue(city, country) {
    const text = `${city}|${country}`;
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
    return h;
  }

  function svgText(value) {
    return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] || char);
  }

  function generatedCityImage(city, country) {
    const hue = hashHue(city || 'Destination', country || '');
    const h2 = (hue + 42) % 360;
    const h3 = (hue + 184) % 360;
    const safeCity = svgText(city || 'Destination');
    const safeCountry = svgText(country || '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" role="img" aria-label="${safeCity} travel image"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},66%,44%)"/><stop offset=".55" stop-color="hsl(${h2},58%,35%)"/><stop offset="1" stop-color="hsl(${h3},48%,26%)"/></linearGradient></defs><rect width="1200" height="720" fill="url(#g)"/><circle cx="965" cy="120" r="155" fill="rgba(255,255,255,.18)"/><path d="M0 510 C160 392 310 424 450 344 C620 246 790 318 930 220 C1040 142 1135 174 1200 128 L1200 720 L0 720 Z" fill="rgba(255,255,255,.24)"/><path d="M0 570 C190 492 340 526 520 456 C690 388 850 438 1038 358 C1132 318 1180 312 1200 302 L1200 720 L0 720 Z" fill="rgba(4,18,34,.28)"/><g fill="rgba(255,255,255,.78)"><rect x="118" y="355" width="48" height="185" rx="8"/><rect x="188" y="302" width="72" height="238" rx="10"/><rect x="282" y="388" width="55" height="152" rx="8"/><rect x="362" y="335" width="88" height="205" rx="10"/><rect x="470" y="408" width="58" height="132" rx="8"/></g><text x="70" y="104" fill="white" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="64" letter-spacing="-2">${safeCity}</text><text x="74" y="154" fill="rgba(255,255,255,.80)" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="28" letter-spacing="4">${safeCountry}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function safeJson(storage, key, fallback) {
    try {
      return JSON.parse(storage.getItem(key) || 'null') ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeSet(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Storage may be disabled by browser privacy settings.
    }
  }

  function selectedOrigin() {
    return Origins.find ? Origins.find(originInput.value, { allowPrefix: false }) : null;
  }

  function currencyFor(origin) {
    return Origins.currencyFor ? Origins.currencyFor(origin, 'CAD') : 'CAD';
  }

  function fmt(value, currency) {
    try {
      return new Intl.NumberFormat('en-CA', {
        style: 'currency', currency, maximumFractionDigits: 0
      }).format(Number(value) || 0);
    } catch (_) {
      return `${currency} ${Math.round(Number(value) || 0)}`;
    }
  }

  function nights() {
    const value = tripLength && tripLength.value;
    return value && value !== 'auto' ? Math.max(2, Number(value) || 5) : 5;
  }

  function readStored() {
    try {
      return JSON.parse(sessionStorage.getItem('globevoy.home.search.v2') || '{}');
    } catch (_) {
      return {};
    }
  }

  function readAdults() {
    return Number(readStored().adults) || 1;
  }

  function readChildren() {
    return Number(readStored().children) || 0;
  }

  function readPassengers() {
    return readAdults() + readChildren();
  }

  function stateParams(extra) {
    const origin = selectedOrigin();
    const currency = currencyFor(origin);
    const params = new URLSearchParams({
      mode: 'mixed',
      recommendationScope: 'single-and-multicity',
      origin: origin && Origins.label ? Origins.label(origin) : originInput.value,
      budget: String(Math.round(Number(budgetInput.value) || 1000)),
      currency,
      passengers: String(readPassengers()),
      adults: String(readAdults()),
      children: String(readChildren()),
      nights: String(nights()),
      tripLength: tripLength ? tripLength.value : 'auto',
      dateMode: 'flexible',
      flexible: 'true',
      preferredMonth: preferredMonth ? preferredMonth.value : '',
      month: preferredMonth ? preferredMonth.value : '',
      interests: interestInput ? interestInput.value : 'No preference',
      region: (regionInput && regionInput.value || 'Anywhere') === 'Anywhere' ? 'All continents' : regionInput.value
    });
    Object.entries(extra || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) params.set(key, String(value));
    });
    return params;
  }

  function distanceKm(a, b) {
    const radius = 6371;
    const toRad = (value) => value * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sin = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(sin));
  }

  function setLocationStatus(message, error) {
    if (!locationStatus) return;
    locationStatus.textContent = message || '';
    locationStatus.classList.toggle('is-error', Boolean(error));
  }

  function rememberOrigin(origin) {
    if (!origin) return;
    safeSet(localStorage, LAST_ORIGIN_KEY, {
      label: Origins.label ? Origins.label(origin) : `${origin.city} (${origin.code})`,
      code: origin.code || '',
      savedAt: Date.now()
    });
  }

  function setLocationButtonBusy(busy) {
    if (!locationButton) return;
    locationButton.disabled = busy;
    locationButton.classList.toggle('is-loading', busy);
    const label = locationButton.querySelector('span:last-child');
    if (label) label.textContent = busy ? 'Detecting…' : 'Use my location';
  }

  function matchPosition(position) {
    const point = { lat: position.coords.latitude, lng: position.coords.longitude };
    const choices = (Origins.all ? Origins.all() : [])
      .filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)))
      .map((item) => ({
        item,
        distance: distanceKm(point, { lat: Number(item.lat), lng: Number(item.lng) })
      }))
      .sort((a, b) => a.distance - b.distance);

    const nearest = choices[0];
    if (!nearest) throw new Error('No nearby flightable airport could be matched.');

    originInput.value = Origins.label ? Origins.label(nearest.item) : nearest.item.label;
    rememberOrigin(nearest.item);
    originInput.dispatchEvent(new Event('change', { bubbles: true }));
    setLocationStatus(`Using ${originInput.value} · nearest practical airport`, false);
    scheduleIdeas(0);
    return nearest;
  }

  function locationErrorMessage(error) {
    if (!error) return 'Your location could not be determined. Enter a city manually.';
    if (error.code === 1) return 'Location permission is off. Enter a city manually or allow it in your browser.';
    if (error.code === 2) return 'Your location could not be determined. Enter a city manually.';
    return 'Location detection timed out. Try again or enter your city manually.';
  }

  function requestLocation(options) {
    const settings = Object.assign({ automatic: false, quiet: false }, options || {});
    if (locationBusy) return Promise.resolve(null);
    if (!navigator.geolocation) {
      if (!settings.quiet) setLocationStatus('Location detection is not supported in this browser.', true);
      return Promise.resolve(null);
    }
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      if (!settings.quiet) setLocationStatus('Location detection requires the secure HTTPS website.', true);
      return Promise.resolve(null);
    }

    locationBusy = true;
    setLocationButtonBusy(true);
    if (!settings.quiet) setLocationStatus('Finding your nearest practical airport…', false);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition((position) => {
        try {
          resolve(matchPosition(position));
        } catch (error) {
          if (!settings.quiet) setLocationStatus(error.message || locationErrorMessage(), true);
          resolve(null);
        } finally {
          locationBusy = false;
          setLocationButtonBusy(false);
        }
      }, (error) => {
        if (!settings.quiet || !selectedOrigin()) setLocationStatus(locationErrorMessage(error), true);
        locationBusy = false;
        setLocationButtonBusy(false);
        resolve(null);
      }, {
        enableHighAccuracy: false,
        timeout: settings.automatic ? 4500 : 8000,
        maximumAge: settings.automatic ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000
      });
    });
  }

  function useLocation() {
    requestLocation({ automatic: false, quiet: false });
  }

  function hasExplicitOrigin() {
    const source = String(window.GLOBEVOY_HOME_ORIGIN_SOURCE || '');
    return source === 'query' || source === 'session';
  }

  async function autoLocate() {
    if (selectedOrigin()) {
      setLocationStatus('Using your recent starting city while Globevoy refreshes in the background.', false);
      scheduleIdeas(0);
    }

    if (hasExplicitOrigin()) return;
    if (!navigator.geolocation || (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')) return;

    let permissionState = 'prompt';
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        permissionState = permission.state;
        permission.addEventListener?.('change', () => {
          if (permission.state === 'granted') requestLocation({ automatic: true, quiet: true });
        });
      }
    } catch (_) {
      // Some browsers expose geolocation without the Permissions API.
    }

    if (permissionState === 'granted') {
      requestLocation({ automatic: true, quiet: true });
      return;
    }

    if (permissionState === 'denied') {
      if (!selectedOrigin()) setLocationStatus('Location access is off. Enter a city or enable location permission.', true);
      return;
    }

    // First visit: ask once per browser session. The browser still controls the
    // permission prompt, and no exact coordinates are stored by Globevoy.
    let prompted = false;
    try { prompted = sessionStorage.getItem(AUTO_PROMPT_KEY) === '1'; } catch (_) {}
    if (!prompted && !selectedOrigin()) {
      try { sessionStorage.setItem(AUTO_PROMPT_KEY, '1'); } catch (_) {}
      window.setTimeout(() => requestLocation({ automatic: true, quiet: false }), 500);
    }
  }

  function normalize(item) {
    if (!item || !item.city) return null;
    const base = byKey.get(String(item.id || '').toLowerCase())
      || byKey.get(String(item.code || '').toUpperCase())
      || byKey.get(String(item.city).toLowerCase())
      || {};
    const flight = Number(item.flight ?? item.flightUsd ?? item.flightEstimateUsd ?? item.costs?.flightUsd ?? 0);
    const stay = Number(item.lodging ?? item.stay ?? item.stayUsd ?? item.stayEstimateUsd ?? item.costs?.stayUsd ?? 0);
    const total = Number(item.estimatedFlightAndStayTotal ?? item.total ?? (flight + stay));
    if (!Number.isFinite(total) || total <= 0) return null;
    return {
      ...base,
      ...item,
      id: String(item.id || base.cityId || item.code || item.city).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      city: item.city,
      country: item.country || base.country || '',
      code: item.code || base.code || '',
      flight,
      stay,
      total,
      nights: Number(item.nights || nights()),
      img: item.img || base.img || '',
      score: Number(item.recommendationScore ?? item.score ?? 0),
      themes: item.themes || base.themes || []
    };
  }

  function rotateList(items) {
    if (!items.length) return [];
    const offset = Math.abs(ideaVariant) % items.length;
    return items.slice(offset).concat(items.slice(0, offset));
  }

  function choose(items) {
    if (!items.length) return [];
    const rotated = rotateList(items);
    const sorted = [...rotated].sort((a, b) => a.total - b.total || rotated.indexOf(a) - rotated.indexOf(b));
    const output = [];
    if (sorted[0]) output.push({ ...sorted[0], label: 'Lowest cost' });
    const target = (Number(budgetInput.value) || 1000) / (FX[currencyFor(selectedOrigin())] || 1) * 0.78;
    const balance = rotated
      .filter((item) => !output.some((selected) => selected.id === item.id))
      .sort((a, b) => Math.abs(a.total - target) - Math.abs(b.total - target) || b.score - a.score || rotated.indexOf(a) - rotated.indexOf(b))[0];
    if (balance) output.push({ ...balance, label: 'Best balance' });
    const memorable = rotated
      .filter((item) => !output.some((selected) => selected.id === item.id))
      .sort((a, b) => (b.score + (b.themes?.length || 0) * 2) - (a.score + (a.themes?.length || 0) * 2) || b.total - a.total || rotated.indexOf(a) - rotated.indexOf(b))[0];
    if (memorable) output.push({ ...memorable, label: 'Most memorable' });
    return output.slice(0, 3);
  }

  function detailParams(offer, currency) {
    const rate = FX[currency] || 1;
    return stateParams({
      city: offer.city,
      country: offer.country,
      code: offer.code,
      total: Math.round(offer.total * rate),
      flight: Math.round(offer.flight * rate),
      stay: Math.round(offer.stay * rate),
      remaining: Math.max(0, Math.round((Number(budgetInput.value) || 0) - offer.total * rate))
    });
  }

  function card(offer, index, currency) {
    const rate = FX[currency] || 1;
    const total = offer.total * rate;
    const params = offer.hrefParams || detailParams(offer, currency);
    const href = offer.href || `${offer.isRoute ? 'multicity-visualizer.html' : 'trip.html'}?${params.toString()}`;
    const fallbackImage = offer.img || generatedCityImage(offer.city, offer.country);
    const image = `<img src="${esc(fallbackImage)}" alt="${esc(offer.city)}, ${esc(offer.country)}" loading="${index === 0 ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${index === 0 ? 'high' : 'low'}">`;
    const type = offer.type || (offer.isRoute ? 'Multi-city tour' : 'Single destination');
    const title = offer.isRoute ? offer.city : `${offer.city}, ${offer.country}`;
    const subtitle = offer.subtitle || `${offer.nights} nights · From ${esc(selectedOrigin()?.city || 'your city')}`;
    const aria = offer.isRoute ? `Open generated tour from ${esc(selectedOrigin()?.city || 'your city')}` : `View trip details for ${esc(offer.city)}, ${esc(offer.country)}`;
    return `<article class="gv-home-idea-card${offer.isRoute ? ' gv-home-idea-card--route' : ''}" data-idea-id="${esc(offer.id)}">
      <a class="gv-home-idea-hitarea" href="${esc(href)}" data-home-offer="${esc(offer.id)}" aria-label="${aria}"></a>
      <div class="gv-home-idea-photo" data-city="${esc(offer.city)}" data-country="${esc(offer.country)}" data-fallback="${esc(fallbackImage)}">${image}<span class="gv-home-idea-label">${esc(offer.label)}</span></div>
      <div class="gv-home-idea-body"><p class="gv-home-idea-type${offer.isRoute ? ' gv-home-idea-type--route' : ''}">${esc(type)}</p><h3>${esc(title)}</h3><p>${esc(subtitle)}</p><div class="gv-home-idea-cost"><span>${offer.isRoute ? 'Estimated route' : 'Estimated trip'}</span><strong>${fmt(total, currency)}</strong></div><span class="gv-home-idea-cta" aria-hidden="true">${offer.isRoute ? 'Open generated tour →' : 'View trip details →'}</span></div>
    </article>`;
  }

  function cacheKey(origin, currency) {
    const raw = [
      origin.code,
      currency,
      Math.round(Number(budgetInput.value) || 0),
      readAdults(),
      readChildren(),
      nights(),
      preferredMonth?.value || '',
      q('#gv-hotel-style')?.value || '',
      interestInput?.value || '',
      regionInput?.value || ''
    ].join('|').toLowerCase();
    return IDEAS_CACHE_PREFIX + raw.replace(/[^a-z0-9|._-]+/g, '-');
  }

  function cacheSafeOffer(offer) {
    return {
      id: offer.id,
      city: offer.city,
      country: offer.country,
      code: offer.code,
      flight: offer.flight,
      stay: offer.stay,
      total: offer.total,
      nights: offer.nights,
      img: offer.img || '',
      score: offer.score || 0,
      themes: Array.isArray(offer.themes) ? offer.themes.slice(0, 8) : [],
      label: offer.label || ''
    };
  }

  function readIdeasCache(origin, currency) {
    const cached = safeJson(localStorage, cacheKey(origin, currency), null);
    if (!cached || !Array.isArray(cached.items) || !cached.items.length) return null;
    if (Date.now() - Number(cached.savedAt || 0) > IDEAS_CACHE_TTL) return null;
    return cached;
  }

  function saveIdeasCache(origin, currency, items) {
    safeSet(localStorage, cacheKey(origin, currency), {
      savedAt: Date.now(),
      currency,
      items: items.map(cacheSafeOffer)
    });
  }

  async function hydratePhoto(cardElement, offer) {
    const holder = cardElement.querySelector('.gv-home-idea-photo');
    if (!holder || !window.GlobevoyCityImages) return;
    try {
      const data = await window.GlobevoyCityImages.get(offer.city, offer.country, offer.img || '');
      const url = data && data.images && data.images[0];
      if (!url) return;
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        holder.querySelector('img,.gv-home-idea-placeholder')?.remove();
        image.alt = `${offer.city}, ${offer.country}`;
        holder.prepend(image);
      };
      image.src = url;
    } catch (_) {
      // Keep the lightweight city-name fallback.
    }
  }

  function wireCards(items) {
    ideasGrid.querySelectorAll('[data-home-offer]').forEach((link) => link.addEventListener('click', () => {
      const offer = items.find((item) => item.id === link.dataset.homeOffer);
      if (!offer) return;
      const image = link.closest('.gv-home-idea-card')?.querySelector('img')?.currentSrc || offer.img || '';
      try {
        sessionStorage.setItem('gv-selected-offer', JSON.stringify({
          ...offer,
          selectedImage: image,
          usable: Number(budgetInput.value) || 0,
          reserve: 0,
          remaining: Math.max(0, (Number(budgetInput.value) || 0) - offer.total * (FX[currencyFor(selectedOrigin())] || 1))
        }));
      } catch (_) {}
    }));
    ideasGrid.querySelectorAll('.gv-home-idea-card').forEach((element, index) => hydratePhoto(element, items[index]));
  }

  function hasVisibleCards() {
    return !ideasGrid.hidden && Boolean(ideasGrid.querySelector('.gv-home-idea-card'));
  }

  function reconcileIdeasState() {
    const hasCards = hasVisibleCards();
    ideasSection?.classList.toggle('has-cards', hasCards);
    if (hasCards) {
      ideasState.hidden = true;
      ideasState.setAttribute('aria-hidden', 'true');
      ideasState.classList.remove('is-error');
    }
    return hasCards;
  }

  function showState(message, error, options) {
    const settings = Object.assign({ force: false, clearCards: true }, options || {});
    if (!settings.force && reconcileIdeasState()) {
      // A quiet refresh must never place a loading panel above already-visible cards.
      if (message && /checking|refresh/i.test(message)) {
        ideasCopy.textContent = 'Recent trip ideas shown. Refreshing quietly with current recommendations.';
      }
      return;
    }
    if (settings.clearCards) {
      ideasGrid.hidden = true;
      ideasGrid.setAttribute('aria-hidden', 'true');
      ideasGrid.innerHTML = '';
      ideasGrid.removeAttribute('data-origin-code');
      ideasSection?.classList.remove('has-cards');
      if (shuffleButton) shuffleButton.hidden = true;
    }
    ideasState.hidden = false;
    ideasState.removeAttribute('aria-hidden');
    ideasState.classList.toggle('is-error', Boolean(error));
    ideasState.textContent = message;
  }


  function hideUnavailableIdeas(message) {
    ideasGrid.hidden = true;
    ideasGrid.setAttribute('aria-hidden', 'true');
    ideasGrid.innerHTML = '';
    ideasGrid.removeAttribute('data-origin-code');
    ideasState.hidden = true;
    ideasState.setAttribute('aria-hidden', 'true');
    ideasState.classList.remove('is-error');
    ideasState.textContent = '';
    if (message) ideasCopy.textContent = message;
    ideasSection?.classList.remove('has-cards');
    if (shuffleButton) shuffleButton.hidden = true;
  }

  function installHomeIdeaPhoto(photo, url, city, country, loading) {
    if (!photo || !url) return;
    const img = new Image();
    img.alt = `${city || 'Destination'}, ${country || ''}`;
    img.loading = loading || 'lazy';
    img.decoding = 'async';
    img.src = url;
    const apply = () => {
      const existing = photo.querySelector('img');
      if (existing) existing.replaceWith(img);
      else photo.prepend(img);
      photo.classList.add('has-photo');
    };
    if (String(url).startsWith('data:image/svg+xml') || String(url).startsWith('./assets/') || String(url).startsWith('/assets/')) {
      apply();
      return;
    }
    img.onload = apply;
    img.onerror = () => {
      const generated = generatedCityImage(city, country);
      if (generated && generated !== url) installHomeIdeaPhoto(photo, generated, city, country, 'eager');
    };
  }

  function hydrateHomeIdeaPhotos() {
    Array.from(document.querySelectorAll('.gv-home-idea-photo[data-city]')).forEach(async (photo, index) => {
      const city = photo.dataset.city || '';
      const country = photo.dataset.country || '';
      const fallback = photo.dataset.fallback || '';
      const generated = generatedCityImage(city, country);
      try {
        if (window.GlobevoyCityImages) {
          const res = await window.GlobevoyCityImages.get(city, country, fallback || generated);
          const url = res && Array.isArray(res.images) && res.images[0] ? res.images[0] : fallback || generated;
          installHomeIdeaPhoto(photo, url, city, country, index === 0 ? 'eager' : 'lazy');
          return;
        }
      } catch (_) {
        // Keep the safe fallback already rendered.
      }
      installHomeIdeaPhoto(photo, fallback || generated, city, country, index === 0 ? 'eager' : 'lazy');
    });
  }

  function renderIdeas(items, currency, copy, originCode, options) {
    const settings = Object.assign({ rememberPool: true, pool: null }, options || {});
    if (settings.rememberPool) {
      lastIdeaPool = Array.isArray(settings.pool) && settings.pool.length ? settings.pool.slice() : items.slice();
      lastIdeaCurrency = currency;
      lastIdeaOriginCode = String(originCode || selectedOrigin()?.code || '');
    }
    ideasGrid.innerHTML = items.map((item, index) => card(item, index, currency)).join('');
    ideasGrid.dataset.originCode = String(originCode || selectedOrigin()?.code || '');
    ideasGrid.hidden = false;
    ideasGrid.removeAttribute('aria-hidden');
    if (shuffleButton) shuffleButton.hidden = false;
    if (copy) ideasCopy.textContent = copy;
    reconcileIdeasState();
    wireCards(items);
    hydrateHomeIdeaPhotos();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function requestRecommendations(origin, amount, currency, rate) {
    const params = {
      origin: origin.code,
      budgetUsd: amount / rate,
      nights: nights(),
      month: preferredMonth?.value || '',
      style: q('#gv-hotel-style')?.value || 'Best balance',
      hotelStyle: q('#gv-hotel-style')?.value || 'Best balance',
      interests: interestInput?.value || '',
      region: (regionInput?.value || 'Anywhere') === 'Anywhere' ? '' : regionInput.value,
      currency,
      nearMissUsd: 50 / rate,
      limit: 18
    };
    try {
      return await Api.getRecommendations(params);
    } catch (firstError) {
      await sleep(350);
      try {
        return await Api.getRecommendations(params);
      } catch (secondError) {
        secondError.cause = firstError;
        throw secondError;
      }
    }
  }


  function generatedTourParams(origin, amount, currency) {
    return {
      mode: 'generated-tour',
      recommendationScope: 'generated-multicity-tour',
      origin: origin && Origins.label ? Origins.label(origin) : originInput.value,
      budget: String(Math.round(amount || 1000)),
      currency,
      passengers: String(readPassengers()),
      adults: String(readAdults()),
      children: String(readChildren()),
      nights: String(nights()),
      tripLength: tripLength ? tripLength.value : 'auto',
      dateMode: 'flexible',
      flexible: 'true',
      preferredMonth: preferredMonth ? preferredMonth.value : '',
      month: preferredMonth ? preferredMonth.value : '',
      interests: interestInput ? interestInput.value : 'No preference',
      hotelStyle: q('#gv-hotel-style')?.value || 'Best balance',
      region: (regionInput && regionInput.value || 'Anywhere') === 'Anywhere' ? 'All continents' : regionInput.value,
      variant: String(ideaVariant)
    };
  }

  function visualizerHrefFromParams(params) {
    const qp = new URLSearchParams(params);
    qp.set('generated', 'true');
    qp.set('returnTo', 'index.html');
    return `multicity-visualizer.html?${qp.toString()}`;
  }

  function legUsdForCity(tour, city) {
    const cityName = String(city?.city || '').toLowerCase();
    const leg = (Array.isArray(tour.backendLegs) ? tour.backendLegs : Array.isArray(tour.legs) ? tour.legs : [])
      .find((item) => String(item?.to?.city || '').toLowerCase() === cityName);
    return Number(leg?.estimatedTransportUsd || leg?.estimatedFlightUsd || leg?.amountUsd || 0);
  }

  function stayUsdForCity(tour, city) {
    const cityName = String(city?.city || '').toLowerCase();
    const stay = (Array.isArray(tour.stays) ? tour.stays : [])
      .find((item) => String(item?.city || '').toLowerCase() === cityName);
    return Number(stay?.hotel?.estimatedStayUsd || city?.hotel?.estimatedStayUsd || 0);
  }

  function fallbackIdeasFromTour(payload, params, currency) {
    const tour = payload?.tour || (Array.isArray(payload?.tours) ? payload.tours[0] : null);
    if (!tour) return [];
    const sourceCities = Array.isArray(tour.cities) ? tour.cities : [];
    const routeHref = visualizerHrefFromParams(params);
    const routeEstimate = Number(tour?.budget?.estimatedCoreTotal?.amount || tour?.displayBudget?.tripEstimate || 0);
    const rate = FX[currency] || 1;
    const items = sourceCities.slice(0, 4).map((city, index) => {
      const usdTotal = Math.max(1, legUsdForCity(tour, city) + stayUsdForCity(tour, city));
      return {
        id: `tour-stop-${city.id || city.city || index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        city: city.city || 'Destination',
        country: city.country || '',
        code: city.code || city.airportCode || '',
        flight: legUsdForCity(tour, city),
        stay: stayUsdForCity(tour, city),
        total: usdTotal,
        nights: Number(city.nights || tour.totalNights || nights()),
        img: city.img || city.image || generatedCityImage(city.city, city.country),
        score: 85 - index * 4,
        themes: ['generated-tour'],
        label: index === 0 ? 'Best balance' : index === 1 ? 'Connected stop' : 'Route idea',
        type: 'Generated tour stop',
        subtitle: `${Number(city.nights || 1)} night${Number(city.nights || 1) === 1 ? '' : 's'} · Part of generated route`,
        href: routeHref
      };
    });
    if (items.length < 3) {
      const routeTitle = sourceCities.map((item) => item.city).filter(Boolean).join(' + ') || tour.title || 'Generated tour';
      items.push({
        id: `generated-route-${String(tour.routeId || tour.tourId || routeTitle).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        city: routeTitle,
        country: 'Generated route',
        code: '',
        flight: 0,
        stay: 0,
        total: routeEstimate ? routeEstimate / rate : Math.max(1, items.reduce((sum, item) => sum + item.total, 0)),
        nights: Number(tour.totalNights || nights()),
        img: generatedCityImage(routeTitle, selectedOrigin()?.city || ''),
        score: 90,
        themes: ['generated-route'],
        label: 'Full route',
        type: 'Multi-city tour',
        subtitle: `${Number(tour.totalNights || nights())} nights · Open the full generated tour`,
        isRoute: true,
        href: routeHref
      });
    }
    return rotateList(items).slice(0, 3);
  }

  async function requestGeneratedTourIdeas(origin, amount, currency) {
    if (!Api.isConfigured?.() || !Api.getGeneratedTour) return [];
    const params = generatedTourParams(origin, amount, currency);
    const payload = await Api.getGeneratedTour(params);
    return fallbackIdeasFromTour(payload, params, currency);
  }

  async function loadIdeas() {
    const serial = ++loadSerial;
    const origin = selectedOrigin();
    const amount = Number(budgetInput.value) || 0;

    if (!origin) {
      ideasTitle.textContent = 'Finding trip ideas near you…';
      ideasCopy.textContent = 'Allow location once, or enter a city manually.';
      showState('Waiting for a starting city. Globevoy will update this section automatically.', false, { force: true });
      return;
    }

    ideasTitle.textContent = `Trip ideas from ${origin.city}`;
    ideasCopy.textContent = 'Current trip ideas based on your origin, budget and group size.';

    if (amount < 300) {
      showState('Enter a total trip budget of at least 300 to preview ideas.', false, { force: true });
      return;
    }

    const currency = currencyFor(origin);
    const rate = FX[currency] || 1;
    const cached = readIdeasCache(origin, currency);
    if (cached) {
      renderIdeas(cached.items, currency, 'Recent trip ideas loaded instantly. Refreshing quietly with current recommendations.', origin.code);
    } else {
      const sameOriginCards = hasVisibleCards() && ideasGrid.dataset.originCode === String(origin.code || '');
      if (sameOriginCards) {
        ideasCopy.textContent = 'Recent trip ideas shown. Refreshing quietly with current recommendations.';
        reconcileIdeasState();
      } else {
        showState('Checking current budget-aware ideas…', false, { force: true });
      }
    }

    try {
      if (!Api.isConfigured?.()) throw new Error('Live recommendations are not configured.');
      const payload = await requestRecommendations(origin, amount, currency, rate);
      if (serial !== loadSerial) return;
      const normalized = (payload.recommendations || []).map(normalize).filter(Boolean);
      const chosen = choose(normalized);
      if (!chosen.length) {
        const generated = await requestGeneratedTourIdeas(origin, amount, currency);
        if (serial !== loadSerial) return;
        if (generated.length) {
          renderIdeas(generated, currency, 'Generated route preview shown because standard homepage ideas are still expanding for this origin.', origin.code);
          return;
        }
        if (!cached && !hasVisibleCards()) hideUnavailableIdeas('Submit the search to generate a full tour from this starting city.');
        else ideasCopy.textContent = 'Recent trip ideas shown. Current recommendations did not return a new match.';
        return;
      }
      saveIdeasCache(origin, currency, chosen);
      renderIdeas(chosen, currency, 'Current trip ideas based on your origin, budget and group size.', origin.code, { pool: normalized });
    } catch (error) {
      if (serial !== loadSerial) return;
      console.warn('Homepage trip ideas request failed', error);
      try {
        const generated = await requestGeneratedTourIdeas(origin, amount, currency);
        if (serial !== loadSerial) return;
        if (generated.length) {
          renderIdeas(generated, currency, 'Generated route preview shown because standard homepage ideas are still expanding for this origin.', origin.code);
          return;
        }
      } catch (fallbackError) {
        console.warn('Homepage generated-tour fallback failed', fallbackError);
      }
      if (cached) {
        ideasCopy.textContent = 'Recent trip ideas shown. Live refresh is temporarily unavailable.';
      } else {
        if (!hasVisibleCards()) hideUnavailableIdeas('Submit the search to generate a full tour from this starting city.');
      }
    }
  }

  function scheduleIdeas(delay = 450) {
    clearTimeout(timer);
    timer = window.setTimeout(loadIdeas, delay);
  }

  function syncManualOriginStatus() {
    const origin = selectedOrigin();
    if (!origin) {
      if (originInput.value.trim()) setLocationStatus('Choose a city or airport from the suggestions.', true);
      return;
    }
    rememberOrigin(origin);
    setLocationStatus(`Using ${Origins.label ? Origins.label(origin) : originInput.value} as your starting city.`, false);
  }


  function relabelPicked(items) {
    const labels = ['Lowest cost', 'Best balance', 'Most memorable'];
    const picked = items.slice(0, 3).map((item, index) => ({ ...item, label: labels[index] || 'Trip idea' }));
    if (picked.length > 1) {
      const cheapestIndex = picked.reduce((best, item, index) => Number(item.total || Infinity) < Number(picked[best].total || Infinity) ? index : best, 0);
      const cheapest = picked[cheapestIndex];
      picked[cheapestIndex] = { ...picked[0], label: picked[cheapestIndex].label };
      picked[0] = { ...cheapest, label: 'Lowest cost' };
      if (picked[1]) picked[1].label = 'Best balance';
      if (picked[2]) picked[2].label = 'Most memorable';
    }
    return picked;
  }

  function offerId(item) {
    return String(item && (item.id || item.cityId || item.code || item.city) || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function currentVisibleIdeaIds() {
    return new Set(Array.from(document.querySelectorAll('.gv-home-idea-card[data-idea-id]')).map((el) => String(el.dataset.ideaId || '').toLowerCase()).filter(Boolean));
  }

  function budgetFallbackPool() {
    const origin = selectedOrigin();
    const currency = currencyFor(origin);
    const rate = FX[currency] || 1;
    const budgetUsd = Math.max(1, (Number(budgetInput.value) || 1000) / rate);
    const targetNights = nights();
    const originCity = String(origin?.city || '').toLowerCase();
    const originCode = String(origin?.code || '').toUpperCase();
    return pool
      .filter((item) => item && item.recommendationEligible !== false)
      .filter((item) => String(item.city || '').toLowerCase() !== originCity && String(item.code || '').toUpperCase() !== originCode)
      .map((item, index) => {
        const cost = item.costs || {};
        const flight = Number(cost.flightDemandUsd || cost.flightUsd || cost.transportValueUsd || item.flight || item.flightUsd || 120);
        const stay = Number(cost.nightlyStayUsd || item.nightlyStayUsd || 90) * Math.max(2, targetNights);
        const total = Math.max(1, Math.round(flight + stay));
        return {
          ...item,
          id: offerId(item) || `fallback-${index}`,
          city: item.city || 'Destination',
          country: item.country || '',
          code: item.code || '',
          flight,
          stay,
          total,
          nights: Number(item.nights || targetNights),
          img: item.img || item.image || generatedCityImage(item.city, item.country),
          score: Number(item.score || item.destinationScore || item.anchorStrength || item.hiddenGemStrength || 50),
          themes: item.themes || item.styleTags || []
        };
      })
      .filter((item) => item.total <= budgetUsd * 1.12)
      .sort((a, b) => {
        const seed = ideaVariant * 97;
        const ah = Math.abs(hashHue(a.city + seed, a.country));
        const bh = Math.abs(hashHue(b.city + seed, b.country));
        return ah - bh || a.total - b.total;
      });
  }

  function shuffleFromPool(pool) {
    const unique = [];
    const seen = new Set();
    const add = (item) => {
      const key = offerId(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push({ ...item, id: key });
    };
    (Array.isArray(pool) ? pool : []).forEach(add);
    if (unique.length < 9) budgetFallbackPool().forEach(add);
    if (!unique.length) return [];

    const current = currentVisibleIdeaIds();
    const start = Math.abs(ideaVariant * 3) % unique.length;
    const rotated = unique.slice(start).concat(unique.slice(0, start));
    let picked = rotated.filter((item) => !current.has(String(item.id || '').toLowerCase())).slice(0, 3);
    if (picked.length < 3) {
      rotated.forEach((item) => {
        if (picked.length >= 3) return;
        if (!picked.some((chosen) => String(chosen.id) === String(item.id))) picked.push(item);
      });
    }
    return relabelPicked(picked);
  }

  function reshuffleIdeas() {
    ideaVariant += 1;
    if (lastIdeaPool.length >= 3 && lastIdeaOriginCode === String(selectedOrigin()?.code || '')) {
      const picked = shuffleFromPool(lastIdeaPool);
      if (picked.length) {
        renderIdeas(picked, lastIdeaCurrency, 'Trip ideas reshuffled within your current budget.', lastIdeaOriginCode, { rememberPool: false, pool: lastIdeaPool });
        return;
      }
    }
    if (shuffleButton) shuffleButton.disabled = true;
    ideasCopy.textContent = 'Refreshing ideas with a new route variant…';
    try {
      const origin = selectedOrigin();
      if (origin) localStorage.removeItem(cacheKey(origin, currencyFor(origin)));
    } catch (_) {}
    scheduleIdeas(0);
    window.setTimeout(() => { if (shuffleButton) shuffleButton.disabled = false; }, 1200);
  }

  locationButton?.addEventListener('click', useLocation);
  shuffleButton?.addEventListener('click', reshuffleIdeas);
  originInput.addEventListener('change', () => { syncManualOriginStatus(); scheduleIdeas(0); });
  originInput.addEventListener('input', () => {
    const origin = selectedOrigin();
    if (origin) syncManualOriginStatus();
    scheduleIdeas(500);
  });
  budgetInput.addEventListener('input', () => scheduleIdeas(500));
  budgetInput.addEventListener('change', () => scheduleIdeas(0));
  document.querySelectorAll('[data-counter]').forEach((button) => button.addEventListener('click', () => scheduleIdeas(80)));
  [tripLength, preferredMonth, interestInput, regionInput].filter(Boolean).forEach((element) => element.addEventListener('change', () => scheduleIdeas(80)));

  new MutationObserver(reconcileIdeasState).observe(ideasGrid, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  reconcileIdeasState();
  autoLocate();
})();
