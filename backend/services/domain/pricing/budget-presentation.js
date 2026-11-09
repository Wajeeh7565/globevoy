'use strict';

const PRESENTATION_VERSION = 'GV-MIXED-610C-1';
const SUPPORTED_CURRENCIES = new Set(['USD', 'CAD', 'AUD', 'EUR', 'GBP']);
const SYMBOLS = {
  USD: '$',
  CAD: 'C$',
  AUD: 'A$',
  EUR: '€',
  GBP: '£'
};

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCurrency(value) {
  const currency = String(value || 'USD').trim().toUpperCase();
  return SUPPORTED_CURRENCIES.has(currency) ? currency : 'USD';
}

function currencyToUsdRate(currency) {
  switch (normalizeCurrency(currency)) {
    case 'CAD': return finiteNumber(process.env.CAD_TO_USD, 0.735);
    case 'AUD': return finiteNumber(process.env.AUD_TO_USD, 0.66);
    case 'EUR': return 1.08;
    case 'GBP': return 1.27;
    default: return 1;
  }
}

function usdToCurrencyRate(currency) {
  return 1 / Math.max(0.000001, currencyToUsdRate(currency));
}

function roundMoney(value) {
  return Math.round(finiteNumber(value, 0));
}

function convertUsd(value, currency) {
  return roundMoney(finiteNumber(value, 0) * usdToCurrencyRate(currency));
}

function requestedBudgetAmount(query, totalBudgetUsd, currency) {
  const hasBudgetUsd = query && query.budgetUsd !== undefined && String(query.budgetUsd).trim() !== '';
  const hasBudget = query && query.budget !== undefined && String(query.budget).trim() !== '';
  if (!hasBudgetUsd && hasBudget) return roundMoney(query.budget);
  return convertUsd(totalBudgetUsd, currency);
}

function formatMoney(value, currency) {
  const normalized = normalizeCurrency(currency);
  return `${SYMBOLS[normalized]}${roundMoney(value).toLocaleString('en-US')}`;
}

function buildDisplayBudget({
  query = {},
  totalBudgetUsd,
  reservePercent = 0.10,
  flightUsd = 0,
  accommodationUsd = 0,
  tripUsd
}) {
  const currency = normalizeCurrency(query.currency);
  const totalBudget = requestedBudgetAmount(query, totalBudgetUsd, currency);
  const reserveAmount = roundMoney(totalBudget * finiteNumber(reservePercent, 0.10));
  const usableTripBudget = totalBudget - reserveAmount;
  const flightEstimate = convertUsd(flightUsd, currency);
  const accommodationEstimate = convertUsd(accommodationUsd, currency);
  const tripEstimate = tripUsd === undefined || tripUsd === null
    ? flightEstimate + accommodationEstimate
    : (flightEstimate + accommodationEstimate || convertUsd(tripUsd, currency));
  const amountLeft = usableTripBudget - tripEstimate;

  return {
    presentationVersion: PRESENTATION_VERSION,
    currency,
    symbol: SYMBOLS[currency],
    exchangeRateFromUsd: Number(usdToCurrencyRate(currency).toFixed(6)),
    totalBudget,
    reservePercent: finiteNumber(reservePercent, 0.10),
    reserveAmount,
    usableTripBudget,
    flightEstimate,
    accommodationEstimate,
    tripEstimate,
    amountLeft,
    affordabilityStatus: amountLeft >= 0 ? 'within-protected-budget' : 'over-protected-budget',
    equation: {
      formula: 'totalBudget - reserveAmount - tripEstimate = amountLeft',
      leftSide: totalBudget - reserveAmount - tripEstimate,
      rightSide: amountLeft,
      consistent: totalBudget - reserveAmount - tripEstimate === amountLeft
    }
  };
}

function buildSingleExplanation(city, nights, displayBudget, evidenceText = '') {
  const trip = formatMoney(displayBudget.tripEstimate, displayBudget.currency);
  const flight = formatMoney(displayBudget.flightEstimate, displayBudget.currency);
  const stay = formatMoney(displayBudget.accommodationEstimate, displayBudget.currency);
  const left = formatMoney(Math.max(0, displayBudget.amountLeft), displayBudget.currency);
  const reserve = formatMoney(displayBudget.reserveAmount, displayBudget.currency);
  return `${city} fits the protected budget because the flight and stay estimate is about ${trip} (${flight} flight and ${stay} stay for ${nights} nights), leaving about ${left} inside the 90% trip-planning budget. The full ${reserve} personal-expense reserve remains untouched.${evidenceText}`;
}

function attachRecommendationPresentation(recommendation, query = {}) {
  const displayBudget = buildDisplayBudget({
    query,
    totalBudgetUsd: recommendation.totalBudget,
    reservePercent: recommendation.reservePercent,
    flightUsd: recommendation.flightEstimate,
    accommodationUsd: recommendation.accommodationEstimate,
    tripUsd: recommendation.estimatedFlightAndStayTotal
  });
  const fallback = String(recommendation.dataSources?.flight || '').includes('fallback') ||
    String(recommendation.dataSources?.stay || '').includes('fallback');
  const evidenceText = fallback
    ? ' At least one price is a labelled planning fallback, not verified availability.'
    : ' Provider evidence is used, but final price and availability still require partner confirmation.';
  return {
    ...recommendation,
    displayBudget,
    displayWhyItFits: buildSingleExplanation(
      recommendation.city,
      recommendation.nights,
      displayBudget,
      evidenceText
    )
  };
}

function attachTourPresentation(tour, query = {}) {
  const displayBudget = buildDisplayBudget({
    query,
    totalBudgetUsd: tour.totalBudgetUsd,
    reservePercent: tour.reservePercent,
    flightUsd: tour.totalFlightEstimateUsd,
    accommodationUsd: tour.totalHotelEstimateUsd,
    tripUsd: tour.estimatedTotalUsd
  });
  return {
    ...tour,
    displayBudget
  };
}

function presentationPolicy() {
  return {
    version: PRESENTATION_VERSION,
    rule: 'total budget minus 10% protected reserve minus flight and accommodation estimate equals amount left',
    sourceOfTruth: 'displayBudget',
    legacyUsdFieldsPreserved: true,
    rounding: 'whole requested-currency units; displayed flight plus displayed accommodation equals displayed trip estimate'
  };
}

module.exports = {
  PRESENTATION_VERSION,
  normalizeCurrency,
  currencyToUsdRate,
  usdToCurrencyRate,
  convertUsd,
  formatMoney,
  buildDisplayBudget,
  attachRecommendationPresentation,
  attachTourPresentation,
  presentationPolicy
};
