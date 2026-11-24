(function () {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const query = new URLSearchParams(location.search);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = () => Boolean(navigator.connection?.saveData);
  const media = {
    LIS: 'lisbon', SVQ: 'seville', RAK: 'marrakech', PRG: 'prague',
    VIE: 'vienna', BUD: 'budapest', TYO: 'tokyo', HND: 'tokyo', NRT: 'tokyo',
    SEL: 'seoul', ICN: 'seoul', TPE: 'taipei',
  };
  const photos = {
    NYC: 'new-york-city.jpg', JFK: 'new-york-city.jpg', LGA: 'new-york-city.jpg',
    FLL: 'fort-lauderdale.jpg', YYZ: 'toronto.jpg',
  };
  const fallbackImage = './assets/fresh-b/v4/takeoff.jpg';
  const homeQuery = new URLSearchParams();
  for (const key of ['origin', 'budget', 'currency', 'adults', 'preferredMonth', 'travelPace']) {
    if (query.has(key)) homeQuery.set(key, query.get(key));
  }
  const back = 'index.html' + (homeQuery.size ? '?' + homeQuery : '');
  document.querySelectorAll('[data-cinematic-back]').forEach(link => { link.href = back; });
  $('#mcv-error-back').href = back;
  const signin = $('[data-cinematic-signin]');
  const auth = window.GlobevoyAuth705B;
  if (auth?.getSession?.()) signin.hidden = true;
  signin.addEventListener('click', () => {
    if (auth?.authEnabled?.()) void auth.beginSignIn({ returnTo: location.pathname + location.search });
    else location.assign('sign-in.html');
  });

  function money(amount, currency) {
    if (amount == null || amount === '' || !Number.isFinite(Number(amount))) return '—';
    try {
      return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
    } catch {
      return '—';
    }
  }

  const currency = query.get('currency') || 'CAD';
  const enteredBudget = money(query.get('budget'), currency);
  $('#loading-query').textContent = [query.get('origin'), enteredBudget === '—' ? '' : enteredBudget + ' ' + currency].filter(Boolean).join(' · ');
  if (query.get('saved') === 'true') {
    $('#loading-title').textContent = 'Opening your saved trip';
    $('#loading-message').textContent = 'Loading your itinerary.';
  }
  const waiting = setTimeout(() => {
    if (!$('#mcv-loading').hidden) $('#loading-message').textContent = 'This is taking a little longer. We’re still working on your trip.';
  }, 20000);
  const loader = new MutationObserver(() => {
    if ($('#mcv-loading').hidden) {
      clearTimeout(waiting);
      loader.disconnect();
    }
  });
  loader.observe($('#mcv-loading'), { attributes: true, attributeFilter: ['hidden'] });

  function cityMedia(city) {
    const codes = [city?.airportCode, city?.code];
    const scene = codes.map(code => media[code]).find(Boolean);
    const photo = codes.map(code => photos[code]).find(Boolean) || (city?.city === 'New York' ? photos.NYC : '');
    if (scene) return { photo: './assets/fresh-b/v4/' + scene + '.jpg', film: scene === 'marrakech' ? '' : './assets/fresh-b/v4/' + scene + '.mp4' };
    return photo ? { photo: './assets/images/' + photo } : {};
  }

  const film = $('#cinematic-film');
  const player = $('#cinematic-media');
  const cover = $('#cinematic-cover');
  let filmSource = '';
  function stopFilm() {
    film.pause();
    film.hidden = true;
    cover.hidden = false;
    player.textContent = 'Play video';
  }
  function setCover(city) {
    const asset = cityMedia(city);
    stopFilm();
    film.removeAttribute('src');
    film.load();
    cover.src = asset.photo || fallbackImage;
    cover.alt = asset.photo ? city.city : '';
    filmSource = asset.film;
    player.hidden = !filmSource || saveData() || reducedMotion.matches;
  }
  player.addEventListener('click', async () => {
    if (!film.hidden) {
      stopFilm();
      return;
    }
    if (!filmSource || reducedMotion.matches || saveData()) return;
    const source = filmSource;
    try {
      film.src = source;
      await film.play();
      if (source !== filmSource || document.hidden || reducedMotion.matches) return;
      film.hidden = false;
      cover.hidden = true;
      player.textContent = 'Pause video';
    } catch {
      stopFilm();
      player.hidden = true;
    }
  });
  film.addEventListener('error', stopFilm);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopFilm(); });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) stopFilm();
    player.hidden = !filmSource || reducedMotion.matches || saveData();
  });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function renderDestinations(tour) {
    const grid = $('#cinematic-destinations');
    grid.replaceChildren();
    for (const [index, city] of (tour.cities || []).entries()) {
      const stay = tour.stays?.[index] || city;
      const nights = Number(stay.nights || city.nights);
      const card = element('article', 'destination');
      card.dataset.stop = index;
      const image = element('div', 'image-wrap cinematic-destination-image');
      const asset = cityMedia(city);
      if (asset.photo) {
        const img = element('img');
        img.src = asset.photo;
        img.alt = '';
        img.loading = 'lazy';
        image.append(img);
      } else {
        image.append(element('span', 'cinematic-city-placeholder', city.city));
      }
      if (nights > 0) image.append(element('span', 'stay-chip', nights + (nights === 1 ? ' night' : ' nights')));
      const head = element('div', 'destination-head');
      const name = element('button', 'city-select', city.city);
      name.type = 'button';
      name.addEventListener('click', () => {
        selectStep(index + 1);
      });
      head.append(name, element('span', 'small muted', city.country));
      const hotel = stay.hotel || city.hotel;
      const details = element('button', 'textbtn', 'Stay & travel details ↗');
      details.type = 'button';
      details.addEventListener('click', () => {
        const itinerary = $('#cinematic-itinerary');
        itinerary.open = true;
        const card = $('#mcv-cards').children[index];
        card?.scrollIntoView({ block: 'nearest', inline: 'center' });
        itinerary.querySelector('summary').focus();
      });
      card.append(image, head);
      if (hotel?.name) card.append(element('p', 'small muted', hotel.name));
      card.append(details);
      grid.append(card);
    }
  }

  function markDestination(index) {
    document.querySelectorAll('#cinematic-destinations .destination').forEach(card => {
      const active = Number(card.dataset.stop) === index;
      card.classList.toggle('active', active);
      card.querySelector('.city-select').setAttribute('aria-pressed', String(active));
    });
  }

  function renderTrip(tour) {
    setCover(tour.cities?.[0]);
    const strip = $('#mcv-route-strip');
    strip.replaceChildren(...(tour.cities || []).map(city => element('span', '', city.city)));
    $('#mcv-title').textContent = (tour.cities || []).map(city => city.city).filter(Boolean).join(' + ') || 'Your journey';
    const dates = tour.itineraryDatePlan || {};
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
    const date = value => new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
    const start = dates.canonicalDepartureDate;
    const end = dates.canonicalReturnDate;
    $('#cinematic-dates').textContent = validDate(start) && validDate(end) && Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) ? date(start) + ' – ' + date(end) : 'Flexible dates';
    const info = tour.displayBudget || {};
    const code = info.currency || tour.budget?.total?.currency || currency;
    $('#cinematic-currency').textContent = code;
    const total = info.tripEstimate ?? tour.budget?.estimatedCoreTotal?.amount;
    const limit = info.totalBudget ?? tour.budget?.total?.amount;
    $('#cinematic-budget-fill').style.width = limit > 0 && Number.isFinite(Number(total)) ? Math.min(100, Math.max(0, total / limit * 100)) + '%' : '0%';
    const breakdown = $('#cinematic-costs');
    breakdown.replaceChildren();
    for (const [label, value] of [
      ['Flights', info.flightEstimate ?? tour.budget?.flightRange?.midpoint],
      ['Accommodation', info.accommodationEstimate ?? tour.budget?.accommodation?.amount],
      ['Intercity transport', info.intercityEstimate ?? tour.budget?.intercity?.amount],
    ]) {
      if (!(Number(value) > 0)) continue;
      const row = element('div', 'costrow');
      row.append(element('span', '', label), element('strong', '', money(value, code)));
      breakdown.append(row);
    }
    renderDestinations(tour);
  }


  let map;
  let layer;
  let fitCurrent = () => {};
  const mapBox = $('#mcv-map');
  $('#cinematic-fit').addEventListener('click', () => fitCurrent());
  const cinematicMap = {
    render(points) {
      if (!window.L || !points.length) {
        if (layer) layer.clearLayers();
        mapBox.classList.toggle('cinematic-map-empty', true);
        if (!map) mapBox.textContent = 'A map is unavailable for this itinerary.';
        fitCurrent = () => {};
        window.__gvJourneyMapFocus = null;
        return false;
      }
      mapBox.classList.remove('cinematic-map-empty');
      if (!map) mapBox.textContent = '';
      const origin = points[0].lng;
      const locations = points.map(point => [point.lat, origin + ((point.lng - origin + 540) % 360) - 180]);
      if (!map) {
        map = L.map(mapBox, { scrollWheelZoom: false, attributionControl: false });
        L.control.attribution({ prefix: false }).addAttribution('Natural Earth · public domain').addTo(map);
        void fetch('./assets/multicity/countries.json').then(response => {
          if (!response.ok) throw Error('Map outline is unavailable');
          return response.json();
        }).then(data => {
          L.geoJSON(data, { interactive: false, style: { color: '#839c90', weight: .6, fillColor: '#f2eee0', fillOpacity: 1 } }).addTo(map).bringToBack();
        }).catch(() => { mapBox.dataset.outlineUnavailable = 'true'; });
      }
      if (layer) layer.remove();
      layer = L.layerGroup().addTo(map);
      L.polyline(locations, { color: '#075a59', weight: 3, dashArray: '6 6' }).addTo(layer);
      const markers = [];
      for (const [index, point] of points.entries()) {
        if (point.returnPoint) continue;
        const marker = L.marker(locations[index], {
          alt: point.label, title: point.label,
          icon: L.divIcon({ className: 'city-marker', html: '<span>' + (point.origin ? 'O' : String(point.stop || index + 1)) + '</span>', iconSize: [32, 32], iconAnchor: [16, 16] }),
        }).addTo(layer);
        marker.bindTooltip(element('span', '', point.label), { permanent: true, direction: 'top', offset: [0, -15], className: 'city-tooltip' });
        marker.on('click', () => {
          stopPlayback();
          selectStep(point.origin ? 0 : point.stop);
        });
        markers[index] = marker;
      }
      fitCurrent = () => {
        map.invalidateSize();
        map.fitBounds(locations, { padding: [42, 54], maxZoom: 7, animate: false });
        markDestination(-1);
      };
      fitCurrent();
      window.__gvJourneyMapFocus = (index, { overview } = {}) => {
        for (const marker of markers) marker?.getElement()?.classList.remove('active');
        if (overview) return fitCurrent();
        const pointIndex = index === 0 ? points.findIndex(point => point.origin) :
          index === stepNames.length - 1 && points.at(-1).returnPoint ? points.length - 1 :
          points.findIndex(point => point.stop === index);
        const point = points[pointIndex];
        if (!point) return;
        const marker = markers[point.returnPoint ? 0 : pointIndex];
        marker?.getElement()?.classList.add('active');
        map.panTo(locations[pointIndex], { animate: !reducedMotion.matches });
        markDestination(point.stop == null ? -1 : point.stop - 1);
      };
      return true;
    },
  };

  const search = window.GlobevoyCinematicSearch;
  const routePicker = $('#mcv-picks');
  const play = $('#gv-journey-play');
  const itinerary = $('#cinematic-itinerary');
  let trips = [];
  let selected = 0;
  let step = -1;
  let stepNames = [];
  let timer = null;

  function stopPlayback() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    play.setAttribute('aria-pressed', 'false');
    play.textContent = reducedMotion.matches ? 'Next journey step' : '▶ Play your journey';
  }

  function selectStep(index) {
    if (!stepNames[index]) return;
    step = index;
    for (const [i, button] of [...$('#gv-journey-rail').querySelectorAll('button')].entries()) {
      button.classList.toggle('is-active', i === index);
      if (i === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    markDestination(index > 0 && index < stepNames.length - 1 ? index - 1 : -1);
    window.__gvJourneyMapFocus?.(index);
    $('#gv-journey-status').textContent = stepNames[index];
    $('#gv-journey-progress-bar').style.width = (100 * index / Math.max(1, stepNames.length - 1)) + '%';
  }

  function overview() {
    stopPlayback();
    step = -1;
    for (const button of $('#gv-journey-rail').querySelectorAll('button')) {
      button.classList.remove('is-active');
      button.removeAttribute('aria-current');
    }
    $('#gv-journey-status').textContent = 'Select a city to explore.';
    $('#gv-journey-progress-bar').style.width = '0%';
    markDestination(-1);
    window.__gvJourneyMapFocus?.(0, { overview: true });
  }

  play.addEventListener('click', () => {
    if (reducedMotion.matches) return selectStep((step + 1) % stepNames.length);
    if (timer !== null) return stopPlayback();
    selectStep(step < 0 || step === stepNames.length - 1 ? 0 : step);
    play.textContent = 'Pause journey';
    play.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => {
      selectStep(step + 1);
      if (step >= stepNames.length - 1) stopPlayback();
    }, 1500);
  });
  $('#gv-journey-overview').addEventListener('click', overview);
  reducedMotion.addEventListener('change', stopPlayback);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });

  function wiresForRoute(tour) {
    const origin = tour.origin || {};
    const stops = tour.cities || [];
    const originName = origin.city || query.get('origin') || 'Departure';
    const coordinates = (city, label, extra) => {
      const rawLat = city.lat ?? city.latitude;
      const rawLng = city.lng ?? city.longitude;
      const lat = Number(rawLat);
      const lng = Number(rawLng);
      return rawLat != null && rawLng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng, label, ...extra } : null;
    };
    const points = [
      coordinates(origin, originName, { origin: true }),
      ...stops.map((city, index) => coordinates(city, city.city, { stop: index + 1 })),
      coordinates(origin, originName, { returnPoint: true }),
    ].filter(Boolean);
    stepNames = [originName, ...stops.map(city => city.city), originName + ' · Return'];
    $('#gv-journey-rail').replaceChildren(...stepNames.map((name, index) => {
      const button = element('button', 'gv-journey-step', name);
      button.type = 'button';
      button.addEventListener('click', () => { stopPlayback(); selectStep(index); });
      return button;
    }));
    cinematicMap.render(points);
    overview();
  }

  function renderLegs(tour, code) {
    const cards = $('#mcv-cards');
    cards.replaceChildren();
    const legs = tour.backendLegs || tour.legs || [];
    for (const [index, leg] of legs.entries()) {
      const card = element('article', 'cinematic-leg');
      const from = leg.from?.city || leg.from?.code || 'Departure';
      const to = leg.to?.city || leg.to?.code || 'Destination';
      const departure = leg.departureDate || leg.providerDateEvidence?.departureDate;
      card.append(element('h3', '', from + ' → ' + to));
      if (departure) card.append(element('p', 'small muted', 'Departure · ' + departure));
      card.append(element('p', 'small', leg.liveFareVerified === true ? 'Flight price checked with provider' : 'Check current transport prices with providers'));
      const stay = tour.stays?.[index] || tour.stops?.[index];
      if (stay?.hotel?.name) {
        card.append(element('p', '', stay.hotel.name + (stay.nights ? ' · ' + stay.nights + ' nights' : '')));
        const amount = stay.hotel.canonicalPricing?.amountDisplay;
        const price = money(amount, code);
        card.append(element('p', 'small muted', (price === '—' ? '' : price + ' · ') + (stay.hotel.nuiteeLiveRate ? 'Hotel rate checked with provider' : 'Hotel rate may be estimated')));
      }
      cards.append(card);
    }
  }

  function choose(index) {
    selected = index;
    const tour = trips[index];
    if (!tour) return;
    window.__gvGeneratedTour = tour;
    search.remember(tour);
    $('#mcv-loading').hidden = true;
    $('#mcv-app').hidden = false;
    const info = tour.displayBudget || {};
    const code = info.currency || tour.budget?.total?.currency || currency;
    const nights = Number(tour.totalNights || 0);
    $('#mcv-route-role').textContent = tour.pickRoleLabel || tour.tourRoleLabel || 'Your journey';
    $('#mcv-summary-origin').textContent = tour.origin?.city || query.get('origin') || '';
    $('#mcv-summary-nights').textContent = nights || '—';
    const adults = Number(query.get('adults') || tour.passengerPricing?.travellers || 1);
    $('#mcv-summary-passengers').textContent = query.get('travellers') || adults + (adults === 1 ? ' traveller' : ' travellers');
    $('#mcv-circuit-copy').textContent = 'Dates and prices can change. Check current offers with booking partners.';
    $('#mcv-subtitle').textContent = tour.tripStory || (nights ? nights + ' nights · ' : '') + tour.cities.length + (tour.cities.length === 1 ? ' destination' : ' destinations');
    $('#mcv-total').textContent = money(info.tripEstimate ?? tour.budget?.estimatedCoreTotal?.amount, code);
    $('#mcv-summary-budget').textContent = money(info.totalBudget ?? tour.budget?.total?.amount, code);
    $('#mcv-save-trip').textContent = query.get('saved') === 'true' ? 'Saved ✓' : 'Save trip';
    $('#cinematic-status').textContent = '';
    itinerary.open = false;
    for (const [i, button] of [...routePicker.querySelectorAll('button')].entries()) {
      button.setAttribute('aria-selected', String(i === selected));
      button.tabIndex = i === selected ? 0 : -1;
    }
    renderTrip(tour);
    renderLegs(tour, code);
    wiresForRoute(tour);
    void window.GlobevoySavedTrips705C?.refreshPageSaveState?.();
  }

  function renderChoices() {
    routePicker.replaceChildren(...trips.map((tour, index) => {
      const button = element('button', 'route-choice');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'mcv-generated-hero');
      button.append(element('strong', '', tour.pickRoleLabel || tour.tourRoleLabel || 'Trip ' + (index + 1)));
      button.append(element('span', '', tour.cities.map(city => city.city).join(' → ')));
      button.addEventListener('click', () => choose(index));
      return button;
    }));
    $('#mcv-pick-count').textContent = trips.length + (trips.length === 1 ? ' option' : ' options');
    if (!search.isMember()) $('#mcv-picks-note').textContent = 'Sign in to see more options when available.';
    const preferred = trips.findIndex(tour => tour.pickRole === 'best-balance');
    choose(preferred < 0 ? 0 : preferred);
  }
  routePicker.addEventListener('keydown', event => {
    const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!offset && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? trips.length - 1 : (selected + offset + trips.length) % trips.length;
    choose(index);
    routePicker.querySelectorAll('button')[index]?.focus();
  });

  $('#mcv-adjust-trip').addEventListener('click', () => location.assign(back));
  $('#mcv-save-trip').addEventListener('click', () => {
    const params = search.save(trips[selected]);
    if (!params) {
      $('#cinematic-status').textContent = 'This browser could not save the trip.';
      return;
    }
    history.replaceState(null, '', location.pathname + '?' + params);
    if (!search.isMember()) {
      $('#mcv-save-trip').textContent = 'Saved ✓';
      $('#cinematic-status').textContent = 'Trip saved in this browser.';
    }
  });
  $('#mcv-flight-options').addEventListener('click', () => {
    const params = search.save(trips[selected]);
    if (params) location.assign('multi-city-trip.html?' + params);
    else $('#cinematic-status').textContent = 'This browser could not open trip details.';
  });

  function showError(error) {
    $('#mcv-loading').hidden = true;
    $('#mcv-app').hidden = true;
    $('#mcv-error').hidden = false;
    const details = error.noTrip;
    $('#mcv-error h1').textContent = details?.title || (details ? 'No trip found for these choices' : 'We couldn’t load your trip');
    $('#mcv-error-copy').textContent = details?.message || (details ? 'Try a different month or budget.' : 'Try your search again in a moment.');
    if (Number(details?.suggestedBudget) > 0) {
      const retry = new URLSearchParams(query);
      retry.set('budget', details.suggestedBudget);
      retry.delete('variant');
      $('#mcv-error-back').href = '?' + retry;
      $('#mcv-error-back').textContent = 'Search with ' + money(details.suggestedBudget, details.currency || currency);
    }
  }

  search.fetchTrips().then(options => {
    trips = options;
    renderChoices();
  }).catch(showError);
})();
