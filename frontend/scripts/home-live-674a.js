// GV-QUALITY-680B-R1: booking lead time, richer travel preferences, and generated visualizer handoff.
(function () {
  'use strict';

  const Origins = window.GlobevoySupportedOrigins || {};
  const STORAGE_KEY = 'globevoy.home.search.v2';
  const LEGACY_STORAGE_KEY = 'globevoy.home.search.v1';
  const LAST_ORIGIN_KEY = 'globevoy.last-origin.v1';
  const PROFILE_KEY = 'globevoy.travel.profile.v1';
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
  const travelPace = $('#gv-travel-pace');
  const flightPreference = $('#gv-flight-preference');
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
  const travelProfile = readPersistent(PROFILE_KEY) || {};
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

  const IMPORTANT_ORIGIN_QUERIES = [
    'Toronto', 'New York', 'Los Angeles', 'London', 'Paris', 'Mexico City',
    'Lahore', 'Karachi', 'Islamabad', 'Tehran', 'Mashhad', 'Dubai',
    'Istanbul', 'Delhi', 'Mumbai', 'San Diego', 'Calgary', 'Vancouver', 'Montreal'
  ];
  let originMenu = null;
  let originMenuItems = [];
  let activeOriginIndex = -1;

  function originOptionLabel(item) {
    return Origins.label ? Origins.label(item) : `${item.city} (${item.code})`;
  }

  function uniqueOrigins(items) {
    const seen = new Set();
    return (items || []).filter((item) => {
      const key = `${item.city || ''}|${item.countryCode || ''}|${item.code || item.airportCode || ''}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function originSuggestions(value) {
    const query = Origins.searchText ? Origins.searchText(value) : String(value || '').trim().toLowerCase();
    let matches = [];
    if (Origins.matching && query) {
      matches = Origins.matching(value).slice(0, 80);
    } else if (Origins.find) {
      matches = IMPORTANT_ORIGIN_QUERIES
        .map((term) => Origins.find(term, { allowPrefix: false }))
        .filter(Boolean);
    } else if (Origins.all) {
      matches = Origins.all().slice(0, 80);
    }
    return uniqueOrigins(matches).slice(0, 80);
  }

  function closeOriginMenu() {
    if (!originMenu) return;
    originMenu.hidden = true;
    origin.setAttribute('aria-expanded', 'false');
    origin.removeAttribute('aria-activedescendant');
    activeOriginIndex = -1;
  }

  function setActiveOriginIndex(index) {
    if (!originMenuItems.length || !originMenu) return;
    activeOriginIndex = Math.max(0, Math.min(index, originMenuItems.length - 1));
    const buttons = Array.from(originMenu.querySelectorAll('.gv-origin-option'));
    buttons.forEach((button, buttonIndex) => {
      const active = buttonIndex === activeOriginIndex;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const activeButton = buttons[activeOriginIndex];
    if (activeButton) {
      origin.setAttribute('aria-activedescendant', activeButton.id);
      activeButton.scrollIntoView({ block: 'nearest' });
    }
  }

  function selectOriginOption(index) {
    const selected = originMenuItems[index];
    if (!selected) return;
    origin.value = originOptionLabel(selected);
    rememberOrigin(selected);
    syncCurrency();
    status.textContent = '';
    persist();
    closeOriginMenu();
    origin.focus();
  }

  function renderOriginOptions(value) {
    if (!originMenu) return;
    originMenuItems = originSuggestions(value);
    activeOriginIndex = -1;
    originMenu.replaceChildren();

    if (!originMenuItems.length) {
      closeOriginMenu();
      return;
    }

    originMenuItems.forEach((item, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `gv-origin-option-${index}`;
      option.className = 'gv-origin-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');

      const main = document.createElement('span');
      main.className = 'gv-origin-option-main';
      main.textContent = `${item.city || 'Unknown city'} (${item.code || item.airportCode || ''})`;

      const detail = document.createElement('span');
      detail.className = 'gv-origin-option-detail';
      detail.textContent = `${item.city || ''}${item.country ? ', ' + item.country : ''}${item.airportCode || item.code ? ' · ' + (item.airportCode || item.code) : ''}`;

      option.append(main, detail);
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => selectOriginOption(index));
      option.addEventListener('mousemove', () => setActiveOriginIndex(index));
      originMenu.appendChild(option);
    });

    originMenu.hidden = false;
    origin.setAttribute('aria-expanded', 'true');
  }

  function addOriginOptions() {
    originMenu = document.getElementById('gv-origin-menu');
    if (!originMenu) {
      originMenu = document.createElement('div');
      originMenu.id = 'gv-origin-menu';
      originMenu.className = 'gv-origin-menu';
      originMenu.setAttribute('role', 'listbox');
      originMenu.hidden = true;
      origin.closest('.gv-field')?.appendChild(originMenu);
    }
    renderOriginOptions(origin.value);
    closeOriginMenu();
  }

  function addMonths() {
    // GV-QUALITY-680B-R1: if the 14-day automatic booking floor falls in the
    // next month, do not offer the now-unusable current month as the default.
    const floor = new Date();
    floor.setDate(floor.getDate() + 14);
    const start = new Date(floor.getFullYear(), floor.getMonth(), 1);
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
    if (dateMode === 'exact') return exactNights();
    if (tripLength.value === 'auto') return null;
    const selected = Number(tripLength.value);
    return Number.isFinite(selected) && selected > 0 ? selected : null;
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
      priorities: $$('input[name="gv-priority"]:checked').map((input) => input.value),
      travelPace: travelPace?.value || 'Balanced',
      flightPreference: flightPreference?.value || 'Best overall',
      hotelStyle: hotelStyle.value,
      region: continent.value,
      ask: aiRequest.value.trim(),
      passportCountry: travelProfile.passportCountry || '',
      passportCountryCode: travelProfile.passportCountryCode || '',
      residenceCountry: travelProfile.residenceCountry || '',
      residenceCountryCode: travelProfile.residenceCountryCode || '',
      secondPassportCountry: travelProfile.secondPassportCountry || '',
      secondPassportCountryCode: travelProfile.secondPassportCountryCode || '',
      useSecondPassportForTrip: Boolean(travelProfile.useSecondPassportForTrip && travelProfile.secondPassportCountryCode),
      validUsVisaOn20260101: Boolean(travelProfile.validUsVisaOn20260101),
      usLawfulPermanentResident: Boolean(travelProfile.usLawfulPermanentResident),
      entryAware: travelProfile.entryAware !== false
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
    adults = clamp(initial('adults', initial('passengers', travelProfile.adults || 1)), 1, 12);
    children = clamp(initial('children', travelProfile.children || 0), 0, 12);
    setValue(tripLength, initial('tripLength', 'auto'));
    setValue(interests, initial('interests', 'No preference'));
    setValue(travelPace, initial('travelPace', 'Balanced'));
    setValue(flightPreference, initial('flightPreference', 'Best overall'));
    const selectedPriorities = new Set(String(initial('priorities', '')).split(',').map((item) => item.trim()).filter(Boolean));
    $$('input[name="gv-priority"]').forEach((input) => { input.checked = selectedPriorities.has(input.value); });
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
    if (dateMode === 'exact' && startDate.value < new Date().toISOString().slice(0, 10)) {
      status.textContent = 'Choose a departure date that is not in the past.';
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
    params.set('minimumLeadDays', '14');
    params.set('travelPace', state.travelPace);
    params.set('flightPreference', state.flightPreference);
    if (state.priorities.length) params.set('priorities', state.priorities.join(','));
    if (state.nights) {
      params.set('nights', String(state.nights));
      params.set('totalNights', String(state.nights));
      params.set('adaptiveDuration', 'false');
    } else {
      params.delete('nights');
      params.delete('totalNights');
      params.set('adaptiveDuration', 'true');
    }
    if (state.passportCountryCode) {
      params.set('passportCountry', state.passportCountry);
      params.set('passportCountryCode', state.passportCountryCode);
      params.set('residenceCountry', state.residenceCountry);
      params.set('residenceCountryCode', state.residenceCountryCode);
      if (state.secondPassportCountryCode) {
        params.set('secondPassportCountry', state.secondPassportCountry);
        params.set('secondPassportCountryCode', state.secondPassportCountryCode);
        if (state.useSecondPassportForTrip) params.set('useSecondPassportForTrip', '1');
      }
      params.set('entryProfile', state.entryAware ? '1' : '0');
      if (state.validUsVisaOn20260101) params.set('validUsVisaOn20260101', '1');
      if (state.usLawfulPermanentResident) params.set('usLawfulPermanentResident', '1');
    }
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
  const today = new Date().toISOString().slice(0, 10);
  startDate.min = today;
  endDate.min = today;
  restore();
  renderOriginOptions(origin.value);

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
    if (originMenu && !event.target.closest('#gv-origin') && !event.target.closest('#gv-origin-menu')) closeOriginMenu();
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
  origin.addEventListener('input', () => { renderOriginOptions(origin.value); status.textContent = ''; persist(); });
  origin.addEventListener('focus', () => { renderOriginOptions(origin.value); });
  origin.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (originMenu?.hidden) renderOriginOptions(origin.value);
      setActiveOriginIndex(activeOriginIndex < 0 ? 0 : activeOriginIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (originMenu?.hidden) renderOriginOptions(origin.value);
      setActiveOriginIndex(activeOriginIndex < 0 ? originMenuItems.length - 1 : activeOriginIndex - 1);
      return;
    }
    if (event.key === 'Escape') {
      closeOriginMenu();
      return;
    }
    if (event.key === 'Tab') {
      closeOriginMenu();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (originMenu && !originMenu.hidden && originMenuItems.length) {
        selectOriginOption(activeOriginIndex >= 0 ? activeOriginIndex : 0);
      } else {
        submit();
      }
    }
  });
  [budget, tripLength, interests, travelPace, flightPreference, hotelStyle, continent].filter(Boolean).forEach((element) => {
    element.addEventListener('change', persist);
    element.addEventListener('input', persist);
  });
  $$('input[name="gv-priority"]').forEach((input) => input.addEventListener('change', persist));
  aiRequest.addEventListener('input', () => { aiCount.textContent = String(aiRequest.value.length); persist(); });
  submitButton.addEventListener('click', submit);

  $$('[data-close-signin]').forEach((element) => element.addEventListener('click', closeSignInModal));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!passengerPanel.hidden) closePassengers();
      if (!datePanel.hidden) closeDatePanel();
      closeOriginMenu();
      if (signInModal && !signInModal.hidden) closeSignInModal();
    }
  });
})();
