(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlobevoyJourneyExperience686B = api;
  if (root && root.document) api.start();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = 'GV-JOURNEY-686B';
  const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const text = (value, fallback = '') => String(value == null ? fallback : value).trim();
  const cityName = (value, fallback = 'Destination') => text(value?.city || value?.name, fallback);
  const legsOf = (tour) => Array.isArray(tour?.backendLegs) ? tour.backendLegs : (Array.isArray(tour?.legs) ? tour.legs : []);
  const staysOf = (tour) => Array.isArray(tour?.stays) ? tour.stays : [];
  const citiesOf = (tour) => Array.isArray(tour?.cities) ? tour.cities : [];

  function transportKind(leg) {
    const raw = [leg?.transportMode, leg?.mode, leg?.type, leg?.legType, leg?.travelMode, leg?.operator].filter(Boolean).join(' ').toLowerCase();
    if (/train|rail/.test(raw)) return { type: 'rail', label: 'Train', icon: '↔' };
    if (/bus|coach/.test(raw)) return { type: 'ground', label: 'Coach transfer', icon: '↔' };
    if (/drive|car|ground|transfer|shuttle|ferry/.test(raw)) return { type: 'ground', label: 'Ground transfer', icon: '↔' };
    return { type: 'flight', label: 'Flight', icon: '✈' };
  }

  function nightsFor(city, stay) {
    return Math.max(0, Math.round(safeNumber(stay?.nights || stay?.hotel?.nights || city?.nights)));
  }

  function evidenceLabel(tour) {
    const evidence = tour?.liveProviderVerification || tour?.priceProvenance?.liveProviderVerification || {};
    const verified = Math.max(0, Math.round(safeNumber(evidence.verifiedCount)));
    const critical = Math.max(0, Math.round(safeNumber(evidence.criticalCount)));
    if (critical > 0) return `${verified} of ${critical} prices checked`;
    return 'Verify with partners';
  }

  function buildJourneyModel(tour) {
    const origin = cityName(tour?.origin, 'Origin');
    const cities = citiesOf(tour);
    const stays = staysOf(tour);
    const legs = legsOf(tour);
    let elapsedNights = 0;
    const steps = [{
      index: 0,
      kind: 'origin',
      city: origin,
      shortMeta: 'Starting point',
      status: `Your journey begins in ${origin}.`,
      days: 'Departure',
      transport: null
    }];
    cities.forEach((city, index) => {
      const nights = nightsFor(city, stays[index]);
      const startDay = elapsedNights + 1;
      const endDay = Math.max(startDay, elapsedNights + Math.max(1, nights));
      const transport = transportKind(legs[index]);
      const place = cityName(city, `Stop ${index + 1}`);
      steps.push({
        index: steps.length,
        kind: 'stop',
        city: place,
        shortMeta: nights ? `${nights} night${nights === 1 ? '' : 's'} · ${transport.label}` : transport.label,
        status: `Stop ${index + 1} of ${cities.length}: ${place}${nights ? ` for ${nights} night${nights === 1 ? '' : 's'}` : ''}.`,
        days: nights ? `Days ${startDay}–${endDay}` : `Stop ${index + 1}`,
        nights,
        transport,
        from: index === 0 ? origin : cityName(cities[index - 1])
      });
      elapsedNights += nights;
    });
    const returnTransport = transportKind(legs[Math.max(0, cities.length)]);
    steps.push({
      index: steps.length,
      kind: 'return',
      city: origin,
      shortMeta: `Return · ${returnTransport.label}`,
      status: `Returning to ${origin}. Your complete route is now visible.`,
      days: 'Return',
      transport: returnTransport,
      from: cityName(cities[cities.length - 1], origin)
    });
    return {
      version: VERSION,
      origin,
      steps,
      route: steps.map((step) => step.city).join(' → '),
      evidence: evidenceLabel(tour)
    };
  }

  function railHtml(model) {
    return model.steps.map((step, index) => {
      const dot = step.kind === 'origin' ? 'O' : step.kind === 'return' ? '↩' : String(index);
      const button = `<button class="gv-journey-step" type="button" role="listitem" data-journey-step="${index}" aria-label="${step.city}: ${step.shortMeta}"><span class="gv-journey-step__dot">${dot}</span><span class="gv-journey-step__copy"><strong>${step.city}</strong><span>${step.shortMeta}</span></span></button>`;
      return index < model.steps.length - 1 ? button + `<span class="gv-journey-connector" data-journey-connector="${index}" aria-hidden="true"></span>` : button;
    }).join('');
  }

  function createController(windowObject, documentObject) {
    const state = { model: null, activeIndex: -1, playing: false, timer: 0, renderKey: '' };
    const reducedMotion = () => Boolean(windowObject.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const $ = (selector) => documentObject.querySelector(selector);
    const $$ = (selector) => Array.from(documentObject.querySelectorAll(selector));

    function stopPlayback(label) {
      if (state.timer) windowObject.clearTimeout(state.timer);
      state.timer = 0;
      state.playing = false;
      const play = $('#gv-journey-play');
      if (play) {
        play.setAttribute('aria-pressed', 'false');
        play.textContent = reducedMotion() ? 'Next journey step' : (label || '▶ Play your journey');
      }
      $('.mcv-map-card')?.classList.remove('is-journey-playing');
    }

    function focusMap(index, overview) {
      if (typeof windowObject.__gvJourneyMapFocus === 'function') {
        try { windowObject.__gvJourneyMapFocus(index, { overview: Boolean(overview) }); } catch (_) {}
      }
      $$('.mcv-fallback-marker').forEach((marker, markerIndex) => marker.classList.toggle('is-journey-active', !overview && markerIndex === index));
      $('.mcv-map-card')?.classList.toggle('is-journey-playing', state.playing && !overview);
    }

    function focusCard(index) {
      const cards = $$('.mcv-card--city');
      cards.forEach((card, cardIndex) => {
        card.classList.toggle('is-journey-active', cardIndex === index);
        card.classList.toggle('is-journey-complete', cardIndex < index);
      });
      const card = cards[index];
      const row = $('#mcv-cards');
      if (card && row) {
        const target = Math.max(0, card.offsetLeft - Math.max(0, (row.clientWidth - card.clientWidth) / 2));
        row.scrollTo?.({ left: target, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }

    function setStep(index, options = {}) {
      if (!state.model?.steps?.length) return;
      const safeIndex = Math.max(0, Math.min(Number(index) || 0, state.model.steps.length - 1));
      state.activeIndex = safeIndex;
      const step = state.model.steps[safeIndex];
      $$('.gv-journey-step').forEach((button, buttonIndex) => {
        button.classList.toggle('is-active', buttonIndex === safeIndex);
        button.classList.toggle('is-complete', buttonIndex < safeIndex);
        if (buttonIndex === safeIndex) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      });
      $$('.gv-journey-connector').forEach((connector, connectorIndex) => {
        connector.classList.toggle('is-complete', connectorIndex < safeIndex - 1);
        connector.classList.toggle('is-active', connectorIndex === safeIndex - 1);
      });
      const progress = $('#gv-journey-progress-bar');
      if (progress) progress.style.width = `${state.model.steps.length > 1 ? (safeIndex / (state.model.steps.length - 1)) * 100 : 100}%`;
      const status = $('#gv-journey-status');
      if (status) status.textContent = step.status;
      focusCard(safeIndex);
      focusMap(safeIndex, false);
      if (options.announce !== false) $('.gv-journey-step.is-active')?.focus?.({ preventScroll: true });
    }

    function overview() {
      stopPlayback('▶ Play your journey');
      state.activeIndex = -1;
      $$('.gv-journey-step,.gv-journey-connector').forEach((node) => node.classList.remove('is-active', 'is-complete'));
      $$('.mcv-card--city').forEach((card) => card.classList.remove('is-journey-active', 'is-journey-complete'));
      const progress = $('#gv-journey-progress-bar');
      if (progress) progress.style.width = '0%';
      const status = $('#gv-journey-status');
      if (status) status.textContent = 'Your complete route is ready. Select a stop or play the journey.';
      focusMap(0, true);
    }

    function scheduleNext() {
      if (!state.playing) return;
      if (state.activeIndex >= state.model.steps.length - 1) {
        stopPlayback('Replay journey');
        return;
      }
      state.timer = windowObject.setTimeout(() => {
        setStep(state.activeIndex + 1, { announce: false });
        scheduleNext();
      }, 1900);
    }

    function play() {
      if (!state.model?.steps?.length) return;
      if (reducedMotion()) {
        const next = state.activeIndex < 0 || state.activeIndex >= state.model.steps.length - 1 ? 0 : state.activeIndex + 1;
        setStep(next, { announce: false });
        return;
      }
      if (state.playing) {
        stopPlayback('Continue journey');
        return;
      }
      if (state.activeIndex < 0 || state.activeIndex >= state.model.steps.length - 1) setStep(0, { announce: false });
      state.playing = true;
      const button = $('#gv-journey-play');
      button?.setAttribute('aria-pressed', 'true');
      if (button) button.textContent = 'Pause journey';
      $('.mcv-map-card')?.classList.add('is-journey-playing');
      scheduleNext();
    }

    function enhanceCards(model) {
      const cards = $$('.mcv-card--city');
      cards.forEach((card, index) => {
        const step = model.steps[index];
        if (!step) return;
        card.dataset.journeyStep = String(index);
        const photo = card.querySelector('.mcv-card-photo');
        if (photo && !photo.querySelector('.gv-journey-days')) {
          const days = documentObject.createElement('span');
          days.className = 'gv-journey-days';
          days.textContent = step.days;
          photo.appendChild(days);
        }
        const body = card.querySelector('.mcv-city-body');
        if (body && step.transport && !body.querySelector('.gv-journey-arrival')) {
          const arrival = documentObject.createElement('div');
          arrival.className = 'gv-journey-arrival';
          arrival.innerHTML = `<span class="gv-journey-arrival__icon" aria-hidden="true">${step.transport.icon}</span><span class="gv-journey-arrival__copy"><span>${step.kind === 'return' ? 'RETURN JOURNEY' : 'ARRIVE BY ' + step.transport.label.toUpperCase()}</span><strong>${step.from} → ${step.city}</strong></span>`;
          body.prepend(arrival);
        }
      });
    }

    function syncDock(model) {
      const route = $('#gv-journey-dock-route');
      const budget = $('#gv-journey-dock-budget');
      const total = $('#gv-journey-dock-total');
      const evidence = $('#gv-journey-dock-evidence');
      if (route) route.textContent = model.route;
      if (budget) budget.textContent = text($('#mcv-summary-budget')?.textContent, '—');
      if (total) total.textContent = text($('#mcv-total')?.textContent, '—');
      if (evidence) evidence.textContent = model.evidence;
    }

    function render(tour) {
      if (!tour || !citiesOf(tour).length || $('#mcv-app')?.hidden) return false;
      const model = buildJourneyModel(tour);
      const key = model.route + '|' + model.steps.map((step) => step.shortMeta).join('|');
      stopPlayback();
      state.model = model;
      state.renderKey = key;
      const rail = $('#gv-journey-rail');
      if (rail) rail.innerHTML = railHtml(model);
      enhanceCards(model);
      syncDock(model);
      $$('.gv-journey-step').forEach((button) => button.addEventListener('click', () => {
        stopPlayback('▶ Play your journey');
        setStep(Number(button.dataset.journeyStep), { announce: false });
      }));
      const playButton = $('#gv-journey-play');
      if (playButton) {
        playButton.onclick = play;
        playButton.textContent = reducedMotion() ? 'Next journey step' : '▶ Play your journey';
      }
      const overviewButton = $('#gv-journey-overview');
      if (overviewButton) overviewButton.onclick = overview;
      const reviewButton = $('#gv-journey-review');
      if (reviewButton) reviewButton.onclick = () => $('#mcv-flight-options')?.click();
      overview();
      return true;
    }

    function maybeRender(tour) {
      const candidate = tour || windowObject.__gvGeneratedTour;
      if (!candidate) return false;
      return render(candidate);
    }

    windowObject.addEventListener('gv:journey-rendered', (event) => maybeRender(event.detail?.tour));
    documentObject.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.playing) stopPlayback('Continue journey'); });
    const app = $('#mcv-app');
    if (app && windowObject.MutationObserver) {
      const observer = new windowObject.MutationObserver(() => {
        if (!app.hidden && windowObject.__gvGeneratedTour) maybeRender(windowObject.__gvGeneratedTour);
      });
      observer.observe(app, { attributes: true, attributeFilter: ['hidden'] });
    }
    return Object.freeze({ state, render, maybeRender, setStep, overview, play, stopPlayback });
  }

  function startLoadingStory(windowObject, documentObject) {
    const loading = documentObject.querySelector('#mcv-loading');
    const stages = Array.from(documentObject.querySelectorAll('.gv-shell-state__steps li'));
    if (!loading || !stages.length) return () => {};
    let index = 0;
    const paint = () => stages.forEach((stage, stageIndex) => {
      stage.classList.toggle('is-active', stageIndex === index);
      stage.classList.toggle('is-complete', stageIndex < index);
    });
    paint();
    const timer = windowObject.setInterval(() => {
      if (loading.hidden) { windowObject.clearInterval(timer); return; }
      index = Math.min(index + 1, stages.length - 1);
      paint();
    }, 950);
    return () => windowObject.clearInterval(timer);
  }

  function start() {
    const documentObject = root.document;
    if (!documentObject) return null;
    startLoadingStory(root, documentObject);
    const controller = createController(root, documentObject);
    root.setTimeout(() => controller.maybeRender(root.__gvGeneratedTour), 0);
    return controller;
  }

  return Object.freeze({ VERSION, transportKind, nightsFor, evidenceLabel, buildJourneyModel, railHtml, createController, startLoadingStory, start });
});
