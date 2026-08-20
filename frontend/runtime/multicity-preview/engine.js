(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./link-builders'));
  } else {
    root.GlobevoyMehdiEngine = factory(root.GlobevoyMehdiLinks);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (links) {
  'use strict';

  const RESERVE_PERCENT = 0.10;
  const ALLOWED_NIGHTS = [7, 9, 11];
  const SOURCE_LABELS = {
    replay: 'Provider replay — not current availability.',
    cached: 'Recently cached estimate — recheck before booking.',
    estimated: 'Estimated flight range — not live availability.',
    unavailable: 'Unavailable — confirmation is still required.',
    'validated-live': 'Validated live result — prices can still change.'
  };

  function round2(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
  function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(days));
    return date.toISOString().slice(0, 10);
  }
  function dateDiff(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function normalizeInput(raw, data) {
    const originCode = String(raw.originCode || 'YYZ').toUpperCase();
    const origin = (data.origins || []).find((item) => item.code === originCode);
    if (!origin) throw new Error('Origin must be Toronto/YYZ or New York/NYC.');
    const currency = String(raw.currency || 'CAD').toUpperCase();
    if (!(data.supportedCurrencies || []).includes(currency)) throw new Error('Unsupported currency.');
    const totalBudget = Number(raw.totalBudget);
    if (!Number.isFinite(totalBudget) || totalBudget <= 0) throw new Error('A positive total budget is required.');
    const totalNights = Number(raw.totalNights);
    if (!ALLOWED_NIGHTS.includes(totalNights)) throw new Error('Trip duration must be 7, 9 or 11 nights.');
    const preferredMonth = String(raw.preferredMonth || '');
    if (!/^\d{4}-\d{2}$/.test(preferredMonth)) throw new Error('A valid travel month (YYYY-MM) is required.');
    return {
      originCity: origin.city,
      originCode: origin.code,
      totalBudget: round2(totalBudget),
      currency,
      preferredMonth,
      totalNights,
      flexibleDates: raw.flexibleDates !== false,
      adults: 1,
      cabin: 'economy'
    };
  }

  function planNights(records, totalNights) {
    const allocations = records.map(() => 2);
    const mins = records.map((record) => Number(record.recommendedMinNights || 2));
    const maxs = records.map((record) => Number(record.recommendedMaxNights || Math.max(2, totalNights)));
    let remaining = totalNights - allocations.reduce((sum, value) => sum + value, 0);
    while (remaining > 0 && allocations.some((value, index) => value < mins[index])) {
      let bestIndex = -1;
      let bestNeed = -Infinity;
      records.forEach((record, index) => {
        const need = mins[index] - allocations[index] + (record.primaryGroup === 'group1' ? 0.25 : 0);
        if (allocations[index] < mins[index] && need > bestNeed) { bestNeed = need; bestIndex = index; }
      });
      if (bestIndex < 0) break;
      allocations[bestIndex] += 1;
      remaining -= 1;
    }
    while (remaining > 0 && allocations.some((value, index) => value < maxs[index])) {
      let bestIndex = -1;
      let bestRoom = -Infinity;
      records.forEach((record, index) => {
        const room = maxs[index] - allocations[index] + (record.primaryGroup === 'group1' ? 0.35 : 0);
        if (allocations[index] < maxs[index] && room > bestRoom) { bestRoom = room; bestIndex = index; }
      });
      if (bestIndex < 0) break;
      allocations[bestIndex] += 1;
      remaining -= 1;
    }
    let cursor = 0;
    while (remaining > 0) { allocations[cursor % allocations.length] += 1; cursor += 1; remaining -= 1; }
    const minimumShortfall = allocations.reduce((sum, nights, index) => sum + Math.max(0, mins[index] - nights), 0);
    return {
      valid: allocations.reduce((sum, value) => sum + value, 0) === totalNights,
      minimumShortfall,
      allocations: records.map((record, index) => ({
        id: record.id,
        city: record.city,
        nights: allocations[index],
        recommendedMinNights: mins[index],
        recommendedMaxNights: maxs[index]
      }))
    };
  }

  function buildStayTimeline(records, allocationPlan, departureDate) {
    let current = departureDate;
    return allocationPlan.allocations.map((allocation, index) => {
      const checkIn = current;
      const checkOut = addDays(checkIn, allocation.nights);
      current = checkOut;
      return {
        ...allocation,
        country: records[index].country,
        agodaCityId: records[index].agodaCityId,
        airportCode: records[index].primaryAirportCode,
        checkIn,
        checkOut
      };
    });
  }

  function expandWindows(baseWindow, flexibleDates) {
    const variants = flexibleDates
      ? [
          { id: 'early', shift: -7, multiplier: 1.035, note: 'Earlier deterministic planning window' },
          { id: 'reviewed', shift: 0, multiplier: 1, note: 'Reviewed deterministic planning window' },
          { id: 'late', shift: 7, multiplier: 1.025, note: 'Later deterministic planning window' }
        ]
      : [{ id: 'reviewed', shift: 0, multiplier: 1, note: 'Reviewed deterministic planning window' }];
    return variants.map((variant) => ({
      ...baseWindow,
      variantId: variant.id,
      departureDate: addDays(baseWindow.departureDate, variant.shift),
      returnDate: addDays(baseWindow.returnDate, variant.shift),
      outboundFlightEstimateUsd: round2(baseWindow.outboundFlightEstimateUsd * variant.multiplier),
      returnFlightEstimateUsd: round2(baseWindow.returnFlightEstimateUsd * variant.multiplier),
      intercityTransportEstimateUsd: round2(baseWindow.intercityTransportEstimateUsd * (variant.id === 'reviewed' ? 1 : 1.01)),
      variantNote: variant.note
    }));
  }

  function replayFlightFor(data, routeId, nights, window, input) {
    if (input.originCode !== 'YYZ' || window.variantId !== 'reviewed') return null;
    const response = data.replayIndex[`${routeId}|${nights}|flight`];
    if (!response || response.request.departureDate !== window.departureDate || response.request.returnDate !== window.returnDate) return null;
    const rows = response.response && response.response.data && response.response.data.prices_one_way;
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const outbound = rows.find((row) => row.direction === 'outbound');
    const returning = rows.find((row) => row.direction === 'return');
    if (!outbound || !returning) return null;
    const toUsd = { CAD: 0.735, USD: 1, EUR: 1.08, GBP: 1.27, AUD: 0.66 };
    return {
      sourceStatus: 'replay',
      sourceLabel: SOURCE_LABELS.replay,
      confidence: 'medium',
      outboundUsd: round2(Number(outbound.value) * (toUsd[String(outbound.currency).toUpperCase()] || 1)),
      returnUsd: round2(Number(returning.value) * (toUsd[String(returning.currency).toUpperCase()] || 1)),
      originalCurrency: String(outbound.currency || 'CAD').toUpperCase(),
      retrievedAt: response.retrievedAt,
      limitations: ['Sanitized provider-shaped replay; not a current fare or availability result.']
    };
  }

  function component(amountUsd, input, data, sourceStatus, confidence, note, sourceLabelOverride) {
    const displayRate = Number(data.displayCurrencyPerUsd[input.currency]);
    return {
      amountUsd: round2(amountUsd),
      amount: round2(amountUsd * displayRate),
      currency: input.currency,
      sourceStatus,
      sourceLabel: sourceLabelOverride || SOURCE_LABELS[sourceStatus] || SOURCE_LABELS.estimated,
      confidence,
      note
    };
  }

  function affordabilityPoints(total, usable) {
    if (total > usable) return 0;
    const ratio = total / usable;
    if (ratio <= 0.55) return 23;
    if (ratio <= 0.78) return 28;
    if (ratio <= 0.92) return 25;
    return 18;
  }

  function scoreCandidate(route, records, totalCoreUsd, usableUsd, allocationPlan, flightStatus) {
    const transportPoints = { rail: 10, road: 9, ferry: 8, 'short flight': 7, 'regional flight': 6 };
    const providerPoints = { high: 5, medium: 4, 'medium-low': 2.5, low: 1 };
    const transport = route.intercityLegs.reduce((sum, leg) => sum + (transportPoints[leg.transportType] || 4), 0) / route.intercityLegs.length;
    const provider = records.reduce((sum, record) => sum + (providerPoints[record.providerConfidence] || 1), 0) / records.length * 2;
    const durationFit = Math.max(0, 8 - allocationPlan.minimumShortfall * 1.5);
    const variety = route.familiarityTier === 'discovery' ? 8 : route.familiarityTier === 'balanced' ? 7 : 5;
    const source = flightStatus === 'replay' ? 4 : 2.5;
    const breakdown = {
      affordability: affordabilityPoints(totalCoreUsd, usableUsd),
      routePracticality: Number(route.routeCoherenceScore) * 3.6,
      pairingConfidence: route.pairingConfidence === 'high' ? 10 : 7,
      transportFeasibility: transport,
      providerConfidence: provider,
      tripDurationFit: durationFit,
      recommendationVariety: variety,
      surpriseValue: Number(route.surpriseScore) * 1.6,
      sourceConfidence: source
    };
    return { total: round2(Object.values(breakdown).reduce((sum, value) => sum + value, 0)), breakdown };
  }

  function makeCandidate(route, baseWindow, input, data, recordMap) {
    const records = route.citySequence.map((id) => recordMap.get(id));
    if (records.some((record) => !record)) return null;
    const allocationPlan = planNights(records, input.totalNights);
    if (!allocationPlan.valid) return null;
    if (allocationPlan.minimumShortfall > 0) {
      return {
        rejected: 'minimum-shortfall',
        minimumShortfall: allocationPlan.minimumShortfall,
        allocations: allocationPlan.allocations
      };
    }
    const stays = buildStayTimeline(records, allocationPlan, baseWindow.departureDate);
    if (stays.at(-1).checkOut !== baseWindow.returnDate) return null;
    if (dateDiff(baseWindow.departureDate, baseWindow.returnDate) !== input.totalNights) return null;

    const replay = replayFlightFor(data, route.routeId, input.totalNights, baseWindow, input);
    const outboundUsd = replay ? replay.outboundUsd : Number(baseWindow.outboundFlightEstimateUsd);
    const returnUsd = replay ? replay.returnUsd : Number(baseWindow.returnFlightEstimateUsd);
    const flightMidUsd = round2(outboundUsd + returnUsd);
    const flightLowUsd = round2(flightMidUsd * 0.92);
    const flightHighUsd = round2(flightMidUsd * 1.08);
    const accommodationUsd = round2(stays.reduce((sum, stay) => sum + stay.nights * Number(route.accommodationNightlyEstimatesUsd[stay.id]), 0));
    const intercityUsd = round2(Number(baseWindow.intercityTransportEstimateUsd));
    const coreTotalUsd = round2(flightMidUsd + accommodationUsd + intercityUsd);
    const displayRate = Number(data.displayCurrencyPerUsd[input.currency]);
    const personalReserveDisplay = round2(input.totalBudget * RESERVE_PERCENT);
    const usableCoreBudgetDisplay = round2(input.totalBudget - personalReserveDisplay);
    const budgetUsd = round2(input.totalBudget / displayRate);
    const reserveUsd = round2(personalReserveDisplay / displayRate);
    const usableUsd = round2(usableCoreBudgetDisplay / displayRate);
    if (coreTotalUsd > usableUsd) return { rejected: 'over-budget', coreTotalUsd, usableUsd };

    const anchorRoundTrip = route.intercityLegs.length >= 2 &&
      route.intercityLegs[route.intercityLegs.length - 1].toId === route.citySequence[0];
    const flightLink = links.buildAviasalesComplexRouteLink({
      originCode: input.originCode,
      anchorCode: records[0].primaryAirportCode,
      returnOriginCode: (anchorRoundTrip ? records[0] : records.at(-1)).primaryAirportCode,
      departureDate: baseWindow.departureDate,
      returnDate: baseWindow.returnDate,
      currency: input.currency,
      affiliateConfig: data.affiliateConfig.aviasales
    });
    const stayLinks = stays.map((stay) => ({
      city: stay.city,
      ...links.buildAgodaStayLink({
        agodaCityId: stay.agodaCityId,
        city: stay.city,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        currency: input.currency,
        affiliateConfig: data.affiliateConfig.agoda
      })
    }));
    if (stayLinks.some((link) => link.status !== 'available')) return null;

    const score = scoreCandidate(route, records, coreTotalUsd, usableUsd, allocationPlan, replay ? 'replay' : 'estimated');
    const reserve = {
      amountUsd: reserveUsd,
      amount: personalReserveDisplay,
      currency: input.currency,
      sourceStatus: 'estimated',
      sourceLabel: 'Budget policy — user-provided total.',
      confidence: 'high',
      note: 'Exactly 10% of the selected total budget.'
    };
    const usable = {
      amountUsd: usableUsd,
      amount: usableCoreBudgetDisplay,
      currency: input.currency,
      sourceStatus: 'estimated',
      sourceLabel: 'Budget policy — flight and accommodation allowance.',
      confidence: 'high',
      note: 'Exactly 90% of the selected total budget.'
    };
    const coreTotalDisplay = round2(coreTotalUsd * displayRate);
    const remaining = {
      amountUsd: round2(usableUsd - coreTotalUsd),
      amount: round2(usableCoreBudgetDisplay - coreTotalDisplay),
      currency: input.currency,
      sourceStatus: 'estimated',
      sourceLabel: 'Calculated budget remainder.',
      confidence: 'medium',
      note: 'Remaining room inside the 90% core budget.'
    };
    const flightSourceStatus = replay ? 'replay' : 'estimated';

    return {
      tourId: `mehdi-${route.routeId}-${input.originCode.toLowerCase()}-${input.totalNights}n-${baseWindow.variantId}`,
      routeId: route.routeId,
      anchorRoundTrip,
      title: records.map((record) => record.city).join(' + '),
      category: route.familiarityTier,
      origin: { city: input.originCity, code: input.originCode },
      cities: records.map((record) => ({ id: record.id, city: record.city, country: record.country, group: record.primaryGroup, airportCode: record.primaryAirportCode })),
      group1Anchor: records[0].id,
      group2Complements: records.slice(1).map((record) => record.id),
      departureDate: baseWindow.departureDate,
      returnDate: baseWindow.returnDate,
      totalNights: input.totalNights,
      totalDays: input.totalNights + 1,
      durationLabel: `${input.totalNights} nights / ${input.totalNights + 1} days`,
      stays,
      transferDates: stays.slice(0, -1).map((stay, index) => ({
        date: stay.checkOut,
        from: stay.city,
        to: stays[index + 1].city,
        transportType: route.intercityLegs[index].transportType
      })),
      budget: {
        total: { amountUsd: round2(budgetUsd), amount: input.totalBudget, currency: input.currency, sourceStatus: 'estimated', sourceLabel: 'User-provided budget.' },
        personalReserve: reserve,
        usableCoreBudget: usable,
        flightRange: {
          low: round2(flightLowUsd * displayRate),
          high: round2(flightHighUsd * displayRate),
          midpoint: round2(flightMidUsd * displayRate),
          currency: input.currency,
          sourceStatus: flightSourceStatus,
          sourceLabel: replay ? SOURCE_LABELS.replay : SOURCE_LABELS.estimated,
          confidence: replay ? 'medium' : 'low',
          originalCurrency: replay ? replay.originalCurrency : 'USD',
          limitations: replay ? replay.limitations : ['Deterministic planning estimate derived from the offline fixture; not a live fare.']
        },
        accommodation: component(accommodationUsd, input, data, replay ? 'replay' : 'estimated', replay ? 'medium' : 'low', replay ? 'Hotel-shaped replay supports this planning route; it is not current availability.' : 'Nightly planning estimates multiplied by exact allocated nights.', replay ? 'Sanitized accommodation replay — not current availability.' : 'Estimated accommodation total — not live availability.'),
        intercity: component(intercityUsd, input, data, 'estimated', 'low', 'Estimated transport plan — schedule and price require confirmation.', 'Estimated intercity transport — not a live schedule.'),
        estimatedCoreTotal: component(coreTotalUsd, input, data, flightSourceStatus, replay ? 'medium' : 'low', 'Flight midpoint + accommodation + intercity transport only.', replay ? 'Replay-supported core planning total — not current availability.' : 'Estimated core planning total — not live availability.'),
        remainingCoreRoom: remaining
      },
      transport: route.intercityLegs.map((leg, index) => ({
        from: recordMap.get(leg.fromId).city,
        to: recordMap.get(leg.toId).city,
        type: leg.transportType,
        date: stays[index].checkOut,
        status: 'estimated',
        label: 'Estimated transport plan — schedule and price require confirmation.'
      })),
      pairingConfidence: route.pairingConfidence,
      providerConfidence: records.every((record) => record.providerConfidence === 'high') ? 'high' : 'medium',
      sourceStatus: flightSourceStatus,
      sourceLabel: replay ? 'Replay-supported planning route' : 'Estimated planning route',
      score: score.total,
      scoreBreakdown: score.breakdown,
      whyCitiesWork: route.whyRouteWasIncluded,
      whyPractical: `${route.intercityLegs.map((leg) => leg.transportType).join(' + ')} connects the cities in a simple sequence with one international arrival and one open-jaw return.` ,
      whyInteresting: route.familiarityTier === 'familiar'
        ? 'A familiar route that builds trust while still adding a second city instead of repeating a single-city holiday.'
        : route.familiarityTier === 'balanced'
          ? 'A balanced option: recognisable enough to trust, but varied enough to feel more rewarding than one obvious stop.'
          : 'A more surprising pairing that stays geographically coherent instead of chasing novelty for its own sake.',
      priceWarning: 'Estimated flight range — not live availability.',
      comparisonNote: flightLink.status === 'manual-entry-required'
        ? 'Open the comparison site, then enter the two flight legs shown on this card.'
        : 'Current prices and availability will be checked on the flight comparison site.',
      flightHandoffStatus: flightLink.status,
      flightHandoff: flightLink,
      stayHandoffs: stayLinks,
      limitations: [
        'Internal product demo — no price is guaranteed.',
        'Flight comparison owns current pricing and availability.',
        'Intercity schedules and prices require confirmation.'
      ],
      fixtureVariant: baseWindow.variantId,
      fixtureVariantNote: baseWindow.variantNote
    };
  }

  function chooseDiverse(candidates, maxResults) {
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    const selected = [];
    const anchors = new Set();
    const countries = new Map();
    function add(candidate) {
      if (!candidate || anchors.has(candidate.group1Anchor)) return false;
      const country = candidate.cities[0].country;
      if ((countries.get(country) || 0) >= 2) return false;
      selected.push(candidate);
      anchors.add(candidate.group1Anchor);
      countries.set(country, (countries.get(country) || 0) + 1);
      return true;
    }
    add(sorted.find((candidate) => candidate.category === 'familiar'));
    add(sorted.find((candidate) => candidate.category === 'discovery' && !anchors.has(candidate.group1Anchor)));
    add(sorted.find((candidate) => candidate.category === 'balanced' && !anchors.has(candidate.group1Anchor)));
    for (const candidate of sorted.filter((item) => item.category === 'discovery')) {
      if (selected.length >= maxResults) break;
      add(candidate);
    }
    for (const candidate of sorted) {
      if (selected.length >= maxResults) break;
      add(candidate);
    }
    return selected.slice(0, maxResults).sort((a, b) => b.score - a.score);
  }

  function generateTours(rawInput, data) {
    const input = normalizeInput(rawInput, data);
    const recordMap = new Map(data.records.map((record) => [record.id, record]));
    const routeCandidates = [];
    const diagnostics = {
      reviewedRoutesAvailable: data.routes.length,
      routesMatchingMonth: 0,
      dateWindowsEvaluated: 0,
      validAffordableCandidates: 0,
      rejectedOverBudget: 0,
      rejectedMinimumNights: 0,
      rejectedValidation: 0,
      returnedTourCount: 0
    };

    for (const route of data.routes) {
      const base = route.windows.find((window) => window.origin === input.originCity && window.preferredMonth === input.preferredMonth && window.totalNights === input.totalNights);
      if (!base) continue;
      diagnostics.routesMatchingMonth += 1;
      const windows = expandWindows(base, input.flexibleDates);
      let best = null;
      for (const window of windows) {
        if (window.departureDate.slice(0, 7) !== input.preferredMonth) continue;
        diagnostics.dateWindowsEvaluated += 1;
        const candidate = makeCandidate(route, window, input, data, recordMap);
        if (!candidate) { diagnostics.rejectedValidation += 1; continue; }
        if (candidate.rejected === 'minimum-shortfall') { diagnostics.rejectedMinimumNights += 1; continue; }
        if (candidate.rejected === 'over-budget') { diagnostics.rejectedOverBudget += 1; continue; }
        diagnostics.validAffordableCandidates += 1;
        if (!best || candidate.score > best.score) best = candidate;
      }
      if (best) routeCandidates.push(best);
    }

    const requestedCount = routeCandidates.length >= 4 ? 4 : routeCandidates.length >= 3 ? 3 : routeCandidates.length;
    const tours = chooseDiverse(routeCandidates, requestedCount);
    diagnostics.returnedTourCount = tours.length;
    return {
      status: tours.length >= 3 ? 'demo-ready' : tours.length ? 'limited-results' : 'no-affordable-tours',
      warning: 'Internal Globevoy demo — planning fixtures and replays are not live booking quotes.',
      input,
      budgetPolicy: { personalExpenseReservePercent: RESERVE_PERCENT, usableCoreBudgetPercent: 0.90 },
      diagnostics,
      candidatePoolSize: routeCandidates.length,
      tours,
      explanation: tours.length >= 3
        ? `Evaluated ${diagnostics.dateWindowsEvaluated} private route/date candidates and returned only ${tours.length} diverse recommendations.`
        : `Only ${tours.length} reviewed route(s) fit the selected month, duration and usable 90% budget. No hidden date or price substitution was made.`
    };
  }

  return { RESERVE_PERCENT, ALLOWED_NIGHTS, SOURCE_LABELS, generateTours, normalizeInput, planNights, addDays, dateDiff };
});
