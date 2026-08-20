(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const query = new URLSearchParams(location.search);
  const Origins = window.GlobevoySupportedOrigins || {};
  const FX = {
    USD: { rate: 1, prefix: 'US$', locale: 'en-US' },
    CAD: { rate: 1.36, prefix: 'C$', locale: 'en-CA' },
    AUD: { rate: 1.52, prefix: 'A$', locale: 'en-AU' },
    EUR: { rate: 0.92, prefix: '€', locale: 'en-IE' },
    GBP: { rate: 0.79, prefix: '£', locale: 'en-GB' }
  };

  const currency = (query.get('currency') || 'CAD').toUpperCase();
  const fx = FX[currency] || FX.CAD;
  const displayBudget = Math.max(300, Number(query.get('budget')) || 1000);
  const origin = Origins.find ? Origins.find(query.get('origin') || '') : null;
  const passengers = Math.max(1, Number(query.get('passengers')) || 1);
  const adults = Math.max(1, Number(query.get('adults')) || passengers);
  const children = Math.max(0, Number(query.get('children')) || 0);
  const requestedNights = Math.max(2, Math.min(21, Number(query.get('nights')) || 5));
  const tripLength = query.get('tripLength') || 'auto';
  const interests = (query.get('interests') || 'No preference').split(',').map((value) => value.trim()).filter(Boolean);
  const hotelStyle = query.get('hotelStyle') || 'Best balance';
  const region = query.get('region') || 'All continents';
  const destinationPool = Array.isArray(window.GLOBEVOY_DESTINATIONS) ? window.GLOBEVOY_DESTINATIONS : [];
  const flags = window.GLOBEVOY_EXPERIMENT_FLAGS || {};
  const recommender = window.GlobevoyAutomaticCityRecommender;
  const multiData = window.GLOBEVOY_MEHDI_DEMO_DATA;
  const BudgetContract = window.GlobevoyBudgetContract || null;

  const destinationByKey = new Map();
  destinationPool.forEach((destination) => {
    destinationByKey.set(String(destination.id || '').toLowerCase(), destination);
    destinationByKey.set(String(destination.code || '').toUpperCase(), destination);
    destinationByKey.set(String(destination.city || '').toLowerCase(), destination);
  });

  const state = {
    loadSerial: 0,
    results: [],
    selectedId: null,
    map: null,
    infoWindow: null,
    mapOverlays: [],
    mapReady: false,
    mapFailed: false,
    mapLoadTimer: null,
    mapDrawSerial: 0
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function formatMoney(value) {
    try {
      return new Intl.NumberFormat(fx.locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0
      }).format(Number(value) || 0);
    } catch (_) {
      return `${fx.prefix}${Math.round(Number(value) || 0)}`;
    }
  }

  function slug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function futureMonth() {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() + 2);
    return date.toISOString().slice(0, 7);
  }

  function codeFromOrigin(value) {
    const match = String(value || '').toUpperCase().match(/\b([A-Z]{3})\b/);
    return match ? match[1] : '';
  }

  function destinationRecord(value) {
    if (!value) return {};
    return destinationByKey.get(String(value.id || '').toLowerCase())
      || destinationByKey.get(String(value.code || value.airportCode || '').toUpperCase())
      || destinationByKey.get(String(value.city || '').toLowerCase())
      || {};
  }

  function coordinates(value) {
    const record = destinationRecord(value);
    const lat = Number(value?.lat ?? value?.latitude ?? record.lat ?? record.latitude);
    const lng = Number(value?.lng ?? value?.longitude ?? record.lng ?? record.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function distanceKm(a, b) {
    const first = coordinates(a);
    const second = coordinates(b);
    if (!first || !second) return 0;
    const radius = 6371;
    const toRadians = (number) => number * Math.PI / 180;
    const latDifference = toRadians(second.lat - first.lat);
    const lngDifference = toRadians(second.lng - first.lng);
    const calculation = Math.sin(latDifference / 2) ** 2
      + Math.cos(toRadians(first.lat)) * Math.cos(toRadians(second.lat)) * Math.sin(lngDifference / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(calculation));
  }

  function readBudgetContract(item) {
    if (!BudgetContract || !item?.displayBudget) return null;
    try {
      BudgetContract.assertConsistent(item);
      const budget = BudgetContract.getDisplayBudget(item);
      return {
        budget,
        totalBudget: Number(budget.totalBudget),
        reserveAmount: Number(budget.reserveAmount),
        usableTripBudget: Number(budget.usableTripBudget),
        tripEstimate: Number(budget.tripEstimate),
        flightEstimate: Number(budget.flightEstimate),
        accommodationEstimate: Number(budget.accommodationEstimate),
        amountLeft: Number(budget.amountLeft),
        explanation: item.displayWhyItFits || null
      };
    } catch (error) {
      console.warn('GV-MIXED-610C display budget rejected; using legacy fields.', error);
      return null;
    }
  }

  function normalizeSingle(item) {
    if (!item || !item.city) return null;
    const base = destinationRecord(item);
    const flight = Number(item.flight ?? item.flightUsd ?? item.flightEstimateUsd ?? item.costs?.flightUsd ?? 0);
    const stay = Number(item.lodging ?? item.stay ?? item.stayUsd ?? item.stayEstimateUsd ?? item.costs?.stayUsd ?? 0);
    const totalUsd = Number(item.estimatedFlightAndStayTotal ?? item.total ?? (flight + stay));
    const presentation = readBudgetContract(item);
    if ((!Number.isFinite(totalUsd) || totalUsd <= 0) && !presentation) return null;
    const point = coordinates({ ...base, ...item });
    const total = presentation ? presentation.tripEstimate : totalUsd * fx.rate;
    const flightDisplay = presentation ? presentation.flightEstimate : flight * fx.rate;
    const stayDisplay = presentation ? presentation.accommodationEstimate : stay * fx.rate;
    const reserveAmount = presentation ? presentation.reserveAmount : Math.round(displayBudget * 0.1);
    const usableTripBudget = presentation ? presentation.usableTripBudget : displayBudget - reserveAmount;
    const sourceBudgetTotal = presentation ? presentation.totalBudget : displayBudget;
    const remaining = presentation ? presentation.amountLeft : usableTripBudget - total;
    const why = presentation?.explanation
      || item.whyItFits
      || item.explanation
      || base.whyItFits
      || `${item.city} fits the selected budget using the available recommendation evidence.`;
    return {
      kind: 'single',
      id: `single-${slug(item.id || item.code || item.city)}`,
      city: item.city,
      country: item.country || base.country || '',
      code: item.code || base.code || '',
      lat: point?.lat,
      lng: point?.lng,
      img: item.img || base.img || '',
      total,
      flight: flightDisplay,
      stay: stayDisplay,
      remaining,
      reserveAmount,
      usableTripBudget,
      sourceBudgetTotal,
      displayBudget: presentation?.budget || null,
      nights: Number(item.nights || requestedNights),
      score: Number(item.recommendationScore ?? item.score ?? 0),
      themes: item.themes || item.primaryTravelThemes || base.themes || [],
      why,
      raw: {
        ...base,
        ...item,
        flight: flightDisplay,
        stay: stayDisplay,
        total,
        remaining,
        reserveAmount,
        usableTripBudget,
        sourceBudgetTotal,
        why,
        nights: Number(item.nights || requestedNights)
      }
    };
  }

  function preferenceValue() {
    const interest = String(interests[0] || '').toLowerCase();
    if (interest.includes('food')) return 'food';
    if (interest.includes('history') || interest.includes('culture')) return 'history-and-culture';
    if (interest.includes('nature')) return 'nature';
    if (interest.includes('beach')) return 'beaches';
    if (interest.includes('night')) return 'nightlife';
    if (interest.includes('family')) return 'family';
    if (interest.includes('relax')) return 'relaxation';
    return '';
  }

  function canOfferMulti() {
    if (!origin || !window.GlobevoyApi?.isConfigured?.() || typeof window.GlobevoyApi.getMultiCityTours !== 'function') return false;
    if (tripLength !== 'auto' && requestedNights < 4) return false;
    return true;
  }

  function multiInput() {
    const autoDuration = tripLength === 'auto';
    const month = query.get('preferredMonth') || query.get('month') || '';
    const preferredStops = query.get('preferredStops') || '';
    return {
      origin: origin.originCode || origin.code || codeFromOrigin(Origins.label ? Origins.label(origin) : query.get('origin')),
      budget: displayBudget,
      currency,
      adaptiveDuration: autoDuration ? 'true' : 'false',
      totalNights: autoDuration ? undefined : Math.max(4, requestedNights),
      maxStops: query.get('maxStops') || query.get('cities') || undefined,
      theme: preferenceValue() || undefined,
      month: month || undefined,
      preferredStops: preferredStops || undefined
    };
  }

  function displayFromUsd(value, presentation) {
    const rate = Number(presentation?.budget?.exchangeRateFromUsd || fx.rate || 1);
    return Math.round((Number(value) || 0) * rate);
  }

  function transportLabel(leg) {
    return String(leg?.transportType || leg?.mode || 'connection')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function adaptBackendTour(tour, cities, presentation) {
    const stops = Array.isArray(tour.stops) ? tour.stops : [];
    const legs = Array.isArray(tour.legs) ? tour.legs : [];
    const budgetDisplay = presentation?.budget || tour.displayBudget || {};
    const exactStart = query.get('startDate') || query.get('departureDate') || '';
    const exactEnd = query.get('endDate') || query.get('returnDate') || '';
    const actualFlightUsd = legs.reduce((sum, leg) => sum + (Number(leg.estimatedFlightUsd) || 0), 0);
    const groundTransportUsd = legs.reduce((sum, leg) => (
      sum + (String(leg.mode || '').toLowerCase() === 'flight' ? 0 : (Number(leg.estimatedTransportUsd) || 0))
    ), 0);
    const title = tour.title || cities.map((city) => city.city).join(' + ');
    const explanation = Array.isArray(tour.routeExplanation)
      ? tour.routeExplanation.join(' ')
      : (tour.recommendationExplanation || tour.whyCitiesWork || 'A connected route selected for budget fit and practical transport.');
    const stays = stops.map((stop, index) => ({
      id: stop.cityId || stop.id || cities[index]?.id,
      city: stop.city || cities[index]?.city,
      country: stop.country || cities[index]?.country || '',
      nights: Number(stop.nights || 0),
      checkIn: exactStart || 'Flexible timing',
      checkOut: exactEnd || 'Flexible timing',
      dateLabel: exactStart && exactEnd ? `${exactStart} to ${exactEnd}` : 'Flexible timing',
      hotel: stop.hotel || null
    }));
    const internalLegs = legs.slice(1, Math.max(1, legs.length - 1)).map((leg) => ({
      type: transportLabel(leg),
      from: leg.from?.city || '',
      to: leg.to?.city || '',
      amount: displayFromUsd(leg.estimatedTransportUsd, presentation),
      mode: leg.mode || '',
      source: leg.estimateSource || ''
    }));
    return {
      routeId: tour.tourId || tour.routeId || slug(title),
      title,
      origin: {
        city: tour.origin?.city || origin.city,
        country: tour.origin?.country || origin.country || '',
        code: tour.origin?.airportCode || tour.origin?.code || origin.airportCode || origin.code,
        latitude: Number(tour.origin?.latitude ?? origin.lat),
        longitude: Number(tour.origin?.longitude ?? origin.lng)
      },
      cities: cities.map((city) => ({
        id: city.id,
        city: city.city,
        country: city.country,
        airportCode: city.code,
        code: city.code,
        latitude: city.lat,
        longitude: city.lng
      })),
      stays,
      transport: internalLegs,
      backendLegs: legs,
      departureDate: exactStart,
      returnDate: exactEnd,
      totalNights: Number(tour.totalNights || stays.reduce((sum, stay) => sum + stay.nights, 0)),
      recommendationLabel: tour.tourRoleLabel || tour.recommendationLabel || 'Best balance',
      recommendationExplanation: explanation,
      whyCitiesWork: explanation,
      travellerFit: tour.budgetAdaptivePolicy?.band ? `Budget-adaptive ${String(tour.budgetAdaptivePolicy.band).replace(/-/g, ' ')} route` : 'Connected multi-city route',
      automaticScore: Number(tour.score || tour.automaticScore || 0),
      pricingStatus: tour.pricingStatus || '',
      budgetAdaptivePolicy: tour.budgetAdaptivePolicy || null,
      displayBudget: budgetDisplay,
      budget: {
        total: { amount: Number(budgetDisplay.totalBudget || displayBudget), currency },
        personalReserve: { amount: Number(budgetDisplay.reserveAmount || 0), currency },
        personalExpenseReserve: { amount: Number(budgetDisplay.reserveAmount || 0), currency },
        usableCoreBudget: { amount: Number(budgetDisplay.usableTripBudget || 0), currency },
        flightRange: {
          minimum: displayFromUsd(actualFlightUsd, presentation),
          midpoint: displayFromUsd(actualFlightUsd, presentation),
          maximum: displayFromUsd(actualFlightUsd, presentation),
          currency
        },
        accommodation: { amount: Number(budgetDisplay.accommodationEstimate || 0), currency },
        intercity: { amount: displayFromUsd(groundTransportUsd, presentation), currency },
        estimatedCoreTotal: { amount: Number(budgetDisplay.tripEstimate || 0), currency },
        remainingCoreRoom: { amount: Number(budgetDisplay.amountLeft || 0), currency }
      }
    };
  }

  function normalizeMulti(tour) {
    const sourceCities = Array.isArray(tour?.stops) && tour.stops.length ? tour.stops : tour?.cities;
    if (!tour || !Array.isArray(sourceCities) || !sourceCities.length) return null;
    const budget = tour.budget || {};
    const presentation = readBudgetContract(tour);
    const total = presentation ? presentation.tripEstimate : Number(budget.estimatedCoreTotal?.amount ?? tour.estimatedTotalUsd * fx.rate);
    const remaining = presentation ? presentation.amountLeft : Number(budget.remainingCoreRoom?.amount ?? tour.amountLeftUsd * fx.rate);
    if (!Number.isFinite(total) || total <= 0) return null;
    const cities = sourceCities.map((city) => {
      const record = destinationRecord(city);
      const point = coordinates({ ...record, ...city });
      return {
        city: city.city,
        country: city.country || record.country || '',
        code: city.airportCode || city.code || city.airportCodes?.[0] || record.code || '',
        id: city.cityId || city.id || record.id,
        lat: point?.lat,
        lng: point?.lng
      };
    });
    const compatibleTour = Array.isArray(tour.stops) ? adaptBackendTour(tour, cities, presentation) : tour;
    const explanation = presentation?.explanation
      || (Array.isArray(tour.routeExplanation) ? tour.routeExplanation.join(' ') : null)
      || tour.recommendationExplanation
      || tour.whyCitiesWork
      || 'A connected route selected for budget fit, practical transport and meaningful city contrast.';
    const title = tour.title || cities.map((city) => city.city).join(' + ');
    return {
      kind: 'multi',
      id: `multi-${slug(tour.tourId || tour.routeId || title)}`,
      tour: compatibleTour,
      backendTour: tour,
      title,
      cities,
      total,
      remaining: Number.isFinite(remaining) ? remaining : displayBudget - total,
      reserveAmount: presentation ? presentation.reserveAmount : Number(budget.personalExpenseReserve?.amount || 0),
      usableTripBudget: presentation ? presentation.usableTripBudget : Number(budget.usableCoreBudget?.amount || displayBudget),
      sourceBudgetTotal: presentation ? presentation.totalBudget : displayBudget,
      displayBudget: presentation?.budget || tour.displayBudget || null,
      nights: Number(tour.totalNights || compatibleTour.totalNights || 8),
      score: Number(tour.score || tour.automaticScore || 0),
      why: explanation,
      routePath: [tour.origin?.city || origin.city, ...cities.map((city) => city.city), tour.origin?.city || origin.city].join(' → ')
    };
  }

  async function getSingles() {
    if (query.get('offline') === '1') {
      const preferred = ['Montreal', 'Mexico City', 'New York', 'Madrid', 'Lisbon', 'Vienna', 'Prague', 'Vancouver', 'Seoul', 'Amsterdam', 'Rome', 'Tokyo'];
      return preferred
        .map((name) => destinationPool.find((destination) => destination.city === name))
        .filter(Boolean)
        .map((destination, index) => normalizeSingle({
          ...destination,
          flight: 140 + index * 18,
          lodging: Math.min(95, Number(destination.costs?.nightlyStayUsd || 72)) * requestedNights,
          estimatedFlightAndStayTotal: 140 + index * 18 + Math.min(95, Number(destination.costs?.nightlyStayUsd || 72)) * requestedNights,
          nights: requestedNights,
          score: 90 - index,
          whyItFits: `Offline QA estimate for ${destination.city}. The normal staging flow uses current recommendation evidence.`
        }))
        .filter(Boolean);
    }
    if (!window.GlobevoyApi?.isConfigured?.() || !origin) {
      throw new Error('Live recommendations are not configured for this search.');
    }
    const payload = await window.GlobevoyApi.getRecommendations({
      origin: origin.code,
      budget: displayBudget,
      nights: requestedNights,
      month: query.get('preferredMonth') || query.get('month') || futureMonth(),
      style: hotelStyle,
      hotelStyle,
      interests: interests.join(','),
      region: region === 'All continents' ? '' : region,
      currency,
      nearMissUsd: 60 / fx.rate,
      limit: flags.enable500CityDiscovery ? 500 : 250
    });
    return (payload.recommendations || []).map(normalizeSingle).filter(Boolean);
  }

  async function getMultis() {
    if (!canOfferMulti()) return [];
    try {
      const response = await window.GlobevoyApi.getMultiCityTours(multiInput());
      if (response?.supported === false) return [];
      return (response?.tours || []).map(normalizeMulti).filter(Boolean);
    } catch (error) {
      console.warn('Mixed results multi-city API request skipped:', error);
      return [];
    }
  }

  function unique(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.kind === 'single'
        ? item.city.toLowerCase()
        : `m:${item.cities.map((city) => city.city.toLowerCase()).join('|')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function pickResults(singles, multis) {
    const all = unique([...singles, ...multis])
      .filter((item) => item.total <= displayBudget * 1.08)
      .map((item) => ({
        ...item,
        valueScore: Math.max(0, displayBudget - item.total) / Math.max(1, displayBudget)
      }));
    if (!all.length) return [];

    const chosen = [];
    const take = (candidate, label, featured = false) => {
      if (!candidate || chosen.some((item) => item.id === candidate.id)) return;
      chosen.push({ ...candidate, label, featured });
    };

    const cheapest = [...all].sort((a, b) => a.total - b.total || b.score - a.score)[0];
    take(cheapest, 'Lowest cost');

    const target = displayBudget * 0.78;
    let balance = [...all]
      .filter((item) => item.id !== cheapest?.id)
      .sort((a, b) => Math.abs(a.total - target) - Math.abs(b.total - target) || b.score - a.score)[0];
    if (multis.length && cheapest?.kind === 'single') {
      const multiBalance = [...multis]
        .filter((item) => item.id !== cheapest?.id && item.total <= displayBudget * 1.08)
        .sort((a, b) => Math.abs(a.total - target) - Math.abs(b.total - target) || b.score - a.score)[0];
      if (multiBalance && Math.abs(multiBalance.total - target) <= Math.abs((balance?.total || 0) - target) + displayBudget * 0.15) {
        balance = multiBalance;
      }
    }
    take(balance, 'Best balance', true);

    const remaining = all.filter((item) => !chosen.some((selected) => selected.id === item.id));
    const memorable = [...remaining].sort((a, b) => {
      const aMulti = a.kind === 'multi' ? 18 : 0;
      const bMulti = b.kind === 'multi' ? 18 : 0;
      const aDistance = distanceKm(origin, a);
      const bDistance = distanceKm(origin, b);
      return (b.score + bMulti + Math.min(18, bDistance / 600)) - (a.score + aMulti + Math.min(18, aDistance / 600));
    })[0];
    take(memorable, 'Most memorable');

    const extras = all.filter((item) => !chosen.some((selected) => selected.id === item.id));
    const hidden = [...extras]
      .filter((item) => item.kind === 'single')
      .sort((a, b) => (b.valueScore + b.score / 150) - (a.valueScore + a.score / 150))[0];
    take(hidden, 'Hidden-value discovery');

    const connected = [...extras]
      .filter((item) => item.kind === 'multi' && !chosen.some((selected) => selected.id === item.id))
      .sort((a, b) => b.score - a.score)[0];
    take(connected, 'Connected city route');

    const familiar = [...extras]
      .filter((item) => !chosen.some((selected) => selected.id === item.id))
      .sort((a, b) => b.score - a.score || a.total - b.total)[0];
    take(familiar, 'Familiar favourite');

    return chosen.slice(0, 6);
  }

  function renderSummary() {
    if (!origin) return;
    const date = query.get('dateMode') === 'exact'
      ? 'Exact dates'
      : query.get('preferredMonth')
        ? 'Preferred month'
        : 'Flexible timing';
    const items = [
      Origins.label ? Origins.label(origin) : query.get('origin'),
      formatMoney(displayBudget),
      `${adults} adult${adults === 1 ? '' : 's'}${children ? `, ${children} child${children === 1 ? '' : 'ren'}` : ''}`,
      date,
      tripLength === 'auto' ? 'Length decided by Globevoy' : `${requestedNights} nights`
    ];
    $('#mx-summary-items').innerHTML = items.map((item, index) => (
      `<span class="mx-summary-pill">${escapeHtml(item)}</span>${index < items.length - 1 ? '<span class="mx-summary-dot">•</span>' : ''}`
    )).join('');
  }

  function photoMarkup(item, priority) {
    if (item.kind === 'single') {
      return `<div class="mx-card-photo" data-mx-photo data-priority="${priority}" data-city="${escapeHtml(item.city)}" data-country="${escapeHtml(item.country)}" data-fallback="${escapeHtml(item.img || '')}">
        <div class="mx-card-photo-placeholder">${escapeHtml(item.city)}</div>
        <span class="mx-label">${escapeHtml(item.label)}</span>
      </div>`;
    }
    const first = item.cities[0];
    const second = item.cities[1] || item.cities[0];
    return `<div class="mx-card-photo is-split">
      <div data-mx-photo data-priority="${priority}" data-city="${escapeHtml(first.city)}" data-country="${escapeHtml(first.country)}"><div class="mx-card-photo-placeholder">${escapeHtml(first.city)}</div></div>
      <div data-mx-photo data-priority="${priority}" data-city="${escapeHtml(second.city)}" data-country="${escapeHtml(second.country)}"><div class="mx-card-photo-placeholder">${escapeHtml(second.city)}</div></div>
      <span class="mx-label">${escapeHtml(item.label)}</span>
    </div>`;
  }

  function singleHref(item) {
    const params = new URLSearchParams(query);
    params.set('mode', 'single');
    params.set('origin', Origins.label ? Origins.label(origin) : query.get('origin'));
    params.set('city', item.city);
    params.set('country', item.country);
    params.set('code', item.code || '');
    params.set('budget', String(Math.round(item.sourceBudgetTotal || displayBudget)));
    params.set('currency', currency);
    params.set('reserve', String(Math.round(item.reserveAmount || 0)));
    params.set('nights', String(item.nights));
    params.set('passengers', String(passengers));
    params.set('total', String(Math.round(item.total)));
    params.set('flight', String(Math.round(item.flight)));
    params.set('stay', String(Math.round(item.stay)));
    params.set('remaining', String(Math.round(Math.max(0, item.remaining))));
    params.set('label', item.label);
    params.set('returnTo', `mixed-results.html?${query.toString()}`);
    return `trip.html?${params.toString()}`;
  }

  function multiHref(item) {
    const params = new URLSearchParams(query);
    params.set('mode', 'multi');
    params.set('origin', Origins.label ? Origins.label(origin) : query.get('origin'));
    params.set('budget', String(displayBudget));
    params.set('currency', currency);
    params.set('nights', String(item.nights));
    params.set('cities', String(item.tour.cities.length));
    params.set('routeId', item.tour.routeId);
    params.set('returnTo', `mixed-results.html?${query.toString()}`);
    return `multicity-visualizer.html?${params.toString()}`;
  }

  function cardMarkup(item, index, compact = false) {
    const title = item.kind === 'single' ? `${item.city}, ${item.country}` : item.title;
    const path = item.kind === 'single' ? `${origin.city} → ${item.city}` : item.routePath;
    const type = item.kind === 'single' ? 'Single destination' : `${item.cities.length}-city route`;
    const chips = item.kind === 'single'
      ? item.themes.slice(0, 3)
      : item.cities.slice(0, 3).map((city) => city.city);
    const href = item.kind === 'single' ? singleHref(item) : multiHref(item);
    const buttonText = item.kind === 'single' ? 'View trip details' : 'View route details';
    const routeNote = item.kind === 'multi'
      ? '<div class="mx-route-note">Connections and city nights included.</div>'
      : '';
    const className = compact ? 'mx-card mx-alt-card' : 'mx-card mx-primary-card';
    return `<article class="${className}${item.featured ? ' is-featured' : ''}" data-mx-id="${escapeHtml(item.id)}">
      <a class="mx-card-hitarea" href="${escapeHtml(href)}" data-mx-open="${escapeHtml(item.id)}" aria-label="${escapeHtml(buttonText)} for ${escapeHtml(title)}"></a>
      ${item.featured ? '<span class="mx-feature-ribbon">Globevoy Pick</span>' : ''}
      ${photoMarkup(item, index < 3 ? 'high' : 'low')}
      <div class="mx-card-body">
        <div class="mx-card-top">
          <div class="mx-card-heading">
            <span class="mx-type">${escapeHtml(type)} · ${escapeHtml(String(item.nights))} nights</span>
            <h3>${escapeHtml(title)}</h3>
            <div class="mx-route-path">${escapeHtml(path)}</div>
          </div>
          <div class="mx-price-block">
            <span>Estimated trip</span>
            <strong>${formatMoney(item.total)}</strong>
          </div>
        </div>
        <div class="mx-chip-row">${chips.map((chip) => `<span class="mx-chip">${escapeHtml(chip)}</span>`).join('')}</div>
        ${routeNote}
        <div class="mx-card-bottom">
          <span class="mx-card-cta" aria-hidden="true">${buttonText} →</span>
        </div>
      </div>
    </article>`;
  }

  async function hydratePhoto(element) {
    const city = element.dataset.city;
    const country = element.dataset.country;
    const fallback = element.dataset.fallback || '';
    let url = fallback;
    try {
      if (window.GlobevoyCityImages) {
        const response = await window.GlobevoyCityImages.get(city, country, fallback);
        url = response.images?.[0] || fallback;
      }
    } catch (_) {}
    if (!url) return;
    const image = new Image();
    image.alt = `${city}, ${country}`;
    image.loading = element.dataset.priority === 'high' ? 'eager' : 'lazy';
    image.fetchPriority = element.dataset.priority === 'high' ? 'high' : 'auto';
    image.decoding = 'async';
    image.onload = () => {
      element.querySelector('.mx-card-photo-placeholder')?.remove();
      element.prepend(image);
    };
    image.onerror = () => {};
    image.src = url;
  }

  function saveSelection(item) {
    if (!item) return;
    try {
      if (item.kind === 'single') {
        sessionStorage.setItem('gv-selected-offer', JSON.stringify({
          ...item.raw,
          city: item.city,
          country: item.country,
          code: item.code,
          lat: item.lat,
          lng: item.lng,
          flight: item.flight,
          stay: item.stay,
          total: item.total,
          nights: item.nights,
          why: item.why,
          themes: item.themes,
          _label: item.label
        }));
      } else {
        sessionStorage.setItem('globevoy.multi.selected.v1', JSON.stringify(item.tour));
      }
    } catch (_) {}
  }

  // GV-ROUTE-620A-FE1-R1: prefer authoritative backend route coordinates and prevent stale/global map arcs.
  function validMapPoint(value, metadata = {}) {
    const lat = Number(value?.lat ?? value?.latitude);
    const lng = Number(value?.lng ?? value?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng, ...metadata };
  }

  function backendRoutePoints(item) {
    const source = item?.backendTour?.mapCoordinates;
    if (item?.kind !== 'multi' || !Array.isArray(source) || source.length < 2) return [];
    let stopNumber = 0;
    return source.map((entry, index) => {
      const type = String(entry?.type || '').toLowerCase();
      if (type === 'stop') stopNumber += 1;
      return validMapPoint(entry, {
        label: entry?.city || (type === 'origin' || type === 'return' ? origin.city : `Stop ${stopNumber || index}`),
        cityId: entry?.cityId || '',
        origin: type === 'origin',
        returnPoint: type === 'return',
        stopNumber: type === 'stop' ? stopNumber : null,
        source: 'backend-map-coordinates'
      });
    }).filter(Boolean);
  }

  function backendLegRoutePoints(item) {
    const legs = item?.backendTour?.legs || item?.tour?.backendLegs;
    if (item?.kind !== 'multi' || !Array.isArray(legs) || !legs.length) return [];
    const points = [];
    const first = legs[0]?.from;
    const firstPoint = validMapPoint(first, {
      label: first?.city || origin.city,
      cityId: first?.cityId || '',
      origin: true,
      returnPoint: false,
      stopNumber: null,
      source: 'backend-route-legs'
    });
    if (firstPoint) points.push(firstPoint);
    let stopNumber = 0;
    legs.forEach((leg, index) => {
      const destination = leg?.to;
      const isReturn = index === legs.length - 1;
      if (!isReturn) stopNumber += 1;
      const point = validMapPoint(destination, {
        label: destination?.city || (isReturn ? origin.city : `Stop ${stopNumber}`),
        cityId: destination?.cityId || '',
        origin: false,
        returnPoint: isReturn,
        stopNumber: isReturn ? null : stopNumber,
        source: 'backend-route-legs'
      });
      if (point) points.push(point);
    });
    return points;
  }

  function routePoints(item) {
    const authoritative = backendRoutePoints(item);
    if (authoritative.length >= 2) return authoritative;
    const fromLegs = backendLegRoutePoints(item);
    if (fromLegs.length >= 2) return fromLegs;

    const points = [];
    const originPoint = coordinates(origin);
    if (originPoint) points.push({ ...originPoint, label: origin.city, origin: true, returnPoint: false, stopNumber: null, source: 'frontend-fallback' });
    if (item.kind === 'single') {
      const point = coordinates(item);
      if (point) points.push({ ...point, label: item.city, origin: false, returnPoint: false, stopNumber: null, source: 'frontend-fallback' });
    } else {
      item.cities.forEach((city, index) => {
        const point = coordinates(city);
        if (point) points.push({ ...point, label: city.city, origin: false, returnPoint: false, stopNumber: index + 1, source: 'frontend-fallback' });
      });
      if (originPoint) points.push({ ...originPoint, label: origin.city, origin: false, returnPoint: true, stopNumber: null, source: 'frontend-fallback' });
    }
    return points;
  }

  function uniqueMarkerPoints(points) {
    const seen = new Set();
    return points.filter((point) => {
      const key = point.cityId || `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
      if (point.returnPoint && seen.has(key)) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function routeSpanKm(points) {
    let maximum = 0;
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        maximum = Math.max(maximum, distanceKm(points[first], points[second]));
      }
    }
    return maximum;
  }

  function clearMapOverlays() {
    state.mapOverlays.forEach((overlay) => overlay.setMap?.(null));
    state.mapOverlays = [];
    state.infoWindow?.close();
  }

  function markerIcon(index, isOrigin) {
    return {
      path: google.maps.SymbolPath.CIRCLE,
      scale: isOrigin ? 9 : 10,
      fillColor: isOrigin ? '#071c33' : index === 1 ? '#ffb51b' : '#008f89',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 3
    };
  }

  function updateMapFallback(item) {
    const title = item.kind === 'single'
      ? `${origin.city} to ${item.city}`
      : item.routePath;
    $('#mx-map-fallback-title').textContent = title;
    $('#mx-map-fallback-copy').textContent = state.mapFailed
      ? 'The interactive map is unavailable, but the selected route remains available in the recommendation card.'
      : 'Loading the selected route map…';
  }

  function updateMapSummary(item) {
    const title = item.kind === 'single' ? `${item.city}, ${item.country}` : item.title;
    $('#mx-map-title').textContent = item.kind === 'single' ? 'Destination preview' : 'Route preview';
    $('#mx-map-selected').textContent = title;
    $('#mx-map-total').textContent = formatMoney(item.total);
    updateMapFallback(item);
  }

  function drawSelectedRoute(item) {
    updateMapSummary(item);
    const pathPoints = routePoints(item);
    if (!state.mapReady || !state.map || !pathPoints.length) return;

    const drawSerial = ++state.mapDrawSerial;
    clearMapOverlays();
    const markerPoints = uniqueMarkerPoints(pathPoints);
    const bounds = new google.maps.LatLngBounds();
    markerPoints.forEach((point, index) => {
      bounds.extend({ lat: point.lat, lng: point.lng });
      const marker = new google.maps.Marker({
        map: state.map,
        position: { lat: point.lat, lng: point.lng },
        title: point.label,
        label: item.kind === 'multi' && point.stopNumber
          ? { text: String(point.stopNumber), color: '#ffffff', fontWeight: '800' }
          : undefined,
        icon: markerIcon(index, point.origin)
      });
      marker.addListener('click', () => {
        state.infoWindow.setContent(`<div class="mx-map-popup"><strong>${escapeHtml(point.label)}</strong><span>${escapeHtml(item.kind === 'single' ? 'Selected destination' : point.origin ? 'Starting city' : 'Route stop')}</span></div>`);
        state.infoWindow.open({ map: state.map, anchor: marker });
      });
      state.mapOverlays.push(marker);
    });

    const spanKm = routeSpanKm(markerPoints);
    if (pathPoints.length > 1) {
      const routeLine = new google.maps.Polyline({
        map: state.map,
        path: pathPoints.map((point) => ({ lat: point.lat, lng: point.lng })),
        geodesic: spanKm >= 1500,
        strokeColor: '#08a8a0',
        strokeOpacity: 0.95,
        strokeWeight: 4
      });
      state.mapOverlays.push(routeLine);
    }

    google.maps.event.trigger(state.map, 'resize');
    state.map.fitBounds(bounds, { top: 54, right: 44, bottom: 54, left: 44 });
    google.maps.event.addListenerOnce(state.map, 'idle', () => {
      if (drawSerial !== state.mapDrawSerial) return;
      const zoom = Number(state.map.getZoom() || 0);
      if (zoom > 7) state.map.setZoom(7);
      if (item.kind === 'multi' && spanKm > 0 && spanKm < 800 && zoom < 5) state.map.setZoom(5);
      else if (item.kind === 'multi' && spanKm >= 800 && spanKm < 1500 && zoom < 4) state.map.setZoom(4);
    });
  }

  function mapFailure() {
    state.mapFailed = true;
    state.mapReady = false;
    $('#mx-map').hidden = true;
    $('#mx-map-fallback').hidden = false;
    const selected = state.results.find((item) => item.id === state.selectedId);
    if (selected) updateMapFallback(selected);
  }

  function initMap() {
    if (state.mapReady) return;
    state.mapReady = true;
    state.mapFailed = false;
    if (state.mapLoadTimer) clearTimeout(state.mapLoadTimer);
    $('#mx-map').hidden = false;
    $('#mx-map-fallback').hidden = true;
    state.infoWindow = new google.maps.InfoWindow();
    const start = coordinates(origin) || { lat: 20, lng: 0 };
    state.map = new google.maps.Map($('#mx-map'), {
      center: start,
      zoom: 3,
      minZoom: 2,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: 'cooperative',
      backgroundColor: '#dbeef3',
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] }
      ]
    });
    const selected = state.results.find((item) => item.id === state.selectedId);
    if (selected) drawSelectedRoute(selected);
  }

  function loadMap() {
    const key = String(window.GLOBEVOY_CONFIG?.googleMapsApiKey || '').trim();
    if (!key) {
      mapFailure();
      return;
    }
    if (window.google?.maps) {
      initMap();
      return;
    }
    window.gm_authFailure = mapFailure;
    const callback = `__gv542bR1Map${Date.now()}`;
    window[callback] = () => {
      delete window[callback];
      initMap();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = mapFailure;
    document.head.appendChild(script);
    state.mapLoadTimer = setTimeout(() => {
      if (!state.mapReady) mapFailure();
    }, 12000);
  }

  function selectResult(id, options = {}) {
    const item = state.results.find((result) => result.id === id);
    if (!item) return;
    state.selectedId = id;
    $$('.mx-card.is-selected').forEach((card) => card.classList.remove('is-selected'));
    document.querySelector(`[data-mx-id="${CSS.escape(id)}"]`)?.classList.add('is-selected');
    updateMapSummary(item);
    if (state.mapReady) drawSelectedRoute(item);
    if (options.openMap && innerWidth <= 900) openMapPanel();
  }

  function openMapPanel() {
    $('#mx-map-panel').classList.add('is-open');
    $('#mx-map-toggle').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      if (state.mapReady) google.maps.event.trigger(state.map, 'resize');
      const selected = state.results.find((item) => item.id === state.selectedId);
      if (selected && state.mapReady) drawSelectedRoute(selected);
    }, 80);
  }

  function closeMapPanel() {
    $('#mx-map-panel').classList.remove('is-open');
    $('#mx-map-toggle').setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function render(items) {
    state.results = items;
    $('#mx-loading').hidden = true;
    if (!items.length) {
      showError('No single-destination or connected route met the current budget and evidence rules. Try a higher budget, broader region or flexible timing.');
      return;
    }
    $('#mx-error').hidden = true;
    $('#mx-results').hidden = false;
    const primary = items.slice(0, 3);
    const more = items.slice(3, 6);
    $('#mx-primary-copy').textContent = `${primary.length} distinct option${primary.length === 1 ? '' : 's'} for this search.`;
    $('#mx-primary-grid').innerHTML = primary.map((item, index) => cardMarkup(item, index, false)).join('');
    $('#mx-more-section').hidden = !more.length;
    $('#mx-more-grid').innerHTML = more.map((item, index) => cardMarkup(item, index + 3, true)).join('');
    $$('[data-mx-photo]').forEach(hydratePhoto);
    $$('[data-mx-id]').forEach((card) => {
      const preview = () => selectResult(card.dataset.mxId, { openMap: false });
      card.addEventListener('mouseenter', preview);
      card.addEventListener('focusin', preview);
    });

    const defaultSelection = primary.find((item) => item.featured) || primary[0];
    if (defaultSelection) selectResult(defaultSelection.id);
    loadMap();
  }

  function showError(message) {
    $('#mx-loading').hidden = true;
    $('#mx-results').hidden = true;
    $('#mx-error').hidden = false;
    $('#mx-error-copy').textContent = message || 'The recommendation request failed.';
  }

  async function load() {
    const serial = ++state.loadSerial;
    $('#mx-loading').hidden = false;
    $('#mx-error').hidden = true;
    $('#mx-results').hidden = true;
    if (!origin) {
      showError('Choose a supported starting city on the homepage.');
      return;
    }
    try {
      const [singles, multis] = await Promise.all([getSingles(), getMultis()]);
      if (serial !== state.loadSerial) return;
      render(pickResults(singles, multis));
    } catch (error) {
      if (serial !== state.loadSerial) return;
      console.error(error);
      showError(error.message || 'The recommendation request failed.');
    }
  }

  function fillSelect(selector, minimum, maximum, selectedValue) {
    const element = $(selector);
    for (let value = minimum; value <= maximum; value += 1) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = String(value);
      element.appendChild(option);
    }
    element.value = String(selectedValue);
  }

  function setupEdit() {
    const values = {
      origin: Origins.label ? Origins.label(origin) : query.get('origin'),
      budget: String(displayBudget),
      nights: tripLength === 'auto' ? 'auto' : String(requestedNights),
      interests: interests[0] || 'No preference',
      hotelStyle,
      region
    };
    Object.entries(values).forEach(([key, value]) => {
      const selector = `#mx-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
      const element = $(selector);
      if (element) element.value = value;
    });
    fillSelect('#mx-adults', 1, 12, adults);
    fillSelect('#mx-children', 0, 12, children);

    const open = () => {
      $('#mx-edit-panel').hidden = false;
      $('#mx-edit-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const close = () => { $('#mx-edit-panel').hidden = true; };
    $('#mx-edit-open').onclick = open;
    $('#mx-edit-close').onclick = close;
    $('#mx-edit-cancel').onclick = close;
    $('#mx-error-edit').onclick = open;

    $('#mx-edit-apply').onclick = () => {
      const selectedOrigin = Origins.find ? Origins.find($('#mx-origin').value, { allowPrefix: false }) : null;
      const amount = Number($('#mx-budget').value);
      $('#mx-edit-message').textContent = '';
      if (!selectedOrigin) {
        $('#mx-edit-message').textContent = 'Choose a supported starting city.';
        return;
      }
      if (!Number.isFinite(amount) || amount < 300) {
        $('#mx-edit-message').textContent = 'Enter a budget of at least 300.';
        return;
      }
      const params = new URLSearchParams(query);
      params.set('origin', Origins.label ? Origins.label(selectedOrigin) : $('#mx-origin').value);
      params.set('budget', String(Math.round(amount)));
      params.set('currency', Origins.currencyFor ? Origins.currencyFor(selectedOrigin, currency) : currency);
      params.set('adults', $('#mx-adults').value);
      params.set('children', $('#mx-children').value);
      params.set('passengers', String(Number($('#mx-adults').value) + Number($('#mx-children').value)));
      const selectedLength = $('#mx-nights').value;
      params.set('tripLength', selectedLength);
      if (selectedLength === 'auto') {
        params.delete('nights');
        params.delete('totalNights');
        params.set('adaptiveDuration', 'true');
      } else {
        params.set('nights', selectedLength);
        params.set('totalNights', selectedLength);
        params.set('adaptiveDuration', 'false');
      }
      params.set('interests', $('#mx-interests').value);
      params.set('hotelStyle', $('#mx-hotel-style').value);
      params.set('region', $('#mx-region').value);
      location.href = `mixed-results.html?${params.toString()}`;
    };
  }

  function addOriginList() {
    const list = document.createElement('datalist');
    list.id = 'mx-origin-list';
    (Origins.all ? Origins.all() : []).forEach((item) => {
      const option = document.createElement('option');
      option.value = Origins.label ? Origins.label(item) : `${item.city} (${item.code})`;
      list.appendChild(option);
    });
    document.body.appendChild(list);
    $('#mx-origin').setAttribute('list', 'mx-origin-list');
  }

  function setupSignInModal() {
    const modal = $('#mx-signin-modal');
    const authLink = document.querySelector('.gv-auth');
    if (!modal || !authLink) return;
    const returnTo = `mixed-results.html?${query.toString()}`;
    $('#mx-signin-link').href = `create-account.html?return=${encodeURIComponent(returnTo)}`;
    const open = (event) => {
      event?.preventDefault();
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    };
    const close = () => {
      modal.hidden = true;
      document.body.style.overflow = '';
    };
    authLink.addEventListener('click', open);
    $$('[data-mx-close-signin]').forEach((element) => element.addEventListener('click', close));
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-mx-open]');
    if (!link) return;
    const item = state.results.find((result) => result.id === link.dataset.mxOpen);
    saveSelection(item);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMapPanel();
      if (!$('#mx-edit-panel').hidden) $('#mx-edit-panel').hidden = true;
    }
  });

  $('#mx-map-toggle').onclick = openMapPanel;
  $('#mx-map-close').onclick = closeMapPanel;
  $('#mx-map-panel').addEventListener('click', (event) => {
    if (event.target === $('#mx-map-panel')) closeMapPanel();
  });
  $('#mx-retry').onclick = load;

  addOriginList();
  renderSummary();
  setupEdit();
  setupSignInModal();
  load();
})();
