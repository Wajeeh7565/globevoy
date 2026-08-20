// GV-FLOW-651A-R1 defensive copy.
(function () {
  'use strict';

  const Origins = window.GlobevoySupportedOrigins || {};
  const STORAGE_KEY = 'globevoy.home.search.v2';
  const LEGACY_STORAGE_KEY = 'globevoy.home.search.v1';
  const LAST_ORIGIN_KEY = 'globevoy.last-origin.v1';
  const q = new URLSearchParams(window.location.search);
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const origin = $('#gv-origin');
  const budget = $('#gv-budget');
  const budgetPrefix = $('#gv-budget-prefix');
  const passengerButton = $('#gv-passenger-button');
  const passengerPanel = $('#gv-passenger-panel');
  const passengerSummary = $('#gv-passenger-summary');
  const adultsOutput = $('#gv-adults-count');
  const childrenOutput = $('#gv-children-count');
  const advanced = $('#gv-advanced-options');
  const travelDates = $('#gv-travel-dates');
  const tripLength = $('#gv-trip-length');
  const interests = $('#gv-interests');
  const hotelStyle = $('#gv-hotel-style');
  const continent = $('#gv-continent');
  const aiRequest = $('#gv-ai-request');
  const aiCount = $('#gv-ai-count');
  const datePanel = $('#gv-date-panel');
  const dateClose = $('#gv-date-close');
  const flexModeButton = $('#gv-flex-mode');
  const exactModeButton = $('#gv-exact-mode');
  const flexFields = $('#gv-flex-fields');
  const exactFields = $('#gv-exact-fields');
  const preferredMonth = $('#gv-preferred-month');
  const flexWindow = $('#gv-flex-window');
  const startDate = $('#gv-start-date');
  const endDate = $('#gv-end-date');
  const submitButton = $('#gv-search-submit');
  const status = $('#gv-home-status');
  const signInModal = $('#gv-signin-modal');

  if (!origin || !budget || !submitButton) return;

  let adults = 1;
  let children = 0;
  let dateMode = 'flexible';

  function readStorage(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key) || '{}');
    } catch (_) {
      return {};
    }
  }

  function readPersistent(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (_) {
      return null;
    }
  }

  function rememberOrigin(selected) {
    if (!selected) return;
    try {
      localStorage.setItem(LAST_ORIGIN_KEY, JSON.stringify({
        label: Origins.label ? Origins.label(selected) : `${selected.city} (${selected.code})`,
        code: selected.code || '',
        savedAt: Date.now()
      }));
    } catch (_) {
      // Persistent storage can be blocked by strict browser privacy settings.
    }
  }

  const stored = Object.assign({}, readStorage(LEGACY_STORAGE_KEY), readStorage(STORAGE_KEY));
  const initial = (name, fallback) => q.has(name) ? q.get(name) : (stored[name] ?? fallback);

  function setValue(element, value) {
    if (!element || value === null || value === undefined) return;
    if (element.tagName === 'SELECT') {
      const option = Array.from(element.options).find((item) => item.value === String(value) || item.textContent.trim() === String(value));
      if (option) element.value = option.value;
      return;
    }
    element.value = String(value);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || min));
  }

  function passengerText() {
    const adultLabel = `${adults} adult${adults === 1 ? '' : 's'}`;
    const childLabel = children ? `, ${children} child${children === 1 ? '' : 'ren'}` : '';
    return adultLabel + childLabel;
  }

  function syncPassengers() {
    adultsOutput.textContent = String(adults);
    childrenOutput.textContent = String(children);
    passengerSummary.textContent = passengerText();
    $$('[data-counter="adults"][data-delta="-1"]').forEach((button) => { button.disabled = adults <= 1; });
    $$('[data-counter="children"][data-delta="-1"]').forEach((button) => { button.disabled = children <= 0; });
  }

  function openPassengers() {
    passengerPanel.hidden = false;
    passengerButton.setAttribute('aria-expanded', 'true');
  }

  function closePassengers() {
    passengerPanel.hidden = true;
    passengerButton.setAttribute('aria-expanded', 'false');
  }

  function selectedOrigin() {
    return Origins.find ? Origins.find(origin.value, { allowPrefix: false }) : null;
  }

  function originCurrency() {
    const selected = selectedOrigin();
    return Origins.currencyFor ? Origins.currencyFor(selected, 'CAD') : 'CAD';
  }

  function currencyPrefix(code) {
    return ({ CAD: 'C$', USD: 'US$', AUD: 'A$', EUR: '€', GBP: '£' })[code] || `${code} `;
  }

  function syncCurrency() {
    budgetPrefix.textContent = currencyPrefix(originCurrency());
  }

  function addOriginOptions() {
    const list = document.createElement('datalist');
    list.id = 'gv-origin-list';
    (Origins.all ? Origins.all() : []).forEach((item) => {
      const option = document.createElement('option');
      option.value = Origins.label ? Origins.label(item) : `${item.city} (${item.code})`;
      list.appendChild(option);
    });
    document.body.appendChild(list);
  }

  function addMonths() {
    const start = new Date();
    start.setDate(1);
    for (let i = 0; i < 6; i += 1) {
      const month = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const value = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = month.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
      preferredMonth.appendChild(option);
    }
  }

  function exactNights() {
    if (!startDate.value || !endDate.value) return null;
    const start = new Date(`${startDate.value}T00:00:00`);
    const end = new Date(`${endDate.value}T00:00:00`);
    const nights = Math.round((end - start) / 86400000);
    return Number.isFinite(nights) && nights > 0 ? nights : null;
  }

  function selectedNights() {
    if (dateMode === 'exact') return exactNights() || 5;
    if (tripLength.value === 'auto') return 5;
    return Number(tripLength.value) || 5;
  }

  function updateDateSummary() {
    if (dateMode === 'exact') {
      travelDates.value = startDate.value && endDate.value ? `${startDate.value} to ${endDate.value}` : '';
      travelDates.placeholder = 'Choose exact dates';
      return;
    }
    const month = preferredMonth.options[preferredMonth.selectedIndex]?.textContent || 'Anytime';
    const windowText = flexWindow.options[flexWindow.selectedIndex]?.textContent || '';
    travelDates.value = `${month} · ${windowText}`;
    travelDates.placeholder = 'Anytime in the next 6 months';
  }

  function setDateMode(mode) {
    dateMode = mode === 'exact' ? 'exact' : 'flexible';
    const flexible = dateMode === 'flexible';
    flexFields.hidden = !flexible;
    exactFields.hidden = flexible;
    flexModeButton.classList.toggle('is-active', flexible);
    exactModeButton.classList.toggle('is-active', !flexible);
    flexModeButton.setAttribute('aria-selected', String(flexible));
    exactModeButton.setAttribute('aria-selected', String(!flexible));
    updateDateSummary();
    persist();
  }

  function openDatePanel() {
    datePanel.hidden = false;
    travelDates.setAttribute('aria-expanded', 'true');
  }

  function closeDatePanel() {
    datePanel.hidden = true;
    travelDates.setAttribute('aria-expanded', 'false');
  }

  function collect() {
    const selected = selectedOrigin();
    const currency = selected ? originCurrency() : 'CAD';
    return {
      mode: 'generated-tour',
      origin: selected && Origins.label ? Origins.label(selected) : origin.value,
      budget: budget.value,
      currency,
      adults,
      children,
      passengers: adults + children,
      travellers: passengerText(),
      dateMode,
      preferredMonth: preferredMonth.value,
      flexWindow: flexWindow.value,
      startDate: startDate.value,
      endDate: endDate.value,
      tripLength: tripLength.value,
      nights: selectedNights(),
      interests: interests.value,
      hotelStyle: hotelStyle.value,
      region: continent.value,
      ask: aiRequest.value.trim()
    };
  }

  function persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(collect()));
    } catch (_) {
      // Session storage can be blocked by strict browser privacy settings.
    }
  }

  function restore() {
    // Product requirement: do not hard-code Toronto. Reuse a recently confirmed
    // origin instantly, then let geolocation refine it in the background.
    const recentOrigin = readPersistent(LAST_ORIGIN_KEY);
    const originFallback = recentOrigin && recentOrigin.label ? recentOrigin.label : '';
    const originSource = q.has('origin') ? 'query' : (stored.origin ? 'session' : (originFallback ? 'persistent' : 'empty'));
    window.GLOBEVOY_HOME_ORIGIN_SOURCE = originSource;
    setValue(origin, initial('origin', originFallback));
    setValue(budget, initial('budget', '1000'));
    adults = clamp(initial('adults', initial('passengers', 1)), 1, 12);
    children = clamp(initial('children', 0), 0, 12);
    setValue(tripLength, initial('tripLength', 'auto'));
    setValue(interests, initial('interests', 'No preference'));
    setValue(hotelStyle, initial('hotelStyle', 'Best balance'));
    setValue(continent, initial('region', 'Anywhere'));
    setValue(aiRequest, initial('ask', ''));
    setValue(preferredMonth, initial('preferredMonth', preferredMonth.options[0]?.value || ''));
    setValue(flexWindow, initial('flexWindow', 'month'));
    setValue(startDate, initial('startDate', initial('departureDate', '')));
    setValue(endDate, initial('endDate', initial('returnDate', '')));
    setDateMode(initial('dateMode', 'flexible'));
    advanced.open = false;
    syncPassengers();
    syncCurrency();
    aiCount.textContent = String(aiRequest.value.length);
    persist();
  }

  function validate() {
    status.textContent = '';
    const selected = selectedOrigin();
    if (!origin.value.trim()) {
      status.textContent = 'Enter your starting city or airport.';
      origin.focus();
      return null;
    }
    if (!selected) {
      status.textContent = (Origins.unsupportedOriginMessage || 'Choose a supported city or airport from the suggestions.');
      origin.focus();
      return null;
    }
    const amount = Number(budget.value);
    if (!Number.isFinite(amount) || amount < 300) {
      status.textContent = 'Enter a total trip budget of at least 300.';
      budget.focus();
      return null;
    }
    if (dateMode === 'exact' && !exactNights()) {
      status.textContent = 'Choose a return date after the departure date.';
      advanced.open = true;
      openDatePanel();
      return null;
    }
    return selected;
  }

  function submit() {
    const selected = validate();
    if (!selected) return;
    const state = collect();
    persist();
    const params = new URLSearchParams({
      mode: 'generated-tour',
      recommendationScope: 'generated-multicity-tour',
      origin: Origins.label ? Origins.label(selected) : origin.value,
      budget: String(Math.round(Number(state.budget))),
      currency: state.currency,
      passengers: String(state.passengers),
      adults: String(state.adults),
      children: String(state.children),
      travellers: state.travellers,
      nights: String(state.nights),
      tripLength: state.tripLength,
      dateMode: state.dateMode,
      flexible: String(state.dateMode === 'flexible'),
      preferredMonth: state.preferredMonth,
      month: state.preferredMonth,
      flexibility: state.flexWindow,
      interests: state.interests,
      hotelStyle: state.hotelStyle,
      region: state.region === 'Anywhere' ? 'All continents' : state.region,
      ask: state.ask
    });
    if (state.dateMode === 'exact') {
      params.set('departureDate', state.startDate);
      params.set('returnDate', state.endDate);
      params.set('startDate', state.startDate);
      params.set('endDate', state.endDate);
    }
    params.set('generated', 'true');
    params.set('returnTo', 'index.html');
    window.location.href = `multicity-visualizer.html?${params.toString()}`;
  }

  function openSignInModal(event) {
    if (!signInModal) return;
    event.preventDefault();
    signInModal.hidden = false;
    document.body.classList.add('gv-modal-open');
    signInModal.querySelector('.gv-modal-close')?.focus();
  }

  function closeSignInModal() {
    if (!signInModal) return;
    signInModal.hidden = true;
    document.body.classList.remove('gv-modal-open');
  }

  addOriginOptions();
  addMonths();
  restore();

  passengerButton.addEventListener('click', () => passengerPanel.hidden ? openPassengers() : closePassengers());
  $$('[data-counter]').forEach((button) => {
    button.addEventListener('click', () => {
      const delta = Number(button.dataset.delta) || 0;
      if (button.dataset.counter === 'adults') adults = clamp(adults + delta, 1, 12);
      if (button.dataset.counter === 'children') children = clamp(children + delta, 0, 12);
      syncPassengers();
      persist();
    });
  });

  document.addEventListener('click', (event) => {
    if (!passengerPanel.hidden && !event.target.closest('.gv-passenger-field')) closePassengers();
  });

  advanced.addEventListener('toggle', persist);
  travelDates.addEventListener('click', () => datePanel.hidden ? openDatePanel() : closeDatePanel());
  travelDates.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      datePanel.hidden ? openDatePanel() : closeDatePanel();
    }
  });
  dateClose.addEventListener('click', closeDatePanel);
  flexModeButton.addEventListener('click', () => setDateMode('flexible'));
  exactModeButton.addEventListener('click', () => setDateMode('exact'));
  [preferredMonth, flexWindow, startDate, endDate].forEach((element) => element.addEventListener('change', () => { updateDateSummary(); persist(); }));

  origin.addEventListener('change', () => {
    const selected = selectedOrigin();
    if (selected && Origins.label) origin.value = Origins.label(selected);
    if (selected) rememberOrigin(selected);
    syncCurrency();
    status.textContent = '';
    persist();
  });
  origin.addEventListener('input', () => { status.textContent = ''; persist(); });
  origin.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
  [budget, tripLength, interests, hotelStyle, continent].forEach((element) => {
    element.addEventListener('change', persist);
    element.addEventListener('input', persist);
  });
  aiRequest.addEventListener('input', () => { aiCount.textContent = String(aiRequest.value.length); persist(); });
  submitButton.addEventListener('click', submit);

  const authLink = document.querySelector('.gv-auth');
  if (authLink) authLink.addEventListener('click', openSignInModal);
  $$('[data-close-signin]').forEach((element) => element.addEventListener('click', closeSignInModal));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!passengerPanel.hidden) closePassengers();
      if (!datePanel.hidden) closeDatePanel();
      if (signInModal && !signInModal.hidden) closeSignInModal();
    }
  });
})();
