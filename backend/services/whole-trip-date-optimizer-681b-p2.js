'use strict';

// GV-TRUST-681B-P2 — Whole-trip candidate date optimizer.
// This module is intentionally provider-agnostic and pure. It ranks only schedules
// whose flight legs all have exact-date provider observations. Hotel and ground
// amounts remain planning estimates unless their own exact-date evidence exists.

const WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2 = 'GV-TRUST-681B-P2';

function safeIsoDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addDaysIso(value, days) {
  const s = safeIsoDate(value);
  if (!s) return null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function dateDiffDays(a, b) {
  const aa = safeIsoDate(a);
  const bb = safeIsoDate(b);
  if (!aa || !bb) return null;
  return Math.round((new Date(`${aa}T12:00:00Z`) - new Date(`${bb}T12:00:00Z`)) / 86400000);
}

function stopNights(stop = {}) {
  const value = Number(stop.nights || stop.minimumSuggestedNights || 0);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 2;
}

function scheduleForStart({ startDate, stops = [], legCount = 0 } = {}) {
  const start = safeIsoDate(startDate);
  if (!start || !Number.isInteger(Number(legCount)) || Number(legCount) < 1) return [];
  const dates = [];
  let current = start;
  for (let index = 0; index < Number(legCount); index += 1) {
    dates.push(current);
    if (index < stops.length) current = addDaysIso(current, stopNights(stops[index]));
  }
  return dates;
}

function exactObservation(result = {}, targetDate) {
  const target = safeIsoDate(targetDate);
  if (!target) return null;
  const rows = Array.isArray(result.observations) ? result.observations : [];
  const exact = rows.filter(row => safeIsoDate(row?.departureDate) === target && Number(row?.price) > 0);
  if (!exact.length) return null;
  return exact.slice().sort((a, b) => Number(a.price) - Number(b.price)
    || Number(a.durationMinutes || Infinity) - Number(b.durationMinutes || Infinity)
    || Number(a.transfers || 0) - Number(b.transfers || 0))[0];
}

function candidateStartDates({ firstLegResult = {}, minimumDate, maximumShiftDays = 14 } = {}) {
  const min = safeIsoDate(minimumDate);
  if (!min) return [];
  const maxShift = Math.max(0, Math.min(30, Number.isFinite(Number(maximumShiftDays)) ? Math.round(Number(maximumShiftDays)) : 14));
  const rows = Array.isArray(firstLegResult.observations) ? firstLegResult.observations : [];
  const dates = new Set();
  for (const row of rows) {
    const d = safeIsoDate(row?.departureDate);
    const shift = dateDiffDays(d, min);
    if (d && shift !== null && shift >= 0 && shift <= maxShift && Number(row?.price) > 0) dates.add(d);
  }
  return [...dates].sort();
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function evaluateCandidate({
  startDate,
  stops = [],
  legs = [],
  providerResults = [],
  isFlightLeg = () => true,
  isGroundLeg = () => false,
  convertProviderPriceToUsd = value => Number(value || 0),
  flightFareUnits = 1,
  originAccessEstimateUsd = 0,
  destinationAccessEstimateUsd = 0,
  hotelEstimateUsd = 0,
  hotelPricing = null
} = {}) {
  const schedule = scheduleForStart({ startDate, stops, legCount: legs.length });
  if (!schedule.length) return null;

  let providerFlightTotalUsd = 0;
  let groundEstimateTotalUsd = 0;
  let providerFlightLegCount = 0;
  let requiredFlightLegCount = 0;
  let totalDurationMinutes = 0;
  let totalTransfers = 0;
  let limitedProviderLegs = 0;
  let cautionProviderLegs = 0;
  const legObservations = [];
  const missingFlightLegs = [];

  legs.forEach((leg, index) => {
    const targetDate = schedule[index] || null;
    if (isGroundLeg(leg)) {
      const estimate = finite(leg?.estimatedTransportUsd || leg?.amountUsd, 0);
      groundEstimateTotalUsd += estimate;
      legObservations[index] = null;
      return;
    }
    if (!isFlightLeg(leg)) {
      const estimate = finite(leg?.estimatedTransportUsd || leg?.amountUsd, 0);
      groundEstimateTotalUsd += estimate;
      legObservations[index] = null;
      return;
    }

    requiredFlightLegCount += 1;
    const observation = exactObservation(providerResults[index] || {}, targetDate);
    legObservations[index] = observation;
    if (!observation) {
      missingFlightLegs.push({ index, targetDate });
      return;
    }
    providerFlightLegCount += 1;
    const qualityStatus = String(observation.flightQualityStatus || '').toLowerCase();
    if (qualityStatus === 'limited-provider-options' || qualityStatus === 'severe') limitedProviderLegs += 1;
    if (qualityStatus === 'caution') cautionProviderLegs += 1;
    const unitUsd = finite(convertProviderPriceToUsd(observation.price, observation.currency, observation), 0);
    providerFlightTotalUsd += unitUsd * Math.max(0.1, finite(flightFareUnits, 1));
    totalDurationMinutes += Math.max(0, finite(observation.durationMinutes, 0));
    totalTransfers += Math.max(0, finite(observation.transfers, 0));
  });

  const completeProviderFlightCoverage = requiredFlightLegCount > 0 && providerFlightLegCount === requiredFlightLegCount;
  const resolvedHotelTotalUsd = hotelPricing && Number.isFinite(Number(hotelPricing.totalUsd))
    ? finite(hotelPricing.totalUsd, 0)
    : finite(hotelEstimateUsd, 0);
  const mixedEvidenceTotalUsd = Math.round(
    providerFlightTotalUsd
      + groundEstimateTotalUsd
      + finite(originAccessEstimateUsd, 0)
      + finite(destinationAccessEstimateUsd, 0)
      + resolvedHotelTotalUsd
  );

  return {
    version: WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2,
    startDate: safeIsoDate(startDate),
    schedule,
    legObservations,
    requiredFlightLegCount,
    providerFlightLegCount,
    completeProviderFlightCoverage,
    missingFlightLegs,
    providerFlightTotalUsd: Math.round(providerFlightTotalUsd),
    groundEstimateTotalUsd: Math.round(groundEstimateTotalUsd),
    hotelEstimateUsd: Math.round(resolvedHotelTotalUsd),
    hotelPricingBasis: hotelPricing?.basis || 'existing-planning-estimates-not-date-specific',
    stay22ExactMatchedStayCount: Math.max(0, Math.round(finite(hotelPricing?.exactMatchedStayCount, 0))),
    stay22RequiredStayCount: Math.max(0, Math.round(finite(hotelPricing?.requiredStayCount, 0))),
    stay22HotelEvidence: Array.isArray(hotelPricing?.evidence) ? hotelPricing.evidence : [],
    originAccessEstimateUsd: Math.round(finite(originAccessEstimateUsd, 0)),
    destinationAccessEstimateUsd: Math.round(finite(destinationAccessEstimateUsd, 0)),
    mixedEvidenceTotalUsd,
    totalDurationMinutes: Math.round(totalDurationMinutes),
    totalTransfers: Math.round(totalTransfers),
    limitedProviderLegs,
    cautionProviderLegs,
    qualityEligible: limitedProviderLegs === 0,
    evidencePolicy: hotelPricing?.basis === 'stay22-same-property-exact-stay-rates-plus-unmatched-planning-estimates'
      ? 'all flight legs require exact-date provider observations; confident exact-date same-property Stay22 rates may replace matching stay estimates; unmatched stays, ground and access remain planning estimates'
      : 'all flight legs require exact-date provider observations; hotel, ground and access amounts may remain planning estimates'
  };
}

function selectCandidate(candidates = [], { budgetCeilingUsd = Infinity } = {}) {
  const rows = (Array.isArray(candidates) ? candidates : [])
    .filter(Boolean)
    .filter(row => row.completeProviderFlightCoverage === true)
    .map(row => ({ ...row, budgetFit: !Number.isFinite(Number(budgetCeilingUsd)) || Number(row.mixedEvidenceTotalUsd) <= Number(budgetCeilingUsd) }));
  const budgetFit = rows.filter(row => row.budgetFit);
  const qualityEligible = rows.filter(row => row.qualityEligible !== false);
  const budgetFitQualityEligible = budgetFit.filter(row => row.qualityEligible !== false);
  // Never move the complete route to chase a severe/limited provider observation.
  // If all complete schedules are limited, P2 returns no selection and lets P1 keep
  // the canonical schedule with its existing limited-evidence warning.
  const pool = budgetFitQualityEligible.length ? budgetFitQualityEligible : (qualityEligible.length ? qualityEligible : []);
  if (!pool.length) return { selected: null, completeCandidateCount: rows.length, budgetFitCandidateCount: budgetFit.length, qualityEligibleCandidateCount: 0, candidates: rows };
  const sorted = pool.slice().sort((a, b) => Number(a.mixedEvidenceTotalUsd) - Number(b.mixedEvidenceTotalUsd)
    || Number(a.cautionProviderLegs || 0) - Number(b.cautionProviderLegs || 0)
    || Number(a.totalDurationMinutes) - Number(b.totalDurationMinutes)
    || Number(a.totalTransfers) - Number(b.totalTransfers)
    || String(a.startDate).localeCompare(String(b.startDate)));
  return {
    selected: sorted[0],
    completeCandidateCount: rows.length,
    budgetFitCandidateCount: budgetFit.length,
    qualityEligibleCandidateCount: qualityEligible.length,
    candidates: rows
  };
}

module.exports = {
  WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2,
  safeIsoDate,
  addDaysIso,
  scheduleForStart,
  exactObservation,
  candidateStartDates,
  evaluateCandidate,
  selectCandidate
};
