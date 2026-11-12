'use strict';
const { notExpired683D } = require('./duffel-live-adapter-683d');
function isDuffelEvidence(evidence = {}) { return /^duffel(?:-|$)/i.test(String(evidence.source || '')); }
function usableDuffelEvidence(evidence = {}, request = {}, nowMs = Date.now()) {
  if (!notExpired683D(evidence.expiresAt, nowMs) || evidence.liveMode !== true ||
      evidence.sourceType !== 'LIVE' || evidence.productionEligible !== true ||
      evidence.appliedToEstimate === false || evidence.fareAmountBasis !== 'party-total') return false;
  const amount = Number(evidence.providerPartyTotalAmount ?? evidence.totalPrice ?? evidence.price);
  if (!(amount > 0) || !Number.isFinite(amount) || !/^[A-Z]{3}$/.test(evidence.providerCurrency || evidence.currency || '')) return false;
  if (request.currency && (evidence.displayCurrency || evidence.currency || evidence.providerCurrency) !== request.currency) return false;
  for (const field of ['origin','destination','departureDate']) {
    const actual = field === 'origin' ? evidence.resolvedOrigin || evidence.origin
      : field === 'destination' ? evidence.resolvedDestination || evidence.destination : evidence.departureDate;
    if (!actual || (request[field] && actual !== request[field])) return false;
    if (field !== 'departureDate' && !/^[A-Z]{3}$/.test(actual)) return false;
    if (field === 'departureDate' && (!/^\d{4}-\d{2}-\d{2}$/.test(actual) ||
        !Number.isFinite(Date.parse(actual+'T00:00:00Z')) || new Date(actual+'T00:00:00Z').toISOString().slice(0,10) !== actual)) return false;
  }
  const count = Number(evidence.providerPassengerCount ?? evidence.passengers);
  return Number.isInteger(count) && count > 0 && (!request.passengers || count === request.passengers);
}
module.exports = { isDuffelEvidence, usableDuffelEvidence };
