'use strict';
// GV-FLIGHT-650A / GV-FLOW-651A: backend source for the generated tour visualizer.
// Uses the existing route planner, then optionally enriches flight legs with cheap
// one-way date observations from Travelpayouts/Aviasales.

const { getMultiCityTours } = require('./multicity-routes');
const { selectBestUsableObservation, smartFlightDateSelection677BEnabled, SMART_FLIGHT_DATE_SELECTION_VERSION_677B, smartFlightQualityGuardrails677BR2Enabled, SMART_FLIGHT_QUALITY_GUARDRAIL_VERSION_677B_R2, smartRouteRelativeFlightQuality677BR3Enabled, SMART_FLIGHT_ROUTE_RELATIVE_QUALITY_VERSION_677B_R3 } = require('./services/cheap-one-way-flights');
const { FLIGHT_PROVIDER_CONTRACT_VERSION_683C, fetchFlightDates683C, fetchFlightAcrossMonths683C, adapterSummary683C } = require('./services/flight-provider-router-683c');
const { attachTourPresentation, currencyToUsdRate, normalizeCurrency } = require('./budget-presentation');
const { findBestGlobalTour, GLOBAL_FALLBACK_VERSION } = require('./global-generated-tour-fallback');
const { curateCandidateTours } = require('./services/domain/routing/route-curator');
const { VERSION: AI_ROUTE_DIVERSITY_VERSION_687B, enabled: aiRouteDiversity687BEnabled, selectDiverseRoleCandidate: selectDiverseRoleCandidate687B } = require('./services/domain/routing/route-diversity-687b');
const { enrichFlightLeg, enrichStay, summarizePriceProvenance } = require('./services/partner-links');
const { GUARD_VERSION, guardEnabled, maxStopsForTrip, normalizeAirportIntegrity, evaluateTour, guardCandidateTours, _internal: routeFeasibilityInternal } = require('./services/domain/routing/route-feasibility');
const { GLOBAL_ROUTE_GRAPH_VERSION, globalRouteGraphEnabled, generateProviderDrivenGlobalRouteCandidates } = require('./services/global-route-graph');
const { PRICING_INTEGRITY_VERSION, normalizeParty, providerFarePartyTotalUsd, priceTransportLeg, applyTravellerPricingToTour } = require('./services/domain/pricing/traveller-pricing');
const { LIVE_PROVIDER_VERIFICATION_VERSION, enabled: liveProviderVerificationEnabled, verifyTourWithLiveProviders } = require('./services/live-provider-verification');
const { VERSION_684A, applyPublicLiveFarePilot684A, status684A } = require('./services/public-live-fare-pilot-684a');
const { VERSION_684B, discoverAffordableFlightTour684B, status684B } = require('./services/affordable-flight-discovery-684b');
const { enabled: verifiedActivationEnabled, liveRecommendationEligible } = require('./services/verified-city-activation');
const { ENTRY_ELIGIBILITY_VERSION, recommendationEligibility } = require('./services/travel-entry-eligibility');
const { WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C, enabled: wholeTripRouteOptimization677CEnabled, optimizeTourOrder: optimizeTourOrder677C, candidateAdjustment: wholeTripCandidateAdjustment677C } = require('./services/domain/routing/whole-trip-route-optimizer');
const { DESTINATION_VALUE_PROXIMITY_VERSION_677D, enabled: destinationValueProximity677DEnabled, candidateAdjustment: destinationValueCandidateAdjustment677D, annotateTour: annotateDestinationValue677D } = require('./services/domain/routing/destination-value-proximity');
const { getDestination } = require('./data/destination-meta');
const { WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2, candidateStartDates: candidateStartDates681BP2, evaluateCandidate: evaluateWholeTripDateCandidate681BP2, selectCandidate: selectWholeTripDateCandidate681BP2 } = require('./services/domain/routing/whole-trip-date-optimizer-681b-p2');
const { STAY22_EVIDENCE_VERSION_682B, enabled: stay22EvidenceEnabled682B, productionApproved: stay22ProductionApproved682B, fetchStay22Evidence } = require('./services/stay22-evidence-682b');
const { PROPERTY_IDENTITY_VERSION_682C, buildPropertyIdentity } = require('./services/property-identity-682c');
const { VERSION_683H, enabled683H: duffelP2Enabled683H, status683H: duffelP2Status683H, seedCandidateStarts683H, buildLiveProviderResults683H, applyResolvedAirports683H, liveSelectionFailClosedReason683JR1: classifyLiveSelectionFailClosed683JR1 } = require('./services/duffel-p2-staging-683h');

const GENERATED_TOUR_VERSION = '2.18.3-gv-rec-684b-r3-strict-currency-budget-fit';
const FLEXIBLE_DATE_ENGINE_VERSION_681B_P1 = 'GV-TRUST-681B-P1';
const SMART_DURATION_VERSION_677A = 'GV-REC-677A';
const TRANSPORT_MODE_INTEGRITY_VERSION_677A_R1 = 'GV-REC-677A-R1';
const SMART_FLIGHT_DATE_INTEGRITY_VERSION_677B_R1 = 'GV-REC-677B-R1';
const MAX_SCANNED_LEGS = 4;

function scannerEnabled() {
  return String(process.env.ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B || process.env.ENABLE_CHEAP_ONE_WAY_SCANNER_650A || '').trim().toLowerCase() === 'true';
}

function scanner650BEnabled() {
  return String(process.env.ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B || '').trim().toLowerCase() === 'true';
}


function automaticCheapDateTourBuilderEnabled() {
  const explicit = String(process.env.ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B || process.env.ENABLE_CHEAP_ONE_WAY_TOUR_BUILDER_657B || '').trim().toLowerCase();
  if (explicit) return explicit === 'true';
  // GV-FLIGHT-657B makes the six-month scanner part of the automatic generated-tour flow.
  // If the six-month scanner is enabled, keep the automatic builder active by default.
  return String(process.env.ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A || '').trim().toLowerCase() === 'true';
}

function generatedTourEnabled() {
  return String(process.env.ENABLE_GENERATED_TOUR_651A || '').trim().toLowerCase() === 'true';
}

function transportModeIntegrity677AR1Enabled() {
  return String(process.env.ENABLE_TRANSPORT_MODE_INTEGRITY_677A_R1 || '').trim().toLowerCase() === 'true';
}

function smartFlightDateIntegrity677BR1Enabled() {
  return String(process.env.ENABLE_ITINERARY_DATE_INTEGRITY_677B_R1 || '').trim().toLowerCase() === 'true';
}

function wholeTripDateOptimizer681BP2Enabled() {
  const explicit = String(process.env.ENABLE_WHOLE_TRIP_DATE_OPTIMIZER_681B_P2 || '').trim().toLowerCase();
  if (explicit) return explicit === 'true';
  // P2 is a conservative extension of P1: it only runs when the automatic flexible
  // builder and date-integrity protections are already active. Exact-date requests
  // remain outside this optimizer.
  return automaticCheapDateTourBuilderEnabled() && smartFlightDateIntegrity677BR1Enabled() && smartFlightDateSelection677BEnabled();
}


function stay22P2DatePricingEnabled682B() {
  const explicit = String(process.env.ENABLE_STAY22_P2_DATE_PRICING_682B || '').trim().toLowerCase();
  return explicit === 'true';
}

function stay22P2OptimizerEligible682B() {
  return stay22EvidenceEnabled682B()
    && stay22P2DatePricingEnabled682B()
    && stay22ProductionApproved682B()
    && Boolean(String(process.env.STAY22_API_KEY || '').trim());
}

function stay22P2MaxRequests682B() {
  const parsed = Number(process.env.GV_STAY22_P2_MAX_REQUESTS);
  const value = Number.isFinite(parsed) ? Math.round(parsed) : 60;
  return Math.max(2, Math.min(120, value));
}

function transportModeText677AR1(leg = {}) {
  return `${String(leg.mode || '').toLowerCase()} ${String(leg.transportType || '').toLowerCase()}`.trim();
}

function legHasFlightComponent677AR1(leg = {}) {
  const raw = transportModeText677AR1(leg);
  if (raw.includes('flight')) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some((segment) => {
    const segmentMode = `${String(segment?.mode || '').toLowerCase()} ${String(segment?.transportType || '').toLowerCase()}`;
    return segmentMode.includes('flight');
  });
}

function legHasGroundComponent677AR1(leg = {}) {
  const raw = transportModeText677AR1(leg);
  if (/(ground|rail|bus|train|shuttle|transfer)/.test(raw)) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some((segment) => {
    const segmentMode = `${String(segment?.mode || '').toLowerCase()} ${String(segment?.transportType || '').toLowerCase()}`;
    return /(ground|rail|bus|train|shuttle|transfer)/.test(segmentMode);
  });
}

function pureGroundLeg677AR1(leg = {}) {
  return legHasGroundComponent677AR1(leg) && !legHasFlightComponent677AR1(leg);
}

function endpointCountryCode677AR1(node = {}) {
  return String(node.countryCode || '').trim().toUpperCase();
}

function endpointAirportCode677AR1(node = {}) {
  const code = String(node.airportCode || node.code || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalizeTransportModeIntegrity677AR1(leg = {}) {
  if (!transportModeIntegrity677AR1Enabled()) return leg;
  const flightComponent = legHasFlightComponent677AR1(leg);
  const groundComponent = legHasGroundComponent677AR1(leg);
  const distanceKm = Number(leg.distanceKm || 0);
  const fromCountry = endpointCountryCode677AR1(leg.from || {});
  const toCountry = endpointCountryCode677AR1(leg.to || {});
  const airportCapable = Boolean(endpointAirportCode677AR1(leg.from || {}) && endpointAirportCode677AR1(leg.to || {}));

  if (flightComponent) {
    return {
      ...leg,
      transportModeIntegrity: {
        version: TRANSPORT_MODE_INTEGRITY_VERSION_677A_R1,
        status: 'flight-component-preserved',
        repaired: false,
        flightComponent: true,
        groundComponent
      }
    };
  }

  const claimedGround = groundComponent;
  const impossibleByDistance = claimedGround && Number.isFinite(distanceKm) && distanceKm > 900;
  const implausibleCrossBorder = claimedGround && fromCountry && toCountry && fromCountry !== toCountry && Number.isFinite(distanceKm) && distanceKm > 700;
  if (claimedGround && airportCapable && (impossibleByDistance || implausibleCrossBorder)) {
    const amount = Number(leg.estimatedTransportUsd || leg.estimatedFlightUsd || leg.amountUsd || 0) || 0;
    return {
      ...leg,
      mode: 'flight',
      transportType: 'flight',
      estimatedTransportUsd: amount || leg.estimatedTransportUsd,
      estimatedFlightUsd: amount || leg.estimatedFlightUsd || leg.estimatedTransportUsd,
      estimateSource: 'transport-mode-integrity-flight-repair-677a-r1',
      operator: 'Estimated flight option',
      transportModeIntegrity: {
        version: TRANSPORT_MODE_INTEGRITY_VERSION_677A_R1,
        status: 'repaired-impossible-ground-to-flight',
        repaired: true,
        previousMode: leg.mode || null,
        previousTransportType: leg.transportType || null,
        distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
        fromCountry: fromCountry || null,
        toCountry: toCountry || null
      }
    };
  }

  return {
    ...leg,
    transportModeIntegrity: {
      version: TRANSPORT_MODE_INTEGRITY_VERSION_677A_R1,
      status: claimedGround ? 'ground-leg-preserved' : 'mode-preserved',
      repaired: false,
      flightComponent: false,
      groundComponent: claimedGround
    }
  };
}

function explicitTripNights674A(query = {}) {
  const dateMode = String(query.dateMode || '').trim().toLowerCase();
  const tripLength = String(query.tripLength || '').trim().toLowerCase();
  const adaptive = String(query.adaptiveDuration || '').trim().toLowerCase() === 'true' || tripLength === 'auto';
  const raw = query.totalNights ?? query.nights ?? query.tripNights ?? query.durationNights;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  // Exact dates and an explicit trip-length choice always win. Older clients may
  // still send nights=5 with tripLength=auto; adaptive mode intentionally ignores it.
  if (dateMode === 'exact' || tripLength === 'exact' || !adaptive) return Math.max(4, Math.min(21, Math.round(parsed)));
  return null;
}

function resolveAdaptiveDuration674A(query = {}) {
  if (smartDurationFlightSelection677AEnabled() && query.__smartDurationDecision677A && typeof query.__smartDurationDecision677A === 'object') {
    const pinned = Number(query.__smartDurationDecision677A.nights);
    if (Number.isFinite(pinned) && pinned >= 4 && pinned <= 21) {
      return { ...query.__smartDurationDecision677A, version: SMART_DURATION_VERSION_677A, mode: 'adaptive', nights: Math.round(pinned), smartEnabled: true };
    }
  }
  const explicit = explicitTripNights674A(query);
  if (explicit) {
    return {
      version: 'GV-UX-674A',
      mode: String(query.dateMode || '').toLowerCase() === 'exact' ? 'exact-dates' : 'user-selected',
      nights: explicit,
      reason: 'The traveller selected the trip length or exact dates.'
    };
  }
  const party = normalizeParty(query);
  const currency = normalizeCurrency(query.currency || 'USD');
  const displayedBudget = Math.max(1, Number(query.budget || query.totalBudget || 0));
  const budgetUsd = query.budgetUsd !== undefined && String(query.budgetUsd).trim() !== ''
    ? Math.max(1, Number(query.budgetUsd))
    : displayedBudget * currencyToUsdRate(currency);
  const perTravellerUsd = budgetUsd / Math.max(1, party.travellers);
  let nights = 4;
  if (perTravellerUsd >= 700) nights = 6;
  if (perTravellerUsd >= 1100) nights = 8;
  if (perTravellerUsd >= 1700) nights = 10;
  if (perTravellerUsd >= 2400) nights = 12;
  // Keep very small total-group budgets conservative even when the party parser is incomplete.
  if (budgetUsd < 650) nights = 4;
  return {
    version: 'GV-UX-674A',
    mode: 'adaptive',
    nights,
    budgetUsd: Math.round(budgetUsd),
    perTravellerBudgetUsd: Math.round(perTravellerUsd),
    travellers: party.travellers,
    reason: 'Duration was selected from the total-group budget and traveller count, then route comfort checks limited the number of stops.'
  };
}


function smartDurationFlightSelection677AEnabled() {
  const raw = String(process.env.ENABLE_SMART_DURATION_FLIGHT_SELECTION_677A || '').trim().toLowerCase();
  return raw ? raw === 'true' : false;
}

function clamp677A(value, min, max) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function smartStopBounds677A(stop = {}, shortRegionalOverride = false) {
  const appliedMin = Number(stop.appliedNightMinimum || 0);
  const appliedMax = Number(stop.appliedNightMaximum || 0);
  const recommendedMin = Number(stop.recommendedMinNights || stop.minimumSuggestedNights || stop?.multiCitySuitability?.recommendedMinNights || 0);
  const recommendedMax = Number(stop.recommendedMaxNights || stop.maximumSuggestedNights || stop?.multiCitySuitability?.recommendedMaxNights || 0);
  const min = shortRegionalOverride && appliedMin > 0
    ? clamp677A(Math.round(appliedMin), 2, 6)
    : clamp677A(Math.round(recommendedMin || appliedMin || 2), 2, 6);
  const max = shortRegionalOverride && appliedMax > 0
    ? clamp677A(Math.round(appliedMax), min, 10)
    : clamp677A(Math.round(recommendedMax || appliedMax || Math.max(min, 6)), min, 12);
  return { min, max };
}

function routeTravelHours677A(tour = {}) {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  return legs.reduce((sum, leg) => {
    let distanceKm = Number(leg.distanceKm || 0);
    if ((!Number.isFinite(distanceKm) || distanceKm <= 0) && leg.from && leg.to && routeFeasibilityInternal?.haversineKm) {
      distanceKm = routeFeasibilityInternal.haversineKm(leg.from, leg.to);
    }
    const hours = routeFeasibilityInternal?.estimateLegTravelHours
      ? routeFeasibilityInternal.estimateLegTravelHours(leg, distanceKm || 0)
      : Math.max(1, (distanceKm || 0) / 750 + 3.5);
    return sum + (Number.isFinite(Number(hours)) ? Number(hours) : 0);
  }, 0);
}

function smartBudgetCapacity677A(tour = {}, query = {}) {
  const party = normalizeParty(query);
  const budgetUsdDirect = Number(tour.usableTripBudgetUsd || 0);
  const totalBudgetUsd = Number(tour.totalBudgetUsd || query.budgetUsd || 0)
    || Math.max(0, Number(query.budget || 0)) * currencyToUsdRate(normalizeCurrency(query.currency || 'USD'));
  const usableBudgetUsd = budgetUsdDirect > 0 ? budgetUsdDirect : totalBudgetUsd * 0.90;
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const transportUsd = Number(tour.totalTransportEstimateUsd || tour.totalFlightEstimateUsd || 0)
    || legs.reduce((sum, leg) => sum + Number(leg.estimatedTransportUsd || leg.estimatedFlightUsd || leg.amountUsd || 0), 0);
  const currentNights = Math.max(1, Number(tour.totalNights || 0)
    || (Array.isArray(tour.stops) ? tour.stops.reduce((sum, stop) => sum + Number(stop.nights || 0), 0) : 0));
  const hotelTotalUsd = Number(tour.totalHotelEstimateUsd || 0)
    || (Array.isArray(tour.stops) ? tour.stops.reduce((sum, stop) => sum + Number(stop?.hotel?.estimatedStayUsd || 0), 0) : 0);
  let nightlyTripCostUsd = hotelTotalUsd > 0 ? hotelTotalUsd / currentNights : 0;
  if (!(nightlyTripCostUsd > 0) && Array.isArray(tour.stops) && tour.stops.length) {
    const average = tour.stops.reduce((sum, stop) => sum + Number(stop?.hotel?.estimatedNightlyUsd || stop?.hotel?.averageNightlyUsd || 95), 0) / tour.stops.length;
    nightlyTripCostUsd = average * Math.max(1, party.rooms || 1);
  }
  if (!(nightlyTripCostUsd > 0)) nightlyTripCostUsd = 100 * Math.max(1, party.rooms || 1);
  // Leave a small operational cushion inside the already-protected trip budget so
  // smart duration does not spend every last planning dollar on extra hotel nights.
  const stayBudgetUsd = Math.max(0, (usableBudgetUsd - transportUsd) * 0.94);
  const maxAffordableNights = Math.max(0, Math.floor(stayBudgetUsd / nightlyTripCostUsd));
  return {
    totalBudgetUsd: Math.round(totalBudgetUsd),
    usableBudgetUsd: Math.round(usableBudgetUsd),
    transportUsd: Math.round(transportUsd),
    nightlyTripCostUsd: Math.round(nightlyTripCostUsd),
    maxAffordableNights
  };
}

function resolveSmartDuration677A(tour = {}, query = {}, baseDecision = {}) {
  if (!smartDurationFlightSelection677AEnabled() || baseDecision.mode !== 'adaptive') {
    return {
      ...baseDecision,
      smartEnabled: false,
      smartVersion: SMART_DURATION_VERSION_677A
    };
  }
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  if (!stops.length) {
    return {
      ...baseDecision,
      smartEnabled: true,
      smartVersion: SMART_DURATION_VERSION_677A,
      reason: 'No route stops were available for route-specific duration refinement.'
    };
  }
  const shortRegionalOverride = tour?.budgetAdaptivePolicy?.shortRegionalNightOverride === true;
  const bounds = stops.map(stop => smartStopBounds677A(stop, shortRegionalOverride));
  const routeMinimumNights = bounds.reduce((sum, item) => sum + item.min, 0);
  const routeMaximumNights = bounds.reduce((sum, item) => sum + item.max, 0);
  const estimatedTravelHours = routeTravelHours677A(tour);
  let travelRecoveryNights = estimatedTravelHours >= 34 ? 2 : estimatedTravelHours >= 20 ? 1 : 0;
  if (stops.length === 1) travelRecoveryNights = Math.min(1, travelRecoveryNights);
  const comfortMinimumNights = Math.min(21, routeMinimumNights + travelRecoveryNights);
  const budget = smartBudgetCapacity677A(tour, query);
  const baseNights = clamp677A(Math.round(Number(baseDecision.nights || 6)), 4, 21);
  let desiredNights = Math.max(baseNights, comfortMinimumNights);
  desiredNights = Math.min(desiredNights, Math.max(routeMinimumNights, routeMaximumNights), 21);
  const affordabilityRisk = budget.maxAffordableNights > 0 && budget.maxAffordableNights < routeMinimumNights;
  if (!affordabilityRisk && budget.maxAffordableNights >= routeMinimumNights) {
    desiredNights = Math.min(desiredNights, Math.max(routeMinimumNights, budget.maxAffordableNights));
  }
  desiredNights = clamp677A(Math.round(desiredNights), 4, 21);
  return {
    version: SMART_DURATION_VERSION_677A,
    mode: 'adaptive',
    nights: desiredNights,
    baseBudgetNights: baseNights,
    routeMinimumNights,
    routeMaximumNights,
    travelRecoveryNights,
    estimatedTravelHours: Number(estimatedTravelHours.toFixed(1)),
    stopCount: stops.length,
    stopNightBounds: stops.map((stop, index) => ({
      city: stop.city || stop.displayCity || `Stop ${index + 1}`,
      minimum: bounds[index].min,
      maximum: bounds[index].max
    })),
    budgetCapacity: budget,
    affordabilityRisk,
    smartEnabled: true,
    smartVersion: SMART_DURATION_VERSION_677A,
    reason: affordabilityRisk
      ? `The route needs about ${routeMinimumNights} destination nights, but the current planning budget may not support that comfortably. Globevoy will prefer a simpler route rather than compressing the stays.`
      : `Duration combines the cities' useful minimum stays, about ${Math.round(estimatedTravelHours)} hours of route travel, the traveller count, and the protected trip budget.`
  };
}

function mvpValidationRepairs669bEnabled() {
  return String(process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B || '').trim().toLowerCase() === 'true';
}

function budgetSafeRouteRecovery669cEnabled() {
  return String(process.env.ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C || '').trim().toLowerCase() === 'true';
}

function exactDateFamilyOccupancy669dEnabled() {
  return String(process.env.ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D || '').trim().toLowerCase() === 'true';
}

function mapFirstThreePicks670aEnabled() {
  return String(process.env.ENABLE_MAP_FIRST_THREE_PICKS_670A || '').trim().toLowerCase() === 'true';
}

const MAP_FIRST_PICK_ROLES_670A = Object.freeze(['lowest-cost', 'best-balance', 'most-memorable', 'something-different', 'hidden-gem']);

function normalizePickRole670a(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (raw.includes('lowest') || raw === 'cost') return 'lowest-cost';
  if (raw.includes('memorable') || raw.includes('inspiring') || raw.includes('discover')) return 'most-memorable';
  if (raw.includes('different') || raw.includes('surprise') || raw.includes('wildcard')) return 'something-different';
  if (raw.includes('hidden') || raw.includes('gem') || raw.includes('under-the-radar')) return 'hidden-gem';
  if (raw.includes('balance') || raw.includes('recommended') || raw.includes('overall')) return 'best-balance';
  return MAP_FIRST_PICK_ROLES_670A.includes(raw) ? raw : '';
}

function requestedPickRole670a(query = {}) {
  if (!mapFirstThreePicks670aEnabled()) return '';
  return normalizePickRole670a(query.routeRole || query.tourRole || query.pickRole);
}

function tourRole670a(tour = {}) {
  return normalizePickRole670a(tour.tourRole || tour.tourRoleLabel || tour.recommendationLabel);
}

function routeKey670aR2(tour = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : (Array.isArray(tour.cities) ? tour.cities : []);
  const key = stops.map(stop => String(stop?.cityId || stop?.id || stop?.airportCode || stop?.code || stop?.city || '').trim().toLowerCase()).filter(Boolean).join('>');
  return key || String(tour.routeId || tour.tourId || tour.id || tour.title || '').trim().toLowerCase();
}

function routeStopKeys680A(tour = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : (Array.isArray(tour.cities) ? tour.cities : []);
  return new Set(stops.map(stop => String(stop?.cityId || stop?.id || stop?.airportCode || stop?.code || stop?.city || '').trim().toLowerCase()).filter(Boolean));
}

function routeOverlap680A(tour = {}, selectedTours = []) {
  const keys = routeStopKeys680A(tour);
  if (!keys.size || !selectedTours.length) return { count: 0, ratio: 0 };
  let largestCount = 0;
  let largestRatio = 0;
  for (const selected of selectedTours) {
    const selectedKeys = routeStopKeys680A(selected);
    const count = [...keys].filter(key => selectedKeys.has(key)).length;
    const ratio = count / Math.max(1, Math.min(keys.size, selectedKeys.size));
    if (count > largestCount) largestCount = count;
    if (ratio > largestRatio) largestRatio = ratio;
  }
  return { count: largestCount, ratio: largestRatio };
}

function normalizeTravelPace680BR1(query = {}) {
  const value = String(query.travelPace || '').trim().toLowerCase();
  if (value === 'relaxed') return 'relaxed';
  if (value === 'see more' || value === 'see-more' || value === 'faster') return 'see-more';
  return 'balanced';
}

function normalizeFlightPreference680BR1(query = {}) {
  const value = String(query.flightPreference || '').trim().toLowerCase();
  if (value.includes('nonstop')) return 'nonstop-preferred';
  if (value.includes('maximum one stop') || value.includes('max one stop')) return 'max-one-stop';
  if (value.includes('lowest fare') || value.includes('cheapest')) return 'lowest-fare';
  return 'best-overall';
}

function preferenceKeys680BR1(query = {}) {
  const raw = [];
  const priorities = String(query.priorities || '').split(',').map(v => v.trim()).filter(Boolean);
  raw.push(...priorities);
  if (query.interests) raw.push(String(query.interests));
  const keys = new Set();
  for (const value of raw) {
    const text = String(value).toLowerCase();
    if (text.includes('food') || text.includes('culture')) keys.add('food-culture');
    if (text.includes('beach')) keys.add('beach');
    if (text.includes('nature') || text.includes('outdoor')) keys.add('nature');
    if (text.includes('nightlife')) keys.add('nightlife');
    if (text.includes('wellness') || text.includes('relax')) keys.add('wellness');
    if (text.includes('family')) keys.add('family');
  }
  return [...keys];
}

function destinationPreferenceText680BR1(stop = {}) {
  const meta = getDestination(stop?.airportCode || stop?.code || stop?.cityId || stop?.city || stop?.displayCity) || {};
  return [stop?.city, stop?.country, stop?.theme, meta?.theme, meta?.region, meta?.seasonInsight, meta?.travelTime]
    .filter(Boolean).join(' ').toLowerCase();
}

function preferenceMatchAdjustment680BR1(tour = {}, query = {}) {
  const keys = preferenceKeys680BR1(query);
  if (!keys.length) return 0;
  const patterns = {
    'food-culture': /(food|culture|museum|heritage|historic|art|design|wine|culinary|city break|hub city)/,
    beach: /(beach|coast|island|resort|caribbean|seaside|shore)/,
    nature: /(nature|outdoor|mountain|safari|scenic|fjord|park|alpine|lake)/,
    nightlife: /(nightlife|party|entertainment|music|club)/,
    wellness: /(wellness|spa|relax|resort|retreat)/,
    family: /(family|theme park|beach|resort|zoo)/
  };
  const stops = Array.isArray(tour?.stops) ? tour.stops : [];
  let matches = 0;
  for (const key of keys) {
    const pattern = patterns[key];
    if (pattern && stops.some(stop => pattern.test(destinationPreferenceText680BR1(stop)))) matches += 1;
  }
  // Preferences are a soft ranking signal only. Budget, entry safety, provider quality,
  // route feasibility and destination-value rules stay authoritative.
  return matches * 55 - Math.max(0, keys.length - matches) * 8;
}

function observedTransfers680BR1(leg = {}) {
  const evidence = leg?.cheapestOneWay || leg?.providerDateEvidence || leg?.providerObservation || {};
  const direct = Number(evidence?.transfers);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const segments = Array.isArray(evidence?.segments) ? evidence.segments : (Array.isArray(leg?.segments) ? leg.segments : []);
  if (segments.length > 0) return Math.max(0, segments.filter(segment => String(segment?.mode || segment?.transportType || 'flight').toLowerCase().includes('flight')).length - 1);
  return null;
}

function flightPreferenceAdjustment680BR1(tour = {}, query = {}) {
  const preference = normalizeFlightPreference680BR1(query);
  if (preference === 'best-overall') return 0;
  if (preference === 'lowest-fare') {
    const total = totalEstimateUsdFromTour(tour, query);
    return Number.isFinite(total) ? -Math.min(60000, total * 60) : 0;
  }
  let known = 0;
  let penalty = 0;
  for (const leg of (Array.isArray(tour?.legs) ? tour.legs : [])) {
    if (!legHasFlightComponent677AR1(leg)) continue;
    const transfers = observedTransfers680BR1(leg);
    if (!Number.isFinite(transfers)) continue;
    known += 1;
    if (preference === 'nonstop-preferred') penalty += transfers * 18000;
    if (preference === 'max-one-stop' && transfers > 1) penalty += (transfers - 1) * 24000;
  }
  return known ? -penalty : 0;
}

function effectiveFlexibleMonth680BR1(requestedMonth, today = todayIsoUtc(), leadDays = 14) {
  const requested = /^\d{4}-\d{2}$/.test(String(requestedMonth || '').trim()) ? String(requestedMonth).trim() : null;
  const floorDate = addDaysIso(today, leadDays);
  const floorMonth = floorDate.slice(0, 7);
  if (!requested) return { requestedMonth: null, effectiveMonth: floorMonth, adjusted: false, minimumDate: floorDate };
  return { requestedMonth: requested, effectiveMonth: requested < floorMonth ? floorMonth : requested, adjusted: requested < floorMonth, minimumDate: floorDate };
}

function prepareFlexibleLeadTimeQuery680BR1(query = {}) {
  if (isExactDateRequest680B(query)) return { ...query, __leadTime680BR1: { adjusted: false, exactDatePreserved: true } };
  const leadDays = automaticMinimumLeadDays680B(query);
  const requestedMonth = query.preferredMonth || query.month || null;
  const month = effectiveFlexibleMonth680BR1(requestedMonth, todayIsoUtc(), leadDays);
  const next = { ...query, __leadTime680BR1: { ...month, leadDays, version: 'GV-QUALITY-680B-R1' } };
  if (month.adjusted) {
    next.preferredMonth = month.effectiveMonth;
    next.month = month.effectiveMonth;
  }
  return next;
}

function preferenceTheme680BR1(query = {}) {
  const keys = preferenceKeys680BR1(query);
  const preferred = keys[0] || '';
  return ({ 'food-culture': 'food', beach: 'beach', nature: 'nature', nightlife: 'nightlife', wellness: 'relaxation' })[preferred] || null;
}

function threePickBalanceScore670aR2(tour = {}, query = {}) {
  const total = totalEstimateUsdFromTour(tour, query);
  const ceiling = budgetCeilingUsd(tour, query);
  const utilisation = Number.isFinite(ceiling) && ceiling > 0 ? total / ceiling : 0.78;
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  const countries = new Set(stops.map(countryKeyFromNode).filter(Boolean));
  const budgetFit = 1000 - Math.abs(0.80 - utilisation) * 1200;
  const destinationValueAdjustment = destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(tour, query).adjustment : 0;
  const multiCityPreference = String(query.recommendationScope || '').toLowerCase().includes('multicity')
    ? (stops.length >= 2 ? 220 : -280)
    : 0;
  return budgetFit + countries.size * 90 + stops.length * 55 + Math.min(180, Number(tour.totalDistanceKm || 0) / 80) + destinationValueAdjustment + multiCityPreference + preferenceMatchAdjustment680BR1(tour, query);
}

function threePickMemorableScore670aR2(tour = {}, query = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  const originCountry = countryKeyFromNode(tour.origin);
  const countries = new Set(stops.map(countryKeyFromNode).filter(Boolean));
  const outsideOrigin = originCountry ? stops.filter(stop => countryKeyFromNode(stop) && countryKeyFromNode(stop) !== originCountry).length : 0;
  const hiddenGem = stops.reduce((sum, stop) => {
    const group = String(stop?.group || stop?.cityGroup || stop?.classification?.group || '').toLowerCase();
    const explicit = Number(stop?.hiddenGemStrength || stop?.hiddenGemScore || stop?.classification?.hiddenGemStrength || 0);
    return sum + (Number.isFinite(explicit) ? explicit : 0) + (group.includes('2') ? 45 : 0);
  }, 0);
  const destinationValueAdjustment = destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(tour, query).adjustment : 0;
  return countries.size * 360 + outsideOrigin * 180 + stops.length * 90 + Math.min(360, Number(tour.totalDistanceKm || 0) / 35) + hiddenGem + destinationValueAdjustment + preferenceMatchAdjustment680BR1(tour, query);
}

function threePickRoleAssignments670aR2(tours = [], query = {}) {
  const raw = Array.isArray(tours) ? tours.filter(Boolean) : [];
  const byRoute = new Map();
  raw.forEach((tour, index) => {
    const key = routeKey670aR2(tour) || `candidate-${index}`;
    const prior = byRoute.get(key);
    if (!prior || (!tourRole670a(prior) && tourRole670a(tour))) byRoute.set(key, tour);
  });
  const list = Array.from(byRoute.values());
  const assignments = {};
  const used = new Set();
  const selectedTours = [];

  const available = () => list.filter(tour => !used.has(routeKey670aR2(tour)));
  const choose = role => {
    const pool = available();
    if (!pool.length) return null;
    if (role === 'lowest-cost') {
      return pool.slice().sort((a, b) => totalEstimateUsdFromTour(a, query) - totalEstimateUsdFromTour(b, query))[0] || null;
    }
    if (role === 'most-memorable') {
      return pool.slice().sort((a, b) => {
        const aOverlap = routeOverlap680A(a, selectedTours);
        const bOverlap = routeOverlap680A(b, selectedTours);
        const aScore = threePickMemorableScore670aR2(a, query) - aOverlap.ratio * 520 - aOverlap.count * 80 + (tourRole670a(a) === role ? 1 : 0);
        const bScore = threePickMemorableScore670aR2(b, query) - bOverlap.ratio * 520 - bOverlap.count * 80 + (tourRole670a(b) === role ? 1 : 0);
        return bScore - aScore;
      })[0] || null;
    }
    return pool.slice().sort((a, b) => {
      const aOverlap = routeOverlap680A(a, selectedTours);
      const bOverlap = routeOverlap680A(b, selectedTours);
      const aScore = threePickBalanceScore670aR2(a, query) - aOverlap.ratio * 300 - aOverlap.count * 45 + (tourRole670a(a) === role ? 1 : 0);
      const bScore = threePickBalanceScore670aR2(b, query) - bOverlap.ratio * 300 - bOverlap.count * 45 + (tourRole670a(b) === role ? 1 : 0);
      return bScore - aScore;
    })[0] || null;
  };

  // Recompute all labels from the final safe, priced pool. Explicit labels from
  // upstream planners are hints only; "Lowest cost" must always be the true minimum.
  for (const role of ['lowest-cost', 'best-balance', 'most-memorable']) {
    const candidate = choose(role);
    if (!candidate) continue;
    const overlap = routeOverlap680A(candidate, selectedTours);
    assignments[role] = {
      ...candidate,
      sourceTourRole670aR2: tourRole670a(candidate) || null,
      tourRole: role,
      tourRoleLabel: pickRoleLabel670a(role),
      recommendationLabel: pickRoleLabel670a(role),
      mapFirstRoleAssignment: {
        version: 'GV-UX-674A',
        role,
        derivedFromSafeCandidatePool: true,
        thresholdsRelaxed: false,
        recommendationDiversityVersion: 'GV-QUALITY-680A',
        maxStopOverlapWithEarlierPick: overlap.count,
        maxStopOverlapRatioWithEarlierPick: Number(overlap.ratio.toFixed(3))
      }
    };
    used.add(routeKey670aR2(candidate));
    selectedTours.push(candidate);
  }
  return assignments;
}

function roleScopedCandidatePool670a(tours = [], query = {}) {
  const list = Array.isArray(tours) ? tours.filter(Boolean) : [];
  const requested = requestedPickRole670a(query);
  if (!requested || !list.length) return list;
  const assignments = threePickRoleAssignments670aR2(list, query);
  return assignments[requested] ? [assignments[requested]] : [];
}

function pickRoleLabel670a(role) {
  if (role === 'lowest-cost') return 'Lowest cost';
  if (role === 'most-memorable') return 'Most memorable';
  if (role === 'something-different') return 'Something different';
  if (role === 'hidden-gem') return 'Hidden gem';
  return 'Best balance';
}

function decoratePickTour670a(tour = {}, query = {}) {
  const requested = requestedPickRole670a(query);
  if (!requested || !tour) return tour;
  const actual = tourRole670a(tour);
  return {
    ...tour,
    pickRole: requested,
    pickRoleLabel: pickRoleLabel670a(requested),
    pickRoleMatched: actual === requested,
    mapFirstThreePicks: {
      enabled: true,
      version: 'GV-UX-670A-R2',
      requestedRole: requested,
      actualRole: actual || null,
      roleMatched: actual === requested
    }
  };
}

function budgetRecoveryAttempt669c(query = {}) {
  const raw = Number(query.__budgetRecoveryAttempt669c || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function allTourStopsProductionActive(tour = {}) {
  if (!mvpValidationRepairs669bEnabled() || !verifiedActivationEnabled()) return true;
  const stops = Array.isArray(tour.stops) ? tour.stops : (Array.isArray(tour.cities) ? tour.cities : []);
  return stops.length > 0 && stops.every(stop => liveRecommendationEligible(stop));
}

function safeMonth(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 7);
}

function defaultScanStartMonth(value) {
  const explicit = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function cheapDateScanMonths(query = {}) {
  const raw = Number(query.flightScanMonths || query.scanMonths || process.env.GV_FLIGHT_657A_SCAN_MONTHS || 6);
  return Math.max(1, Math.min(Number.isFinite(raw) ? Math.round(raw) : 6, 6));
}


function isoDateFromMonth(month, offsetDays) {
  const safe = safeMonth(month);
  const d = new Date(`${safe}-01T12:00:00Z`);
  d.setUTCDate(8 + Number(offsetDays || 0));
  return d.toISOString().slice(0, 10);
}


function todayIsoUtc() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function automaticMinimumLeadDays680B(query = {}) {
  const raw = Number(query.minimumLeadDays || query.automaticLeadDays || process.env.GV_AUTOMATIC_MIN_LEAD_DAYS || 14);
  return Math.max(7, Math.min(Number.isFinite(raw) ? Math.round(raw) : 14, 60));
}

function isExactDateRequest680B(query = {}) {
  return String(query.dateMode || '').trim().toLowerCase() === 'exact'
    || String(query.flexible ?? '').trim().toLowerCase() === 'false';
}

function safeIsoDate(value) {
  const s = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function monthFromIsoDate(value) {
  const s = safeIsoDate(value);
  return s ? s.slice(0, 7) : defaultScanStartMonth();
}

function addDaysIso(value, days) {
  const s = safeIsoDate(value) || todayIsoUtc();
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function daysBetweenIso(start, end) {
  const a = safeIsoDate(start);
  const b = safeIsoDate(end);
  if (!a || !b) return null;
  const diff = (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000;
  return Number.isFinite(diff) ? Math.round(diff) : null;
}

function exactDateWindow669d(query = {}) {
  if (!exactDateFamilyOccupancy669dEnabled()) return null;
  const mode = String(query.dateMode || query.dates || '').trim().toLowerCase();
  const flexible = String(query.flexible ?? '').trim().toLowerCase();
  const departureDate = safeIsoDate(query.departureDate || query.startDate || query.fromDate);
  const returnDate = safeIsoDate(query.returnDate || query.endDate || query.toDate);
  const explicitExact = mode === 'exact' || flexible === 'false';
  const nights = daysBetweenIso(departureDate, returnDate);
  if (!explicitExact || !departureDate || !returnDate || !Number.isFinite(nights) || nights < 1) return null;
  return { departureDate, returnDate, nights };
}

function allocateExactNights669d(stops = [], totalNights = 0) {
  const count = Array.isArray(stops) ? stops.length : 0;
  const total = Math.max(0, Math.round(Number(totalNights || 0)));
  if (!count || total < count) return null;
  const minimum = total >= count * 2 ? 2 : 1;
  const requested = stops.map((stop) => Math.max(minimum, Math.round(Number(stop?.nights || stop?.minimumSuggestedNights || minimum))));
  if (requested.reduce((sum, value) => sum + value, 0) === total) return requested;

  const allocations = Array(count).fill(minimum);
  let remaining = total - minimum * count;
  const weights = requested.map((value) => Math.max(0, value - minimum));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (remaining > 0 && weightTotal > 0) {
    const fractions = weights.map((weight, index) => {
      const exact = remaining * weight / weightTotal;
      const whole = Math.floor(exact);
      allocations[index] += whole;
      return { index, fraction: exact - whole };
    });
    remaining = total - allocations.reduce((sum, value) => sum + value, 0);
    fractions.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let index = 0; index < remaining; index += 1) allocations[fractions[index % fractions.length].index] += 1;
  } else {
    for (let index = 0; index < remaining; index += 1) allocations[index % count] += 1;
  }
  return allocations;
}

function stripStaleExactDateEvidence669d(leg = {}, targetDate) {
  const target = safeIsoDate(targetDate);
  const next = { ...leg };
  const evidenceDate = safeIsoDate((leg.cheapestOneWay || leg.providerDateEvidence || {}).departureDate);
  if (evidenceDate && target && evidenceDate !== target) {
    delete next.cheapestOneWay;
    delete next.providerDateEvidence;
    delete next.providerObservation;
    delete next.liveFareVerified;
    delete next.providerVerification;
    delete next.booking;
    delete next.bookingUrl;
    delete next.providerUrl;
    next.airline = null;
  }
  return next;
}

function applyExactDateWindow669d(tour = {}, query = {}) {
  const window = exactDateWindow669d(query);
  if (!window) return tour;
  const sourceStops = Array.isArray(tour.stops) ? tour.stops : [];
  const sourceLegs = Array.isArray(tour.legs) ? tour.legs : [];
  if (!sourceStops.length || sourceLegs.length < sourceStops.length + 1) return tour;
  const allocations = allocateExactNights669d(sourceStops, window.nights);
  if (!allocations) return tour;

  const stops = sourceStops.map((stop) => ({ ...stop }));
  const legs = sourceLegs.map((leg) => ({ ...leg }));
  let current = window.departureDate;
  for (let index = 0; index < stops.length; index += 1) {
    const nights = allocations[index];
    const preparedLeg = stripStaleExactDateEvidence669d(legs[index], current);
    legs[index] = {
      ...preparedLeg,
      departureDate: current,
      dateLabel: current,
      dateSource: 'user-requested-exact-date-669d',
      automaticTourDate: {
        departureDate: current,
        source: 'user-requested-exact-date-669d',
        providerBacked: false,
        exactDateRequested: true
      }
    };
    const departure = addDaysIso(current, nights);
    stops[index] = {
      ...stops[index],
      nights,
      arrivalDate: current,
      departureDate: departure,
      dateSource: 'user-requested-exact-date-669d'
    };
    current = departure;
  }
  const finalIndex = stops.length;
  const finalDate = window.returnDate;
  const finalLeg = stripStaleExactDateEvidence669d(legs[finalIndex], finalDate);
  legs[finalIndex] = {
    ...finalLeg,
    departureDate: finalDate,
    dateLabel: finalDate,
    dateSource: 'user-requested-exact-date-669d',
    automaticTourDate: {
      departureDate: finalDate,
      source: 'user-requested-exact-date-669d',
      providerBacked: false,
      exactDateRequested: true
    }
  };

  return {
    ...tour,
    legs,
    stops,
    totalNights: window.nights,
    requestedExactDateWindow: {
      version: 'GV-PROD-669D',
      departureDate: window.departureDate,
      returnDate: window.returnDate,
      nights: window.nights,
      preserved: true,
      providerEvidenceStillRequiredForExactFare: true
    }
  };
}

function exactObservationForDate669d(result = {}, targetDate) {
  const target = safeIsoDate(targetDate);
  if (!target) return null;
  return (Array.isArray(result?.observations) ? result.observations : []).find((row) => safeIsoDate(row?.departureDate) === target) || null;
}

function providerDateOptionsForExactDate669d(result = {}, targetDate) {
  const exact = exactObservationForDate669d(result, targetDate);
  return exact ? providerDateOptions({ ...(result || {}), observations: [exact] }) : [];
}

function maxIsoDate(a, b) {
  const aa = safeIsoDate(a);
  const bb = safeIsoDate(b);
  if (!aa) return bb;
  if (!bb) return aa;
  return aa >= bb ? aa : bb;
}

function initialAutomaticStartDate(query = {}) {
  const explicit = safeIsoDate(query.departureDate || query.startDate || query.fromDate);
  if (explicit && isExactDateRequest680B(query)) return explicit;
  const minimumAutomaticDate = addDaysIso(todayIsoUtc(), automaticMinimumLeadDays680B(query));
  if (explicit && String(query.preserveDates || '').trim().toLowerCase() === 'true') {
    return maxIsoDate(explicit, minimumAutomaticDate);
  }
  const month = defaultScanStartMonth(query.month || query.preferredMonth);
  return maxIsoDate(`${month}-01`, minimumAutomaticDate);
}

function stopNightsForLeg(stops, legIndex) {
  const stop = Array.isArray(stops) ? stops[legIndex] : null;
  const nights = Number(stop?.nights || stop?.minimumSuggestedNights || 0);
  if (Number.isFinite(nights) && nights > 0) return Math.max(1, Math.round(nights));
  return 2;
}

function filterObservationsFromDate(result, minDate) {
  const min = safeIsoDate(minDate);
  const rows = Array.isArray(result?.observations) ? result.observations : [];
  if (!min) return rows;
  return rows.filter((row) => safeIsoDate(row?.departureDate) && safeIsoDate(row.departureDate) >= min);
}

function selectionContext677B(tour, query = {}, targetDate = null, legIndex = 0, leg = {}) {
  const ceiling = budgetCeilingUsd(tour || {}, query);
  const total = totalEstimateUsdFromTour(tour || {}, query);
  const distanceKm = Number(leg?.distanceKm || 0);
  return {
    targetDate: safeIsoDate(targetDate) || null,
    maxDateShiftDays: automaticLegWindowDays(query, legIndex),
    budgetPressure: Number.isFinite(ceiling) && ceiling > 0 ? Math.max(0, Math.min(1.25, total / ceiling)) : 0,
    distanceKm: Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null,
    pickRole: requestedPickRole670a(query) || tourRole670a(tour) || null
  };
}

function selectObservationFromDate(result, minDate, query = {}, context = {}, legIndex = 0) {
  const filtered = smartFlightDateSelection677BEnabled()
    ? filterObservationsWithinDateWindow(result, minDate, query, legIndex)
    : filterObservationsFromDate(result, minDate);
  return selectBestUsableObservation(filtered, { ...context, targetDate: minDate, maxDateShiftDays: automaticLegWindowDays(query, legIndex) }) || filtered[0] || null;
}

function providerDateOptionsFromDate(result, minDate, query = {}, legIndex = 0) {
  const observations = smartFlightDateSelection677BEnabled()
    ? filterObservationsWithinDateWindow(result, minDate, query, legIndex)
    : filterObservationsFromDate(result, minDate);
  return providerDateOptions({ ...(result || {}), observations });
}


// GV-FLIGHT-658C: city-night date alignment.
// The automatic builder may scan up to six months to find the first useful
// departure, but after the tour starts each next leg must align to the
// planned nights in the current city. A cheap provider observation that is
// days later than the itinerary cadence is rejected so a 6-night / 3-stop
// tour remains a real 6-night tour.
function automaticFirstLegWindowDays681BP1(query = {}) {
  const queryValue = query.firstLegFlexibleWindowDays ?? query.flexibleDateWindowDays;
  const envValue = process.env.GV_TRUST_681B_FIRST_LEG_WINDOW_DAYS;
  const raw = queryValue !== undefined && queryValue !== null && String(queryValue).trim() !== ''
    ? Number(queryValue)
    : (String(envValue || '').trim() !== '' ? Number(envValue) : 14);
  return Math.max(3, Math.min(Number.isFinite(raw) ? Math.round(raw) : 14, 30));
}

function automaticLegWindowDays(query = {}, legIndex = null) {
  const normalizedLegIndex = Number.isInteger(Number(legIndex)) ? Number(legIndex) : null;
  // GV-TRUST-681B-P1: the initial flexible departure can search beyond the old
  // three-day window. Downstream legs remain locked to the established city-night
  // cadence until date-specific stay inventory is available for route-wide repricing.
  if (smartFlightDateIntegrity677BR1Enabled() && normalizedLegIndex !== null) {
    if (normalizedLegIndex > 0) return 0;
    if (smartFlightDateSelection677BEnabled()) return automaticFirstLegWindowDays681BP1(query);
  }
  const explicitQuery = query.legDateAlignmentDays !== undefined && query.legDateAlignmentDays !== null && String(query.legDateAlignmentDays).trim() !== '';
  const explicitEnv = String(process.env.GV_FLIGHT_658C_LEG_ALIGNMENT_DAYS || '').trim() !== '';
  const raw = explicitQuery ? Number(query.legDateAlignmentDays) : (explicitEnv ? Number(process.env.GV_FLIGHT_658C_LEG_ALIGNMENT_DAYS) : (smartFlightDateSelection677BEnabled() ? 3 : 0));
  return Math.max(0, Math.min(Number.isFinite(raw) ? Math.round(raw) : 0, 3));
}

function maxAllowedDepartureDate(minDate, query = {}, legIndex = null) {
  const min = safeIsoDate(minDate);
  if (!min) return null;
  return addDaysIso(min, automaticLegWindowDays(query, legIndex));
}

function filterObservationsWithinDateWindow(result, minDate, query = {}, legIndex = null) {
  const min = safeIsoDate(minDate);
  const max = maxAllowedDepartureDate(minDate, query, legIndex);
  const rows = Array.isArray(result?.observations) ? result.observations : [];
  return rows.filter((row) => {
    const d = safeIsoDate(row?.departureDate);
    if (!d) return false;
    if (min && d < min) return false;
    if (max && d > max) return false;
    return true;
  });
}

function selectObservationWithinDateWindow(result, minDate, query = {}, context = {}, legIndex = null) {
  const filtered = filterObservationsWithinDateWindow(result, minDate, query, legIndex);
  return selectBestUsableObservation(filtered, { ...context, targetDate: minDate, maxDateShiftDays: automaticLegWindowDays(query, legIndex) }) || filtered[0] || null;
}

function providerDateOptionsWithinDateWindow(result, minDate, query = {}, legIndex = null) {
  return providerDateOptions({ ...(result || {}), observations: filterObservationsWithinDateWindow(result, minDate, query, legIndex) });
}

function automaticAlignedLegDate(leg, minDate, query = {}, legIndex = 0) {
  const min = safeIsoDate(minDate);
  const existing = safeIsoDate(leg?.departureDate || leg?.dateLabel);
  if (!min) return existing;
  if (!existing) return min;
  if (legIndex === 0) return existing >= min ? existing : min;
  const max = maxAllowedDepartureDate(min, query, legIndex);
  if (existing >= min && (!max || existing <= max)) return existing;
  return min;
}


function synchronizeStopsWithLegDates(stops, legs) {
  const nextStops = (Array.isArray(stops) ? stops : []).map((stop) => ({ ...stop }));
  for (let index = 0; index < nextStops.length; index += 1) {
    const inboundLeg = Array.isArray(legs) ? legs[index] : null;
    const arrival = safeIsoDate(inboundLeg?.departureDate || inboundLeg?.cheapestOneWay?.departureDate);
    if (!arrival) continue;
    const nights = stopNightsForLeg(nextStops, index);
    nextStops[index].arrivalDate = arrival;
    nextStops[index].departureDate = addDaysIso(arrival, nights);
    nextStops[index].dateSource = inboundLeg?.liveFareVerified ? 'provider-cheap-one-way-date' : (inboundLeg?.dateSource || 'automatic-planning-date');
  }
  return nextStops;
}

function providerEvidenceForLeg(leg = {}) {
  return leg.cheapestOneWay || leg.providerDateEvidence || {};
}

function providerFareAppliedForLeg(leg = {}) {
  const evidence = providerEvidenceForLeg(leg);
  if (evidence.appliedToEstimate === false) return false;
  return !!(leg.liveFareVerified || evidence.providerBacked);
}

function officialDepartureDateForLeg(leg = {}, fallbackDate = null) {
  const evidence = providerEvidenceForLeg(leg);
  const automatic = leg.automaticTourDate || {};
  if (providerFareAppliedForLeg(leg)) {
    return safeIsoDate(evidence.departureDate)
      || safeIsoDate(leg.departureDate)
      || safeIsoDate(leg.dateLabel)
      || safeIsoDate(fallbackDate);
  }
  return safeIsoDate(automatic.departureDate)
    || safeIsoDate(leg.departureDate)
    || safeIsoDate(leg.dateLabel)
    || safeIsoDate(fallbackDate);
}

function itineraryDateConsistency(stops = [], legs = []) {
  const issues = [];
  const safeStops = Array.isArray(stops) ? stops : [];
  const safeLegs = Array.isArray(legs) ? legs : [];
  for (let index = 0; index < safeStops.length; index += 1) {
    const legDate = officialDepartureDateForLeg(safeLegs[index]);
    const arrival = safeIsoDate(safeStops[index]?.arrivalDate);
    const departure = safeIsoDate(safeStops[index]?.departureDate);
    const expectedDeparture = arrival ? addDaysIso(arrival, stopNightsForLeg(safeStops, index)) : null;
    if (legDate && arrival && legDate !== arrival) issues.push({ code: 'arrival-leg-mismatch', stopIndex: index, legDate, arrival });
    if (expectedDeparture && departure && expectedDeparture !== departure) issues.push({ code: 'stay-night-mismatch', stopIndex: index, expectedDeparture, departure });
    const nextLegDate = officialDepartureDateForLeg(safeLegs[index + 1]);
    if (departure && nextLegDate && departure !== nextLegDate) issues.push({ code: 'next-leg-mismatch', stopIndex: index, departure, nextLegDate });
  }
  return { consistent: issues.length === 0, issues };
}

function airlineForLeg(leg, index) {
  if (!legHasFlightComponent677AR1(leg)) return null;
  if (!providerFareAppliedForLeg(leg)) return null;
  const evidence = providerEvidenceForLeg(leg);
  return evidence.airline || leg?.airline || null;
}

function hotelFallbackForStop(stop, index) {
  const city = stop?.city || 'City';
  const sourceHotel = stop?.hotel || {};
  const baseRating = [8.6, 8.3, 8.8, 8.1][index % 4];
  const reviews = [1240, 862, 1740, 640][index % 4];
  return {
    ...sourceHotel,
    name: sourceHotel.name || sourceHotel.hotelName || `${city} central value stay`,
    hotelName: sourceHotel.hotelName || sourceHotel.name || null,
    provider: sourceHotel.provider || sourceHotel.source || 'Agoda',
    source: sourceHotel.source || sourceHotel.estimateSource || 'planning-estimate',
    rating: Number(sourceHotel.rating || sourceHotel.reviewScore || baseRating),
    reviews: Number(sourceHotel.reviews || sourceHotel.reviewCount || reviews),
    reviewSummary: sourceHotel.reviewSummary || 'Guest review estimate pending partner confirmation.',
    bookingUrl: sourceHotel.bookingUrl || sourceHotel.providerUrl || sourceHotel.hotelUrl || sourceHotel.url || null,
    providerUrl: sourceHotel.providerUrl || sourceHotel.bookingUrl || sourceHotel.hotelUrl || sourceHotel.url || null,
    hotelUrl: sourceHotel.hotelUrl || sourceHotel.bookingUrl || sourceHotel.providerUrl || sourceHotel.url || null,
    agodaCityId: sourceHotel.agodaCityId || stop?.agodaCityId || null,
    sampleSize: Number(sourceHotel.sampleSize || 0),
    estimatedStayUsd: Number(sourceHotel.estimatedStayUsd || sourceHotel.totalStayUsd || 0),
    totalStayUsd: Number(sourceHotel.totalStayUsd || sourceHotel.estimatedStayUsd || 0),
    estimatedNightlyUsd: Number(sourceHotel.estimatedNightlyUsd || sourceHotel.averageNightlyUsd || 0),
    averageNightlyUsd: Number(sourceHotel.averageNightlyUsd || sourceHotel.estimatedNightlyUsd || 0)
  };
}

function enrichStopsForPresentation(stops, query) {
  const month = safeMonth(query.month || query.preferredMonth);
  return (Array.isArray(stops) ? stops : []).map((stop, index) => ({
    ...stop,
    arrivalDate: stop.arrivalDate || isoDateFromMonth(month, index * 2),
    departureDate: stop.departureDate || isoDateFromMonth(month, index * 2 + Math.max(1, Number(stop.nights || 2))),
    hotel: hotelFallbackForStop(stop, index)
  }));
}

function enrichLegsForPresentation(legs, query) {
  const month = safeMonth(query.month || query.preferredMonth);
  return (Array.isArray(legs) ? legs : []).map((leg, index) => {
    const isFlight = legHasFlightComponent677AR1(leg);
    // GV-DATE-666B: rejected provider evidence is evidence only. It must never
    // overwrite the official route date shown on cards, calendars, or links.
    const departureDate = officialDepartureDateForLeg(leg, isoDateFromMonth(month, index * 2));
    const verifiedAirline = isFlight ? airlineForLeg(leg, index) : null;
    return {
      ...leg,
      departureDate,
      dateLabel: departureDate,
      airline: verifiedAirline,
      operator: isFlight ? (verifiedAirline || (providerFareAppliedForLeg(leg) ? 'Flight partner option' : 'Estimated flight option')) : (leg.operator || 'Rail or bus partner options'),
      bookingStatus: providerFareAppliedForLeg(leg) ? 'provider-cache-observed' : 'partner-confirmation-required',
      providerVerificationRequired: true
    };
  });
}

function legCode(node) {
  const code = String(node?.airportCode || node?.code || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function displayCurrency(query) {
  return normalizeCurrency(query.currency || 'CAD');
}

function convertProviderPriceToUsd(price, currency) {
  return Number(price || 0) * currencyToUsdRate(currency);
}


function primaryAirportForDisplay(node = {}) {
  const city = String(node.city || node.displayCity || '').trim().toLowerCase();
  const code = String(node.code || '').trim().toUpperCase();
  const airportCode = String(node.airportCode || '').trim().toUpperCase();
  const airports = Array.isArray(node.airportCodes) ? node.airportCodes.map(item => String(item || '').toUpperCase()) : [];
  if ((city === 'montreal' || city === 'montréal' || code === 'YMQ') && (airportCode === 'YUL' || airports.includes('YUL') || code === 'YMQ')) return 'YUL';
  if ((city === 'new york' || city === 'new york city' || code === 'NYC') && (airportCode === 'JFK' || airports.includes('JFK') || code === 'NYC')) return 'JFK';
  if ((city === 'london' || code === 'LON') && (airportCode === 'LHR' || airports.includes('LHR') || code === 'LON')) return 'LHR';
  if ((city === 'paris' || code === 'PAR') && (airportCode === 'CDG' || airports.includes('CDG') || code === 'PAR' || airportCode === 'BVA')) return airportCode === 'ORY' ? 'ORY' : 'CDG';
  return airportCode || code || null;
}

function canonicalizeOriginForDisplay(origin = {}) {
  const primary = primaryAirportForDisplay(origin);
  if (!primary) return origin;
  return { ...origin, code: primary, airportCode: primary, displayCode: primary };
}

function canonicalizeLegEndpoint(node = {}) {
  const primary = primaryAirportForDisplay(node);
  if (!primary) return node;
  return { ...node, code: primary, airportCode: primary, displayCode: primary };
}

function canonicalizeLegsForDisplay(legs = []) {
  return (Array.isArray(legs) ? legs : []).map(leg => ({
    ...leg,
    from: canonicalizeLegEndpoint(leg.from || {}),
    to: canonicalizeLegEndpoint(leg.to || {})
  }));
}

function routeCitiesFromStops(stops) {
  return (Array.isArray(stops) ? stops : []).map((stop) => ({
    id: stop.cityId || stop.id || null,
    city: stop.city,
    country: stop.country || '',
    airportCode: (Array.isArray(stop.airportCodes) && stop.airportCodes[0]) || stop.code || null,
    code: stop.code || (Array.isArray(stop.airportCodes) && stop.airportCodes[0]) || null,
    latitude: stop.latitude,
    longitude: stop.longitude,
    lat: stop.latitude,
    lng: stop.longitude,
    nights: stop.nights,
    hotel: stop.hotel || null,
    gatewayAirport: stop.gatewayAirport || null,
    gatewayAirportCode: stop.gatewayAirport?.airportCode || null,
    localAirportCode: stop.localAirportCode || null,
    destinationAccess: stop.destinationAccess || null,
    destinationAccessEstimateUsd: Number(stop.destinationAccessEstimateUsd || stop?.destinationAccess?.roundTripPartyUsd || 0),
    image: stop.img || stop.image || ''
  }));
}

function buildVisualizerTour(tour, query = {}, enrichment = {}) {
  const displayBudget = tour.displayBudget || {};
  const currency = displayCurrency(query);
  const displayOrigin = canonicalizeOriginForDisplay(tour.origin || {});
  const integrityLegs = canonicalizeLegsForDisplay(Array.isArray(tour.legs) ? tour.legs : []).map(normalizeTransportModeIntegrity677AR1);
  const presentationLegs = enrichLegsForPresentation(integrityLegs, query);
  const dateAlignedStops = synchronizeStopsWithLegDates(Array.isArray(tour.stops) ? tour.stops : [], presentationLegs);
  const presentationStops = enrichStopsForPresentation(dateAlignedStops, query);
  const stops = presentationStops.map(stop => enrichStay(stop, query));
  const cities = routeCitiesFromStops(stops);
  const stays = stops.map((stop, index) => ({
    id: stop.cityId || stop.id || cities[index]?.id || null,
    city: stop.city || cities[index]?.city,
    country: stop.country || cities[index]?.country || '',
    nights: Number(stop.nights || cities[index]?.nights || 0),
    dateLabel: stop.arrivalDate && stop.departureDate ? `${stop.arrivalDate} to ${stop.departureDate}` : 'Flexible timing',
    hotel: stop.hotel || cities[index]?.hotel || null,
    gatewayAirport: stop.gatewayAirport || cities[index]?.gatewayAirport || null,
    destinationAccess: stop.destinationAccess || cities[index]?.destinationAccess || null,
    destinationAccessEstimateUsd: Number(stop.destinationAccessEstimateUsd || cities[index]?.destinationAccessEstimateUsd || 0),
    selectionReason: stop.selectionReason || stop.reason || null
  }));
  const title = tour.title || cities.map((city) => city.city).filter(Boolean).join(' + ') || 'Generated tour';
  const simpleFallback = tour.simpleRouteFallback || null;
  const explanation = Array.isArray(tour.routeExplanation)
    ? tour.routeExplanation.join(' ')
    : (tour.recommendationExplanation || tour.whyCitiesWork || 'Generated from your origin, budget and route evidence.');
  const backendLegs = presentationLegs.map(leg => enrichFlightLeg(leg, query));
  const priceProvenance = {
    ...summarizePriceProvenance(backendLegs, stops),
    liveProviderVerification: tour.liveProviderVerification || enrichment.liveProviderVerification || null
  };
  const dateConsistency = itineraryDateConsistency(stops, backendLegs);
  const scanStartMonth = safeMonth(enrichment?.summary?.month || query.month || query.preferredMonth || defaultScanStartMonth());
  const canonicalDepartureDate = officialDepartureDateForLeg(backendLegs[0]);
  const canonicalReturnDate = officialDepartureDateForLeg(backendLegs[backendLegs.length - 1]);

  return {
    ...tour,
    routeId: tour.tourId || tour.routeId || `generated-${Date.now()}`,
    title,
    cities,
    stays,
    origin: displayOrigin,
    backendLegs,
    recommendationLabel: simpleFallback ? 'Budget-fit simple route' : (tour.tourRoleLabel || tour.recommendationLabel || 'Generated route'),
    recommendationExplanation: explanation,
    whyCitiesWork: explanation,
    generatedTour: {
      enabled: true,
      version: GENERATED_TOUR_VERSION,
      output: 'final-tour-package-visualizer',
      userInputs: ['origin', 'budget', 'passengers'],
      hidesRawFlightSearchFromUser: true,
      partnerLinks: 'prefilled-flight-comparison-and-agoda-stay-links',
      exactDateWindow: exactDateWindow669d(query)
    },
    priceProvenance,
    itineraryDatePlan: {
      version: 'GV-DATE-666B',
      canonicalDepartureDate,
      canonicalReturnDate,
      scanStartMonth,
      scanMonths: cheapDateScanMonths(query),
      consistent: dateConsistency.consistent,
      issues: dateConsistency.issues
    },
    simpleRouteFallback: simpleFallback,
    cheapFlightScanner: enrichment.summary || {
      enabled: scannerEnabled(),
      scannedLegCount: 0,
      liveProviderCallsMade: 0,
      source: scannerEnabled() ? 'not-run' : 'feature-disabled'
    },
    budget: {
      total: { amount: Number(displayBudget.totalBudget || query.budget || 0), currency },
      personalReserve: { amount: Number(displayBudget.reserveAmount || 0), currency },
      personalExpenseReserve: { amount: Number(displayBudget.reserveAmount || 0), currency },
      usableCoreBudget: { amount: Number(displayBudget.usableTripBudget || 0), currency },
      flightRange: {
        minimum: Number(tour?.canonicalPricing?.transportDisplayTotal ?? displayBudget.flightEstimate ?? 0),
        midpoint: Number(tour?.canonicalPricing?.transportDisplayTotal ?? displayBudget.flightEstimate ?? 0),
        maximum: Number(tour?.canonicalPricing?.transportDisplayTotal ?? displayBudget.flightEstimate ?? 0),
        currency
      },
      accommodation: { amount: Number(tour?.canonicalPricing?.stayDisplayTotal ?? displayBudget.accommodationEstimate ?? 0), currency },
      intercity: { amount: 0, currency },
      estimatedCoreTotal: { amount: Number(tour?.canonicalPricing?.canonicalDisplayTotal ?? displayBudget.tripEstimate ?? 0), currency },
      remainingCoreRoom: { amount: Number(displayBudget.amountLeft || 0), currency }
    }
  };
}

function priceTourForParty(tour, query = {}) {
  return attachTourPresentation(applyTravellerPricingToTour(tour, query), query);
}

function transportUsdForLeg(leg) {
  return Number(leg?.estimatedTransportUsd || leg?.estimatedFlightUsd || leg?.amountUsd || 0);
}

function hotelTotalUsdForStops(stops) {
  return (Array.isArray(stops) ? stops : []).reduce((sum, stop) => {
    const direct = Number(stop?.hotel?.estimatedStayUsd || 0);
    if (direct) return sum + direct;
    return sum + Number(stop?.hotel?.estimatedNightlyUsd || 0) * Number(stop?.nights || 0);
  }, 0);
}


function stopHotelEstimateUsd682B(stop = {}) {
  const direct = Number(stop?.hotel?.estimatedStayUsd || stop?.hotel?.totalStayUsd || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const nightly = Number(stop?.hotel?.estimatedNightlyUsd || stop?.hotel?.averageNightlyUsd || 0);
  const nights = Number(stop?.nights || 0);
  return Number.isFinite(nightly) && Number.isFinite(nights) && nightly > 0 && nights > 0 ? nightly * nights : 0;
}

function selectedHotelName682B(stop = {}) {
  const identity = buildPropertyIdentity(stop?.hotel || {}, { city: stop.city || stop?.destination?.city, country: stop.country || stop?.destination?.country });
  return identity.safeForTargetedProviderSearch ? identity.canonicalName : null;
}

function selectedHotelIdentity682C(stop = {}) {
  return buildPropertyIdentity(stop?.hotel || {}, { city: stop.city || stop?.destination?.city, country: stop.country || stop?.destination?.country });
}

async function stay22HotelPricingForCandidate682B({ candidate, stops = [], query = {}, currency } = {}) {
  const schedule = Array.isArray(candidate?.schedule) ? candidate.schedule : [];
  const party = normalizeParty(query);
  const evidence = [];
  let totalUsd = 0;
  let exactMatchedStayCount = 0;
  let requiredStayCount = 0;
  let attemptedRequestCount = 0;

  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index] || {};
    const estimateUsd = stopHotelEstimateUsd682B(stop);
    const checkIn = schedule[index] || null;
    const checkOut = schedule[index + 1] || null;
    const targetIdentity = selectedHotelIdentity682C(stop);
    const targetProperty = targetIdentity.safeForTargetedProviderSearch ? targetIdentity.canonicalName : null;
    const city = stop.city || stop?.destination?.city || null;
    const country = stop.country || stop?.destination?.country || null;
    requiredStayCount += 1;

    if (!checkIn || !checkOut || !city || !targetIdentity.safeForTargetedProviderSearch) {
      totalUsd += estimateUsd;
      evidence.push({ index, city, checkIn, checkOut, targetProperty, applied: false, reason: !targetProperty ? 'missing-selected-property' : 'selected-property-not-specific-enough', estimateUsd: Math.round(estimateUsd) });
      continue;
    }

    attemptedRequestCount += 1;
    let result;
    try {
      result = await fetchStay22Evidence({
        address: [city, country].filter(Boolean).join(', '),
        city,
        country,
        checkIn,
        checkOut,
        adults: party.adults,
        children: party.children,
        rooms: party.rooms,
        currency,
        targetProperty,
        targetIdentity
      });
    } catch (error) {
      result = { status: 'provider-error', productionEligible: false, error: error.message };
    }
    const match = result?.exactPropertyMatch || null;
    const canApply = Boolean(
      result?.productionEligible === true
      && result?.exactStayDates === true
      && match
      && Number(match.totalUsd || 0) > 0
      && result?.propertyMatchDecision?.matched === true
      && Number(result?.propertyMatchDecision?.score || 0) >= Number(result?.matchThreshold || 0.9)
    );
    if (canApply) {
      const rateUsd = Number(match.totalUsd);
      totalUsd += rateUsd;
      exactMatchedStayCount += 1;
      evidence.push({
        index, city, checkIn, checkOut, targetProperty, applied: true,
        rateProvider: 'Stay22', supplier: match.supplier || null,
        propertyName: match.propertyName || null, totalUsd: Number(rateUsd.toFixed(2)),
        originalEstimateUsd: Math.round(estimateUsd), propertyMatchScore: Number(result?.propertyMatchDecision?.score || 0),
        propertyMatchBasis: result?.propertyMatchDecision?.basis || null, propertyIdentityVersion: PROPERTY_IDENTITY_VERSION_682C,
        observedAt: match.observedAt || result.observedAt || null,
        sourceClass: result.sourceClass || 'LIVE_ACCOMMODATION_QUOTE_CANDIDATE'
      });
    } else {
      totalUsd += estimateUsd;
      evidence.push({
        index, city, checkIn, checkOut, targetProperty, applied: false,
        reason: result?.status || 'no-confident-same-property-rate', estimateUsd: Math.round(estimateUsd),
        cityBenchmarkAvailable: Boolean(result?.cityBenchmark), productionEligible: result?.productionEligible === true
      });
    }
  }

  return {
    totalUsd,
    exactMatchedStayCount,
    requiredStayCount,
    attemptedRequestCount,
    evidence,
    basis: exactMatchedStayCount > 0
      ? 'stay22-same-property-exact-stay-rates-plus-unmatched-planning-estimates'
      : 'existing-planning-estimates-not-date-specific'
  };
}

function totalEstimateUsdForState(tour, legsOverride, query = {}) {
  const legs = Array.isArray(legsOverride) ? legsOverride : (Array.isArray(tour?.legs) ? tour.legs : []);
  const stops = enrichStopsForPresentation(Array.isArray(tour?.stops) ? tour.stops : [], query);
  const transport = legs.reduce((sum, leg) => sum + transportUsdForLeg(leg), 0);
  const originAccess = Number(tour?.originAccessEstimateUsd || tour?.passengerPricing?.originAccessEstimateUsd || 0);
  const hotels = hotelTotalUsdForStops(stops) || Number(tour?.totalHotelEstimateUsd || 0);
  const total = Math.round(transport + originAccess + hotels);
  return total || Number(tour?.estimatedTotalUsd || 0);
}

function recomputeTourTotals(tour, query) {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const stops = enrichStopsForPresentation(Array.isArray(tour.stops) ? tour.stops : [], query);
  return priceTourForParty({ ...tour, legs, stops }, query);
}


function totalEstimateUsdFromTour(tour, query = {}) {
  return totalEstimateUsdForState(tour, null, query);
}

function budgetCeilingUsd(tour, query = {}) {
  const direct = Number(tour?.totalBudgetUsd || query.budgetUsd || 0);
  if (Number.isFinite(direct) && direct > 0) return direct + Math.max(5, direct * 0.005);
  const amount = Number(query.budget || 0);
  if (!Number.isFinite(amount) || amount <= 0) return Infinity;
  const rate = currencyToUsdRate(displayCurrency(query));
  const usd = amount * rate;
  return usd + Math.max(5, usd * 0.005);
}

function isOverUserBudget(tour, query = {}) {
  return totalEstimateUsdFromTour(tour, query) > budgetCeilingUsd(tour, query);
}

// GV-REC-684B-R3: final public budget-fit decisions must agree with the
// traveller's entered/displayed currency. The older generic planning guard adds
// a small USD tolerance so planning candidates are not discarded on rounding
// noise. That tolerance is useful during planning but is not allowed to make a
// visibly over-budget live-priced route (for example C$1,505 against C$1,500)
// claim that it fits. Prefer the entered display budget when present so the
// backend decision and UI-visible whole-currency total use the same unit/rounding.
function strictBudgetFit684BR3(tour, query = {}) {
  const totalUsd = Number(totalEstimateUsdFromTour(tour, query) || 0);
  const currency = normalizeCurrency(displayCurrency(query));
  const rateToUsd = currencyToUsdRate(currency);
  const rawEnteredBudget = Number(query.budget ?? query.totalBudget ?? 0);
  if (Number.isFinite(rawEnteredBudget) && rawEnteredBudget > 0) {
    const totalDisplay = Math.round(totalUsd / Math.max(0.000001, rateToUsd));
    const budgetDisplay = Math.round(rawEnteredBudget);
    return {
      version: 'GV-REC-684B-R3',
      source: 'entered-display-budget',
      currency,
      totalUsd,
      budgetUsd: rawEnteredBudget * rateToUsd,
      totalDisplay,
      budgetDisplay,
      overBudget: totalDisplay > budgetDisplay
    };
  }
  const explicitBudgetUsd = Number(query.budgetUsd || 0);
  const tourBudgetUsd = Number(tour?.totalBudgetUsd || 0);
  const budgetUsd = Number.isFinite(explicitBudgetUsd) && explicitBudgetUsd > 0
    ? explicitBudgetUsd
    : (Number.isFinite(tourBudgetUsd) && tourBudgetUsd > 0 ? tourBudgetUsd : Infinity);
  return {
    version: 'GV-REC-684B-R3',
    source: Number.isFinite(explicitBudgetUsd) && explicitBudgetUsd > 0 ? 'explicit-budget-usd' : 'tour-budget-usd',
    currency: 'USD',
    totalUsd,
    budgetUsd,
    totalDisplay: Math.round(totalUsd),
    budgetDisplay: Number.isFinite(budgetUsd) ? Math.round(budgetUsd) : null,
    overBudget: Number.isFinite(budgetUsd) ? totalUsd > budgetUsd : false
  };
}

function isOverUserBudgetStrict684BR3(tour, query = {}) {
  return strictBudgetFit684BR3(tour, query).overBudget === true;
}

function rolePriorityForFinalTour(role) {
  const text = String(role || '').toLowerCase();
  if (text.includes('most-memorable')) return 360;
  if (text.includes('best-balance')) return 345;
  if (text.includes('lowest-cost')) return 285;
  return 300;
}

function countryKeyFromNode(node) {
  return String(node?.country || node?.countryName || node?.countryCode || '').trim().toLowerCase();
}

function automaticTourCandidateScore(tour, query = {}) {
  const stops = Array.isArray(tour?.stops) ? tour.stops : [];
  const originCountry = countryKeyFromNode(tour?.origin);
  const stopCountries = new Set(stops.map(countryKeyFromNode).filter(Boolean));
  const outsideOrigin = originCountry ? stops.filter(stop => countryKeyFromNode(stop) && countryKeyFromNode(stop) !== originCountry).length : 0;
  const total = totalEstimateUsdFromTour(tour, query);
  const ceiling = budgetCeilingUsd(tour, query);
  const utilisation = Number.isFinite(ceiling) && ceiling > 0 ? total / ceiling : 0.75;
  const budgetFit = Math.max(0, 120 - Math.abs(0.78 - utilisation) * 140);
  const stopCountScore = Math.min(120, stops.length * 32);
  const countryScore = Math.min(180, stopCountries.size * 45 + outsideOrigin * 36);
  const distanceScore = Math.min(120, Math.max(0, Number(tour?.totalDistanceKm || 0) / 55));
  const allSameCountryPenalty = outsideOrigin === 0 && ceiling > 900 ? 130 : 0;
  const lowVarietyPenalty = stops.length >= 2 && stopCountries.size <= 1 && ceiling > 1100 ? 80 : 0;
  const multiCityPreference = String(query.recommendationScope || '').toLowerCase().includes('multicity')
    ? (stops.length >= 2 ? 220 : -280)
    : 0;
  return rolePriorityForFinalTour(tour?.tourRole || tour?.recommendationLabel)
    + budgetFit
    + stopCountScore
    + countryScore
    + distanceScore
    + multiCityPreference
    + preferenceMatchAdjustment680BR1(tour, query)
    - allSameCountryPenalty
    - lowVarietyPenalty
    - Math.max(0, utilisation - 0.95) * 120;
}

function affordableFlightDiscoveryCandidateScore684B(tour = {}, query = {}) {
  const requested = requestedPickRole670a(query);
  const destinationValueAdjustment = destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(tour, query).adjustment : 0;
  if (requested === 'most-memorable') return threePickMemorableScore670aR2(tour, query) + destinationValueAdjustment;
  if (requested === 'best-balance') return threePickBalanceScore670aR2(tour, query) + destinationValueAdjustment;
  return automaticTourCandidateScore(tour, query) + destinationValueAdjustment;
}

function selectBudgetSafeTour(tours = [], query = {}) {
  const list = Array.isArray(tours) ? tours.filter(Boolean) : [];
  if (!list.length) return null;
  const feasible = list.filter(tour => !isOverUserBudget(tour, query));
  if (!feasible.length) return null;
  const requestedRole = String(query.routeRole || query.tourRole || '').trim().toLowerCase();
  if (requestedRole) {
    const requested = feasible.filter(t => String(t.tourRole || '').toLowerCase().includes(requestedRole));
    if (requested.length) {
      return requested.slice().sort((a, b) => automaticTourCandidateScore(b, query) - automaticTourCandidateScore(a, query)
        || totalEstimateUsdFromTour(a, query) - totalEstimateUsdFromTour(b, query))[0];
    }
  }
  // GV-FLIGHT-657C: the public generated-tour page should feel like one useful
  // automatic tour, not merely the closest/cheapest route. Preserve budget safety,
  // then gently prefer routes with more memorable role, more stops, and more
  // country/region variety when the budget can support it.
  return feasible.slice().sort((a, b) => {
    const aWhole = wholeTripRouteOptimization677CEnabled() ? wholeTripCandidateAdjustment677C(a, query).adjustment : 0;
    const bWhole = wholeTripRouteOptimization677CEnabled() ? wholeTripCandidateAdjustment677C(b, query).adjustment : 0;
    const aDestinationValue = destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(a, query).adjustment : 0;
    const bDestinationValue = destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(b, query).adjustment : 0;
    const score = (automaticTourCandidateScore(b, query) + bWhole + bDestinationValue) - (automaticTourCandidateScore(a, query) + aWhole + aDestinationValue);
    if (score) return score;
    return totalEstimateUsdFromTour(a, query) - totalEstimateUsdFromTour(b, query);
  })[0] || null;
}

function canApplyProviderPrice({ tour, query, currentLeg, providerUsd, legs }) {
  const currentTransport = transportUsdForLeg(currentLeg);
  const providerPartyUsd = providerFarePartyTotalUsd(providerUsd, query);
  const currentTotal = totalEstimateUsdForState(tour, legs, query);
  const nextTotal = currentTotal - currentTransport + providerPartyUsd;
  return {
    providerPerPassengerUsd: Math.round(Number(providerUsd || 0)),
    providerPartyUsd,
    nextTotalUsd: Math.round(nextTotal),
    currentTotalUsd: Math.round(currentTotal),
    ceilingUsd: Math.round(budgetCeilingUsd(tour, query)),
    apply: nextTotal <= budgetCeilingUsd(tour, query)
  };
}


function providerDateOptions(result) {
  const rows = Array.isArray(result?.observations) ? result.observations : [];
  return rows.slice(0, 12).map((row) => ({
    departureDate: row.departureDate,
    departureTime: row.departureTime || null,
    arrivalTime: row.arrivalTime || null,
    price: row.price,
    currency: row.currency,
    airline: row.airline || null,
    transfers: row.transfers,
    durationMinutes: row.durationMinutes,
    durationLabel: row.durationLabel || null,
    timingQuality: row.timingQuality,
    timingLabel: row.timingLabel || null,
    smartFlightDateSelectionVersion: row.smartFlightDateSelectionVersion || null,
    smartFlightScore: Number.isFinite(Number(row.smartFlightScore)) ? Number(row.smartFlightScore) : null,
    dateShiftDays: Number.isFinite(Number(row.dateShiftDays)) ? Number(row.dateShiftDays) : null,
    usefulTimeWarnings: Array.isArray(row.usefulTimeWarnings) ? row.usefulTimeWarnings : [],
    bookingLink: row.bookingLink || null,
    source: row.source || 'travelpayouts-provider-cache'
  }));
}


function monthsCoveringDateRange681BP2(startDate, endDate) {
  const start = safeIsoDate(startDate);
  const end = safeIsoDate(endDate);
  if (!start || !end || end < start) return [];
  const startMonth = new Date(`${start.slice(0, 7)}-01T12:00:00Z`);
  const endMonth = end.slice(0, 7);
  const out = [];
  for (let i = 0; i < 3; i += 1) {
    const key = startMonth.toISOString().slice(0, 7);
    out.push(key);
    if (key === endMonth) break;
    startMonth.setUTCMonth(startMonth.getUTCMonth() + 1);
  }
  return out;
}

function mergeMonthlyProviderResults681BP2(results = [], metadata = {}) {
  const byDate = new Map();
  let supported = false;
  let cacheHitCount = 0;
  let providerContract = null;
  let endpointUsed = null;
  const months = [];
  for (const item of results) {
    const result = item?.result || item || {};
    const month = item?.month || result.month || null;
    if (month) months.push(month);
    if (result.supported) supported = true;
    if (result.cacheHit) cacheHitCount += 1;
    if (!providerContract && result.providerContract) providerContract = result.providerContract;
    if (!endpointUsed && result.endpointUsed) endpointUsed = result.endpointUsed;
    for (const row of (Array.isArray(result.observations) ? result.observations : [])) {
      const d = safeIsoDate(row?.departureDate);
      if (!d || Number(row?.price) <= 0) continue;
      const current = byDate.get(d);
      if (!current || Number(row.price) < Number(current.price)) byDate.set(d, row);
    }
  }
  const observations = [...byDate.values()].sort((a, b) => String(a.departureDate).localeCompare(String(b.departureDate)) || Number(a.price) - Number(b.price));
  return {
    supported: supported && observations.length > 0,
    reason: observations.length ? null : 'no-exact-date-observations-in-p2-window',
    origin: metadata.origin || null,
    destination: metadata.destination || null,
    currency: metadata.currency || null,
    observations,
    endpointUsed: endpointUsed || 'provider-neutral-month-window-681b-p2',
    providerContract,
    fetchedAt: observations[0]?.providerFetchedAt || null,
    cacheHit: cacheHitCount === results.length && results.length > 0,
    months: months.length,
    scannedMonths: months.map(month => ({ month })),
    p2WindowMonths: months
  };
}

async function buildWholeTripDatePlan681BP2({ tour, legs = [], stops = [], query = {}, currency } = {}) {
  const disabled = !wholeTripDateOptimizer681BP2Enabled()
    || isExactDateRequest680B(query)
    || !automaticCheapDateTourBuilderEnabled()
    || !Array.isArray(legs)
    || legs.length < 2
    || !legHasFlightComponent677AR1(legs[0]);
  if (disabled) return null;

  const minimumDate = initialAutomaticStartDate(query);
  const maximumShiftDays = automaticFirstLegWindowDays681BP1(query);
  const latestStartDate = addDaysIso(minimumDate, maximumShiftDays);
  const totalStayNights = (Array.isArray(stops) ? stops : []).reduce((sum, stop) => sum + stopNightsForLeg([stop], 0), 0);
  const latestRequiredDate = addDaysIso(latestStartDate, totalStayNights);
  const months = monthsCoveringDateRange681BP2(minimumDate, latestRequiredDate);
  if (!months.length) return null;

  const requestCache = new Map();
  let providerFetchRequests = 0;
  const providerResults = [];
  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    if (pureGroundLeg677AR1(leg) || !legHasFlightComponent677AR1(leg)) {
      providerResults[index] = { supported: false, reason: 'non-flight-leg', observations: [] };
      continue;
    }
    const origin = legCode(leg.from);
    const destination = legCode(leg.to);
    if (!origin || !destination) {
      providerResults[index] = { supported: false, reason: 'missing-provider-airport-code', observations: [] };
      continue;
    }
    const monthly = [];
    for (const month of months) {
      const key = `${origin}:${destination}:${currency}:${month}`;
      let promise = requestCache.get(key);
      if (!promise) {
        providerFetchRequests += 1;
        promise = fetchFlightDates683C({ origin, destination, currency, month, limit: 31 });
        requestCache.set(key, promise);
      }
      monthly.push({ month, result: await promise });
    }
    const merged = mergeMonthlyProviderResults681BP2(monthly, { origin, destination, currency });
    merged.observations = merged.observations.map((row) => selectBestUsableObservation([row], {
      ...selectionContext677B(tour, query, row.departureDate, index, leg),
      targetDate: row.departureDate,
      maxDateShiftDays: 0
    }) || row);
    providerResults[index] = merged;
  }

  const starts = candidateStartDates681BP2({
    firstLegResult: providerResults[0] || {},
    minimumDate,
    maximumShiftDays
  });
  const seededStarts683H = duffelP2Enabled683H(process.env, query)
    ? seedCandidateStarts683H(starts, minimumDate, maximumShiftDays, duffelP2Status683H(process.env, query).candidateCap)
    : starts;
  if (!starts.length && !duffelP2Enabled683H(process.env, query)) {
    return {
      applied: false,
      providerResults,
      selected: null,
      summary: {
        enabled: true,
        version: WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2,
        applied: false,
        reason: 'no-provider-backed-first-leg-candidates',
        minimumDate,
        maximumShiftDays,
        providerFetchRequests,
        candidateCount: 0,
        completeCandidateCount: 0,
        fullyPricedCandidateCount: 0,
        incompleteCandidateCount: 0,
        missingFlightObservationCount: 0,
        missingFlightObservationDiagnostics: [],
        budgetFitCandidateCount: 0,
        truthfulnessRepairVersion: 'GV-TRUST-681B-P2-R2',
        hotelPricingBasis: 'existing-planning-estimates-not-date-specific',
        flightPricingBasis: providerResults[0]?.providerContract?.provider?.evidenceClass === 'LIVE_PROVIDER' ? 'live-exact-date-provider-observations' : 'cached-exact-date-provider-observations',
        flightProviderContract: adapterSummary683C()
      }
    };
  }

  const party = normalizeParty(query);
  const hotelEstimateUsd = hotelTotalUsdForStops(stops) || Number(tour?.totalHotelEstimateUsd || 0);
  const originAccessEstimateUsd = Number(tour?.originAccessEstimateUsd || tour?.passengerPricing?.originAccessEstimateUsd || 0);
  const destinationAccessEstimateUsd = (Array.isArray(stops) ? stops : []).reduce((sum, stop) => sum + Number(stop?.destinationAccessEstimateUsd || stop?.destinationAccess?.roundTripPartyUsd || 0), 0);

  let activeProviderResults681BP2 = providerResults;
  let activeStarts681BP2 = starts;
  let duffelP2Staging683H = {
    version: VERSION_683H,
    attempted: false,
    appliedToP2Ranking: false,
    status: duffelP2Status683H(process.env, query),
    reason: duffelP2Enabled683H(process.env, query) ? 'not-attempted' : '683h-normal-flow-disabled'
  };

  // 683H is an explicit staging-only promotion gate. The legacy provider still
  // discovers the flexible candidate dates, then Duffel must independently
  // provide live exact-date evidence for every flight leg in at least two full
  // schedules before it is allowed to replace the P2 ranking evidence.
  if (duffelP2Enabled683H(process.env, query)) {
    const live683H = await buildLiveProviderResults683H({
      candidateStarts: seededStarts683H,
      baselineFirstLegResult: providerResults[0] || {},
      legs,
      stops,
      query,
      displayCurrency: currency
    });
    duffelP2Staging683H = {
      version: VERSION_683H,
      attempted: true,
      appliedToP2Ranking: Boolean(live683H?.supported),
      reason: live683H?.reason || null,
      status: duffelP2Status683H(process.env, query),
      candidateStarts: live683H?.candidateStarts || [],
      completeLiveScheduleCount: Number(live683H?.completeScheduleCount || 0),
      providerRequests: Number(live683H?.state?.requests || 0),
      exactRequests: Number(live683H?.state?.exactRequests || 0),
      metroRequests: Number(live683H?.state?.metroRequests || 0),
      fxFailures: Number(live683H?.state?.fxFailures || 0),
      providerAbortEvents: Number(live683H?.state?.providerAbortEvents || 0),
      providerAbortReason: live683H?.state?.abortReason || null,
      requestBudgetPlan: live683H?.requestBudgetPlan || null,
      latencyOptimization683M: live683H?.latency683M || null,
      rateLimitRecovery683MR3: live683H?.latency683M?.rateLimitRecovery683MR3 || null,
      proactiveQuotaScheduling683MR3: live683H?.latency683M?.proactiveQuotaScheduling683MR3 || null,
      quotaReservationScheduling683MR4: live683H?.latency683M?.quotaReservationScheduling683MR4 || null,
      quotaAwareFailClosed683MR3: live683H?.state?.proactiveQuotaFailClosed683MR3 === true,
      quotaAwareFailClosedReason683MR3: live683H?.state?.proactiveQuotaFailClosedReason683MR3 || null,
      providerConcurrencyPeak683M: Number(live683H?.state?.providerConcurrencyPeak683M || 0),
      deduplicatedRequests683M: Number(live683H?.state?.deduplicatedRequests683M || 0),
      candidateDiagnostics: Array.isArray(live683H?.candidateDiagnostics) ? live683H.candidateDiagnostics : []
    };
    if (live683H?.supported) {
      activeProviderResults681BP2 = live683H.providerResults;
      activeStarts681BP2 = live683H.candidateStarts;
    }
  }

  const convertForActiveP2681B = (price, observedCurrency, observation) => {
    if (duffelP2Staging683H.appliedToP2Ranking && Number(observation?.rankingPriceUsd) > 0) return Number(observation.rankingPriceUsd);
    return convertProviderPriceToUsd(price, observedCurrency || currency);
  };

  let candidates = activeStarts681BP2.map(startDate => evaluateWholeTripDateCandidate681BP2({
    startDate,
    stops,
    legs,
    providerResults: activeProviderResults681BP2,
    isFlightLeg: legHasFlightComponent677AR1,
    isGroundLeg: pureGroundLeg677AR1,
    convertProviderPriceToUsd: convertForActiveP2681B,
    flightFareUnits: party.flightFareUnits,
    originAccessEstimateUsd,
    destinationAccessEstimateUsd,
    hotelEstimateUsd
  })).filter(Boolean);

  const stay22Pricing = {
    enabled: stay22EvidenceEnabled682B(),
    version: STAY22_EVIDENCE_VERSION_682B,
    optimizerFlagEnabled: stay22P2DatePricingEnabled682B(),
    eligibleForOptimizer: stay22P2OptimizerEligible682B(),
    callCap: stay22P2MaxRequests682B(),
    attemptedRequestCount: 0,
    exactMatchedStayCount: 0,
    unmatchedStayCount: 0,
    candidateCountPriced: 0,
    reason: null
  };

  // 682B never lets a partial Stay22 scan bias P2. Only candidates that already have
  // complete provider-backed flight coverage can win. If pricing every specific selected
  // property across those candidates would exceed the configured cap, no candidate gets
  // Stay22 pricing and all candidates retain the same P2 hotel-estimate basis.
  const completeForStay22 = candidates.filter(candidate => candidate.completeProviderFlightCoverage === true);
  const usefulStayTargets = (Array.isArray(stops) ? stops : []).filter(stop => selectedHotelIdentity682C(stop).safeForTargetedProviderSearch).length;
  const requiredStay22Requests = completeForStay22.length * usefulStayTargets;
  stay22Pricing.requiredRequestCount = requiredStay22Requests;

  if (!stay22Pricing.eligibleForOptimizer) {
    stay22Pricing.reason = !stay22Pricing.enabled
      ? 'stay22-evidence-disabled'
      : (!stay22Pricing.optimizerFlagEnabled
        ? 'stay22-p2-date-pricing-disabled'
        : (!String(process.env.STAY22_API_KEY || '').trim()
          ? 'stay22-api-key-missing'
          : 'stay22-production-approval-not-confirmed'));
  } else if (!completeForStay22.length) {
    stay22Pricing.reason = 'no-complete-provider-flight-candidates-to-price';
  } else if (!usefulStayTargets) {
    stay22Pricing.reason = 'no-specific-selected-hotel-targets';
  } else if (requiredStay22Requests > stay22Pricing.callCap) {
    stay22Pricing.reason = 'stay22-candidate-request-cap-would-be-exceeded';
  } else {
    const pricedByStart = new Map();
    for (const baseline of completeForStay22) {
      const hotelPricing = await stay22HotelPricingForCandidate682B({ candidate: baseline, stops, query, currency });
      stay22Pricing.attemptedRequestCount += Number(hotelPricing.attemptedRequestCount || 0);
      stay22Pricing.exactMatchedStayCount += Number(hotelPricing.exactMatchedStayCount || 0);
      stay22Pricing.unmatchedStayCount += Math.max(0, Number(hotelPricing.requiredStayCount || 0) - Number(hotelPricing.exactMatchedStayCount || 0));
      stay22Pricing.candidateCountPriced += 1;
      pricedByStart.set(baseline.startDate, hotelPricing);
    }
    candidates = candidates.map((baseline) => {
      const hotelPricing = pricedByStart.get(baseline.startDate);
      if (!hotelPricing) return baseline;
      return evaluateWholeTripDateCandidate681BP2({
        startDate: baseline.startDate,
        stops,
        legs,
        providerResults: activeProviderResults681BP2,
        isFlightLeg: legHasFlightComponent677AR1,
        isGroundLeg: pureGroundLeg677AR1,
        convertProviderPriceToUsd: convertForActiveP2681B,
        flightFareUnits: party.flightFareUnits,
        originAccessEstimateUsd,
        destinationAccessEstimateUsd,
        hotelEstimateUsd,
        hotelPricing
      });
    }).filter(Boolean);
    stay22Pricing.reason = stay22Pricing.exactMatchedStayCount > 0
      ? 'same-property-exact-stay-rates-applied-to-eligible-candidates'
      : 'no-confident-same-property-rates-matched';
  }

  const selection = selectWholeTripDateCandidate681BP2(candidates, { budgetCeilingUsd: budgetCeilingUsd(tour, query) });
  // One complete schedule is evidence, not optimization. P2 changes the itinerary
  // only when at least two complete exact-date flight schedules can actually be compared.
  const applied = Boolean(selection.selected && selection.completeCandidateCount >= 2 && selection.budgetFitCandidateCount >= 1 && selection.selected.budgetFit !== false);
  const selected = applied ? selection.selected : null;
  const quotaAwareFailClosedReason683MR3 = duffelP2Staging683H.quotaAwareFailClosed683MR3 === true
    ? '683m-r4-provider-quota-window-fail-closed'
    : null;
  const liveSelectionFailClosedReason683JR1 = quotaAwareFailClosedReason683MR3 || classifyLiveSelectionFailClosed683JR1({
    applied,
    duffelAppliedToRanking: duffelP2Staging683H.appliedToP2Ranking === true,
    selection
  });
  const liveSelectionFailClosed683JR1 = Boolean(liveSelectionFailClosedReason683JR1);
  if (liveSelectionFailClosed683JR1) {
    duffelP2Staging683H.selectionFailClosed683JR1 = true;
    duffelP2Staging683H.selectionFailClosedReason683JR1 = liveSelectionFailClosedReason683JR1;
    if (quotaAwareFailClosedReason683MR3) {
      duffelP2Staging683H.selectionFailClosed683MR3 = true;
      duffelP2Staging683H.selectionFailClosedReason683MR3 = quotaAwareFailClosedReason683MR3;
    }
  }
  const candidateDigest = candidates.map(candidate => ({
    startDate: candidate.startDate,
    schedule: candidate.schedule,
    completeProviderFlightCoverage: candidate.completeProviderFlightCoverage,
    missingFlightLegCount: candidate.missingFlightLegs.length,
    missingFlightLegs: candidate.missingFlightLegs.map((missing) => {
      const leg = legs[missing.index] || {};
      const from = leg?.from || {};
      const to = leg?.to || {};
      return {
        index: missing.index,
        targetDate: missing.targetDate,
        fromCode: String(from.airportCode || from.code || '').toUpperCase() || null,
        toCode: String(to.airportCode || to.code || '').toUpperCase() || null,
        fromCity: from.city || null,
        toCity: to.city || null
      };
    }),
    mixedEvidenceTotalUsd: candidate.mixedEvidenceTotalUsd,
    providerFlightTotalUsd: candidate.providerFlightTotalUsd,
    hotelEstimateUsd: candidate.hotelEstimateUsd,
    hotelPricingBasis: candidate.hotelPricingBasis || 'existing-planning-estimates-not-date-specific',
    stay22ExactMatchedStayCount: Number(candidate.stay22ExactMatchedStayCount || 0),
    stay22RequiredStayCount: Number(candidate.stay22RequiredStayCount || 0),
    stay22HotelEvidence: Array.isArray(candidate.stay22HotelEvidence) ? candidate.stay22HotelEvidence : [],
    totalDurationMinutes: candidate.totalDurationMinutes,
    totalTransfers: candidate.totalTransfers,
    limitedProviderLegs: candidate.limitedProviderLegs,
    cautionProviderLegs: candidate.cautionProviderLegs,
    qualityEligible: candidate.qualityEligible
  }));
  const missingFlightObservationDiagnostics = [];
  const seenMissingFlightObservations = new Set();
  for (const candidate of candidateDigest) {
    for (const missing of candidate.missingFlightLegs || []) {
      const key = `${missing.fromCode || missing.fromCity || '?'}:${missing.toCode || missing.toCity || '?'}:${missing.targetDate || '?'}`;
      if (seenMissingFlightObservations.has(key)) continue;
      seenMissingFlightObservations.add(key);
      missingFlightObservationDiagnostics.push({
        startDate: candidate.startDate,
        ...missing
      });
    }
  }
  return {
    applied,
    // 683J-R1 fail-closed: live schedules may be evaluated, but if no live
    // schedule is actually selected, do not leak candidate Duffel observations
    // into the later per-leg fallback path. Fall back to the baseline provider
    // result set and keep the live rejection visible in diagnostics.
    providerResults: liveSelectionFailClosed683JR1 ? providerResults : activeProviderResults681BP2,
    selected,
    summary: {
      enabled: true,
      version: WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2,
      applied,
      reason: applied ? 'lowest-mixed-evidence-complete-flight-schedule-selected' : (liveSelectionFailClosedReason683JR1 || (selection.completeCandidateCount < 2 ? 'fewer-than-two-complete-provider-backed-flight-schedules' : (Number(selection.qualityEligibleCandidateCount || 0) === 0 ? 'all-complete-schedules-have-limited-flight-evidence' : 'no-budget-fit-complete-schedule'))) ,
      liveSelectionFailClosed683JR1,
      liveSelectionFailClosedReason683JR1,
      liveSelectionFailClosed683MR3: Boolean(quotaAwareFailClosedReason683MR3),
      liveSelectionFailClosedReason683MR3: quotaAwareFailClosedReason683MR3,
      minimumDate,
      maximumShiftDays,
      windowMonths: months,
      providerFetchRequests,
      duffelP2Staging683H,
      liveProviderFetchRequests683H: Number(duffelP2Staging683H.providerRequests || 0),
      candidateCount: candidates.length,
      completeCandidateCount: selection.completeCandidateCount,
      fullyPricedCandidateCount: selection.completeCandidateCount,
      incompleteCandidateCount: Math.max(0, candidates.length - Number(selection.completeCandidateCount || 0)),
      missingFlightObservationCount: missingFlightObservationDiagnostics.length,
      missingFlightObservationDiagnostics,
      budgetFitCandidateCount: selection.budgetFitCandidateCount,
      qualityEligibleCandidateCount: Number(selection.qualityEligibleCandidateCount || 0),
      truthfulnessRepairVersion: 'GV-TRUST-681B-P2-R2',
      selectedStartDate: selected?.startDate || null,
      selectedSchedule: selected?.schedule || null,
      selectedMixedEvidenceTotalUsd: selected?.mixedEvidenceTotalUsd || null,
      selectedProviderFlightTotalUsd: selected?.providerFlightTotalUsd || null,
      hotelPricingBasis: selected?.hotelPricingBasis || (stay22Pricing.exactMatchedStayCount > 0 ? 'stay22-same-property-exact-stay-rates-plus-unmatched-planning-estimates' : 'existing-planning-estimates-not-date-specific'),
      selectedStay22ExactMatchedStayCount: Number(selected?.stay22ExactMatchedStayCount || 0),
      selectedStay22RequiredStayCount: Number(selected?.stay22RequiredStayCount || 0),
      stay22Pricing,
      flightPricingBasis: (duffelP2Staging683H.appliedToP2Ranking && applied)
        ? (duffelP2Staging683H?.status?.productionCanary683KAuthorized === true
          ? 'duffel-live-exact-date-production-canary-evidence-683m-r4'
          : 'duffel-live-exact-date-staging-evidence-683h')
        : (liveSelectionFailClosed683JR1
          ? 'baseline-provider-evidence-live-selection-fail-closed-683j-r1'
          : (activeProviderResults681BP2[0]?.providerContract?.provider?.evidenceClass === 'LIVE_PROVIDER' ? 'live-exact-date-provider-observations' : 'cached-exact-date-provider-observations')),
      flightProviderContract: adapterSummary683C(),
      rankingPolicy: liveSelectionFailClosed683JR1
        ? `683J-R1 fail-closed: Duffel live schedules were evaluated but no safe live schedule was selected (${liveSelectionFailClosedReason683JR1}); candidate live observations are not reused for per-leg fallback; baseline evidence remains explicitly non-live unless independently proven`
        : (duffelP2Staging683H.appliedToP2Ranking
          ? (duffelP2Staging683H?.status?.productionCanary683KAuthorized === true
            ? '683M-R4 production canary: bounded concurrency<=2 with request-scoped dedupe and quota-reservation scheduling; each independent-leg batch is sized as min(2, provider remaining quota, outstanding legs), so remaining=2 may reserve a pair, remaining=1 runs serial, and remaining=0 uses the bounded provider-reset gate or fails closed without a provider launch; one provider-reset-aware 429 recovery attempt remains available and retries consume the existing request budget; compare at least two complete synchronized schedules; every selected flight leg keeps canonical Duffel LIVE exact-date evidence through the final tour boundary; exact airport is tried first and same-city metro fallback is explicitly labelled; fresh 683G FX normalizes provider currency to USD for ranking; unmatched hotel, ground and access amounts remain planning estimates; never let an incomplete schedule win; normal production requests remain unchanged'
            : '683J-R1 staging only: compare at least two complete synchronized schedules; every selected flight leg keeps canonical Duffel LIVE exact-date evidence through the final tour boundary; exact airport is tried first and same-city metro fallback is explicitly labelled; fresh 683G FX normalizes provider currency to USD for staging ranking; unmatched hotel, ground and access amounts remain planning estimates; never let an incomplete schedule win')
          : 'compare complete route schedules; every flight leg must have an exact-date provider observation; exact-date same-property production-approved Stay22 rates may replace only the matching selected stay estimate; city-wide alternatives never affect ranking; unmatched stays, ground and access remain planning estimates; never label an incomplete schedule cheapest'),
      candidates: candidateDigest
    }
  };
}

async function fetchCheapDateEvidenceForLeg({ origin, destination, currency, query, startMonth } = {}) {
  if (scanner650BEnabled() || String(process.env.ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A || '').trim().toLowerCase() === 'true') {
    return fetchFlightAcrossMonths683C({
      origin,
      destination,
      currency,
      startMonth: defaultScanStartMonth(startMonth || query.month || query.preferredMonth),
      months: cheapDateScanMonths(query),
      limitPerMonth: 8,
      limit: 12
    });
  }
  return fetchFlightDates683C({ origin, destination, currency, month: safeMonth(startMonth || query.month || query.preferredMonth), limit: 8 });
}

async function enrichTourWithCheapFlights(tour, query = {}) {
  if (!scannerEnabled()) {
    const exactTour = exactDateWindow669d(query) ? applyExactDateWindow669d(tour, query) : tour;
    return { tour: exactTour, summary: { enabled: false, scannedLegCount: 0, liveProviderCallsMade: 0, source: 'feature-disabled', exactDateWindowPreserved: Boolean(exactDateWindow669d(query)) } };
  }
  const month = defaultScanStartMonth(query.month || query.preferredMonth);
  const currency = displayCurrency(query);
  const exactWindow = exactDateWindow669d(query);
  const exactAlignedTour = exactWindow ? applyExactDateWindow669d(tour, query) : tour;
  const legs = Array.isArray(exactAlignedTour.legs) ? exactAlignedTour.legs.map(leg => normalizeTransportModeIntegrity677AR1({ ...leg })) : [];
  const stops = Array.isArray(exactAlignedTour.stops) ? exactAlignedTour.stops.map(stop => ({ ...stop })) : [];
  let workingTour = { ...exactAlignedTour, legs, stops };
  let liveProviderCallsMade = 0;
  let supportedObservations = 0;
  let appliedObservationCount = 0;
  let skippedOverBudgetCount = 0;
  let selectedProviderDateCount = 0;
  let estimatedDateFallbackCount = 0;
  const scanned = [];

  const automaticBuilder = automaticCheapDateTourBuilderEnabled();
  let nextEarliestDate = automaticBuilder ? initialAutomaticStartDate(query) : null;
  const wholeTripDatePlan681BP2 = automaticBuilder && !exactWindow
    ? await buildWholeTripDatePlan681BP2({ tour: workingTour, legs, stops, query, currency })
    : null;
  if (wholeTripDatePlan681BP2?.applied && wholeTripDatePlan681BP2?.selected?.startDate) {
    nextEarliestDate = wholeTripDatePlan681BP2.selected.startDate;
  }

  for (let index = 0; index < legs.length && scanned.length < MAX_SCANNED_LEGS; index += 1) {
    const leg = legs[index];
    const exactTargetDate = exactWindow ? safeIsoDate(leg?.departureDate) : null;
    const origin = legCode(leg.from);
    const destination = legCode(leg.to);
    const mode = transportModeText677AR1(leg);
    if (!origin || !destination) {
      if (automaticBuilder && (nextEarliestDate || initialAutomaticStartDate(query))) {
        const minDepartureDate = nextEarliestDate || initialAutomaticStartDate(query);
        const fallbackDate = exactTargetDate || automaticAlignedLegDate(leg, minDepartureDate, query, index);
        legs[index] = {
          ...leg,
          departureDate: fallbackDate,
          dateLabel: fallbackDate,
          dateSource: 'automatic-estimated-date-missing-provider-airport-code',
          automaticTourDate: {
            departureDate: fallbackDate,
            source: 'automatic-estimated-date-missing-provider-airport-code',
            providerBacked: false,
            minDepartureDate
          }
        };
        if (index < stops.length) nextEarliestDate = addDaysIso(fallbackDate, stopNightsForLeg(stops, index));
        estimatedDateFallbackCount += 1;
        scanned.push({ origin, destination, supported: false, reason: 'missing-provider-airport-code', bestObservation: null, applied: false, minDepartureDate, automaticTourDate: automaticBuilder, fallbackDate });
      }
      continue;
    }
    const isGroundLeg = pureGroundLeg677AR1(leg);
    const minDepartureDate = automaticBuilder ? (nextEarliestDate || initialAutomaticStartDate(query)) : null;

    // Keep regional ground routes honest unless explicitly enabled for flight comparison.
    if (isGroundLeg && String(process.env.ENABLE_650B_SCAN_GROUND_LEGS || '').trim().toLowerCase() !== 'true') {
      if (automaticBuilder && minDepartureDate) {
        legs[index] = {
          ...leg,
          departureDate: exactTargetDate || automaticAlignedLegDate(leg, minDepartureDate, query, index),
          dateLabel: exactTargetDate || automaticAlignedLegDate(leg, minDepartureDate, query, index),
          dateSource: 'automatic-ground-leg-after-previous-stay',
          automaticTourDate: {
            departureDate: exactTargetDate || automaticAlignedLegDate(leg, minDepartureDate, query, index),
            source: exactTargetDate ? 'user-requested-exact-date-669d' : 'automatic-ground-leg-after-previous-stay',
            providerBacked: false
          }
        };
        if (index < stops.length) nextEarliestDate = addDaysIso(legs[index].departureDate, stopNightsForLeg(stops, index));
        estimatedDateFallbackCount += 1;
      }
      scanned.push({ origin, destination, supported: false, reason: 'ground-leg-not-scanned', bestObservation: null, applied: false, minDepartureDate, automaticTourDate: automaticBuilder });
      continue;
    }

    const result = wholeTripDatePlan681BP2?.providerResults?.[index]?.observations
      ? wholeTripDatePlan681BP2.providerResults[index]
      : await fetchCheapDateEvidenceForLeg({
        origin,
        destination,
        currency,
        query,
        startMonth: automaticBuilder && minDepartureDate ? monthFromIsoDate(minDepartureDate) : undefined
      });
    if (result.supported) liveProviderCallsMade += 1;
    const flightSelectionContext = selectionContext677B(workingTour, query, minDepartureDate, index, leg);
    const p2Observation = wholeTripDatePlan681BP2?.applied ? wholeTripDatePlan681BP2?.selected?.legObservations?.[index] : null;
    const selectedBase = exactTargetDate
      ? exactObservationForDate669d(result, exactTargetDate)
      : (p2Observation
        ? p2Observation
        : (automaticBuilder
          ? (index === 0 ? selectObservationFromDate(result, minDepartureDate, query, flightSelectionContext, index) : selectObservationWithinDateWindow(result, minDepartureDate, query, flightSelectionContext, index))
          : (smartFlightDateSelection677BEnabled()
            ? selectBestUsableObservation(Array.isArray(result.observations) ? result.observations : [], flightSelectionContext)
            : (result.selectedObservation || result.bestObservation || (Array.isArray(result.observations) ? result.observations[0] : null)))));
    const selected = p2Observation && selectedBase
      ? {
          ...selectedBase,
          selectionReason: 'whole-trip-date-optimizer-681b-p2',
          smartFlightDateSelectionVersion: WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2,
          dateShiftDays: daysBetweenIso(minDepartureDate, selectedBase.departureDate)
        }
      : selectedBase;
    const cheapest = result.cheapestObservation || (Array.isArray(result.observations) ? result.observations[0] : null);
    const dateOptions = exactTargetDate
      ? providerDateOptionsForExactDate669d(result, exactTargetDate)
      : (automaticBuilder ? (index === 0 ? providerDateOptionsFromDate(result, minDepartureDate, query, index) : providerDateOptionsWithinDateWindow(result, minDepartureDate, query, index)) : providerDateOptions(result));
    const scannedEntry = {
      origin,
      destination,
      supported: result.supported,
      reason: result.reason || null,
      bestObservation: selected || null,
      cheapestObservation: cheapest || null,
      applied: false,
      scannedMonths: result.scannedMonths || null,
      scanWindowMonths: result.months || 1,
      minDepartureDate,
      maxDepartureDate: automaticBuilder && index > 0 ? maxAllowedDepartureDate(minDepartureDate, query, index) : null,
      legDateWindowDays: automaticBuilder && index > 0 ? automaticLegWindowDays(query, index) : null,
      automaticTourDate: automaticBuilder
    };
    scanned.push(scannedEntry);

    if (!selected) {
      if (automaticBuilder && minDepartureDate) {
        const fallbackDate = exactTargetDate || automaticAlignedLegDate(leg, minDepartureDate, query, index);
        legs[index] = {
          ...leg,
          departureDate: fallbackDate,
          dateLabel: fallbackDate,
          dateSource: exactTargetDate ? 'user-requested-exact-date-669d' : (result.reason ? `automatic-estimated-date-provider-${result.reason}` : 'automatic-estimated-date-no-provider-observation'),
          automaticTourDate: {
            departureDate: fallbackDate,
            source: exactTargetDate ? 'user-requested-exact-date-669d' : (result.reason ? `automatic-estimated-date-provider-${result.reason}` : 'automatic-estimated-date-no-provider-observation'),
            providerBacked: false,
            minDepartureDate
          }
        };
        if (index < stops.length) nextEarliestDate = addDaysIso(fallbackDate, stopNightsForLeg(stops, index));
        estimatedDateFallbackCount += 1;
        scannedEntry.applied = false;
        scannedEntry.fallbackDate = fallbackDate;
        scannedEntry.fallbackReason = result.reason || 'no-provider-observation-inside-trip-window';
      }
      continue;
    }

    supportedObservations += 1;
    const usd = Number(selected?.rankingPriceUsd) > 0
      ? Number(selected.rankingPriceUsd)
      : convertProviderPriceToUsd(selected.price, selected.currency || currency);
    const p2CandidateApplied = Boolean(wholeTripDatePlan681BP2?.applied && p2Observation);
    const applyDecision = p2CandidateApplied
      ? {
          providerPerPassengerUsd: usd,
          providerPartyUsd: providerFarePartyTotalUsd(usd, query),
          currentTotalUsd: totalEstimateUsdFromTour(workingTour, query),
          nextTotalUsd: wholeTripDatePlan681BP2.selected.mixedEvidenceTotalUsd,
          ceilingUsd: budgetCeilingUsd(workingTour, query),
          apply: true
        }
      : canApplyProviderPrice({ tour: workingTour, query, currentLeg: leg, providerUsd: usd, legs });
    const commonEvidence = {
      departureDate: selected.departureDate,
      origin: selected.resolvedOrigin || selected.origin || origin,
      destination: selected.resolvedDestination || selected.destination || destination,
      requestedOrigin: selected.requestedOrigin || origin,
      requestedDestination: selected.requestedDestination || destination,
      departureTime: selected.departureTime,
      arrivalTime: selected.arrivalTime,
      price: selected.price,
      currency: selected.currency || currency,
      providerAmount: selected.providerAmount || selected.totalPrice || selected.price,
      providerCurrency: selected.providerCurrency || selected.currency || currency,
      displayPrice: Number.isFinite(Number(selected.displayPrice)) ? Number(selected.displayPrice) : null,
      displayCurrency: selected.displayCurrency || currency,
      rankingPriceUsd683H: Number.isFinite(Number(selected.rankingPriceUsd)) ? Number(selected.rankingPriceUsd) : null,
      fxNormalization683G: selected.fxNormalization683G || null,
      airportMode683H: selected.airportMode683H || null,
      metroAirportFallback683H: selected.metroAirportFallback683H || null,
      airline: selected.airline,
      transfers: selected.transfers,
      durationMinutes: selected.durationMinutes,
      durationLabel: selected.durationLabel || null,
      timingQuality: selected.timingQuality,
      timingLabel: selected.timingLabel,
      source: selected.source,
      sourceType: selected.sourceType || selected.priceEvidence?.sourceType || 'CACHED',
      priceEvidence: selected.priceEvidence || null,
      evidenceId: selected.evidenceId || selected.priceEvidence?.evidenceId || null,
      providerEvidenceClass: selected.providerEvidenceClass || null,
      providerRankingGrade: selected.providerRankingGrade || null,
      productionEligible: selected.productionEligible !== false,
      requestedCurrency: selected.requestedCurrency || currency,
      canonicalLiveEvidence683JR1: selected.canonicalLiveEvidence683JR1 || null,
      canonicalLiveEvidence683JR2: selected.canonicalLiveEvidence683JR2 || null,
      rankingFx683H: selected.rankingFx683H || null,
      observedAt: selected.observedAt || null,
      retrievedAt: selected.providerFetchedAt || result.fetchedAt || null,
      providerFetchedAt: selected.providerFetchedAt || result.fetchedAt || null,
      endpointUsed: selected.providerEndpoint || result.endpointUsed || null,
      cacheHit: Boolean(result.cacheHit),
      scanWindowMonths: result.months || 1,
      scannedMonths: result.scannedMonths || null,
      minDepartureDate,
      bookingLink: selected.bookingLink || null,
      selectionReason: selected.selectionReason || (automaticBuilder ? 'automatic-tour-builder-cheap-one-way-date' : 'provider-cheap-date'),
      smartFlightSelectionVersion: selected.smartFlightSelectionVersion || null,
      smartFlightDateSelectionVersion: selected.smartFlightDateSelectionVersion || null,
      smartFlightScore: Number.isFinite(Number(selected.smartFlightScore)) ? Number(selected.smartFlightScore) : null,
      alternativesConsidered: Number(selected.alternativesConsidered || 0) || null,
      dateShiftDays: Number.isFinite(Number(selected.dateShiftDays)) ? Number(selected.dateShiftDays) : null,
      durationMinutesSavedVsCheapest: Number(selected.durationMinutesSavedVsCheapest || 0) || 0,
      connectionsSavedVsCheapest: Number(selected.connectionsSavedVsCheapest || 0) || 0,
      usefulTimeWarnings: Array.isArray(selected.usefulTimeWarnings) ? selected.usefulTimeWarnings : [],
      smartFlightTradeoff: selected.smartFlightTradeoff || null,
      flightQualityGuardrailVersion: selected.flightQualityGuardrailVersion || null,
      flightQualityStatus: selected.flightQualityStatus || null,
      flightQualityWarnings: Array.isArray(selected.flightQualityWarnings) ? selected.flightQualityWarnings : [],
      expectedJourneyMinutes: Number.isFinite(Number(selected.expectedJourneyMinutes)) ? Number(selected.expectedJourneyMinutes) : null,
      cautionDurationThresholdMinutes: Number.isFinite(Number(selected.cautionDurationThresholdMinutes)) ? Number(selected.cautionDurationThresholdMinutes) : null,
      severeDurationThresholdMinutes: Number.isFinite(Number(selected.severeDurationThresholdMinutes)) ? Number(selected.severeDurationThresholdMinutes) : null,
      durationRatioVsExpected: Number.isFinite(Number(selected.durationRatioVsExpected)) ? Number(selected.durationRatioVsExpected) : null,
      routeRelativeExpectedFlightMinutes: Number.isFinite(Number(selected.routeRelativeExpectedFlightMinutes)) ? Number(selected.routeRelativeExpectedFlightMinutes) : null,
      routeRelativeCautionThresholdMinutes: Number.isFinite(Number(selected.routeRelativeCautionThresholdMinutes)) ? Number(selected.routeRelativeCautionThresholdMinutes) : null,
      routeRelativeSevereThresholdMinutes: Number.isFinite(Number(selected.routeRelativeSevereThresholdMinutes)) ? Number(selected.routeRelativeSevereThresholdMinutes) : null,
      routeDistanceBand: selected.routeDistanceBand || null,
      pricePremiumVsCheapest: Number.isFinite(Number(selected.pricePremiumVsCheapest)) ? Number(selected.pricePremiumVsCheapest) : 0,
      cheapestPrice: selected.cheapestPrice || cheapest?.price || selected.price,
      choiceEvidence: {
        version: p2CandidateApplied ? WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2 : FLEXIBLE_DATE_ENGINE_VERSION_681B_P1,
        cheapestSuitable: cheapest ? { evidenceId: cheapest.evidenceId || cheapest.priceEvidence?.evidenceId || null, departureDate: cheapest.departureDate, amount: cheapest.price, currency: cheapest.currency || currency } : null,
        bestBalance: { evidenceId: selected.evidenceId || selected.priceEvidence?.evidenceId || null, departureDate: selected.departureDate, amount: selected.price, currency: selected.currency || currency },
        selectedRole: Number(selected.price) === Number(cheapest?.price) && selected.departureDate === cheapest?.departureDate ? 'cheapest-suitable' : 'best-balance',
        premiumAmount: Math.max(0, Number(selected.price || 0) - Number(cheapest?.price || selected.price || 0)),
        rationale: selected.selectionReason || null
      },
      dateOptions,
      providerBacked: true,
      appliedToEstimate: applyDecision.apply,
      perPassengerAmountUsd: applyDecision.providerPerPassengerUsd,
      partyTotalAmountUsd: applyDecision.providerPartyUsd,
      passengerPricingVersion: PRICING_INTEGRITY_VERSION,
      budgetGuardrail: applyDecision.apply ? null : {
        reason: 'provider-price-would-exceed-budget',
        currentTotalUsd: applyDecision.currentTotalUsd,
        nextTotalUsd: applyDecision.nextTotalUsd,
        ceilingUsd: applyDecision.ceilingUsd
      }
    };

    if (!applyDecision.apply) {
      skippedOverBudgetCount += 1;
      const fallbackDate = exactTargetDate || (automaticBuilder ? automaticAlignedLegDate(leg, minDepartureDate, query, index) : (safeIsoDate(leg.departureDate) || null));
      legs[index] = {
        ...leg,
        departureDate: fallbackDate || leg.departureDate,
        dateLabel: fallbackDate || leg.dateLabel || leg.departureDate,
        providerVerificationRequired: true,
        airline: null,
        operator: String(leg?.mode || leg?.transportType || '').toLowerCase().includes('flight') ? 'Estimated flight option' : (leg.operator || 'Rail or bus options'),
        providerDateEvidence: commonEvidence,
        cheapestOneWay: commonEvidence,
        automaticTourDate: automaticBuilder ? {
          departureDate: fallbackDate,
          source: 'automatic-estimated-date-provider-price-held-back-by-budget',
          providerBacked: false,
          providerObservedDate: selected.departureDate,
          minDepartureDate
        } : undefined,
        estimateSource: `${leg.estimateSource || 'planning-estimate'}+provider-date-observed-not-applied`
      };
      if (automaticBuilder && index < stops.length) nextEarliestDate = addDaysIso(fallbackDate, stopNightsForLeg(stops, index));
      estimatedDateFallbackCount += automaticBuilder ? 1 : 0;
      scannedEntry.applied = false;
      scannedEntry.skipReason = 'provider-price-would-exceed-budget';
      scannedEntry.fallbackDate = fallbackDate;
      continue;
    }

    appliedObservationCount += 1;
    selectedProviderDateCount += 1;
    scannedEntry.applied = true;
    const resolvedLegFor683H = applyResolvedAirports683H(leg, selected);
    legs[index] = priceTransportLeg({
      ...resolvedLegFor683H,
      mode: 'flight',
      transportType: 'flight',
      departureDate: selected.departureDate,
      dateLabel: selected.departureDate,
      dateSource: p2CandidateApplied ? 'whole-trip-date-optimizer-681b-p2' : (selected.smartFlightDateSelectionVersion ? 'automatic-smart-flight-date-selection-677b' : 'automatic-provider-cheap-one-way-date'),
      estimateSource: (result.months && result.months > 1) ? 'travelpayouts-provider-six-month-cheapest-date-scan-657b-automatic-tour-builder' : 'travelpayouts-provider-cheapest-date-scan-650b',
      liveFareVerified: false,
      providerFareObserved: true,
      providerVerificationRequired: true,
      airline: selected.airline || null,
      providerDateEvidence: commonEvidence,
      cheapestOneWay: commonEvidence,
      automaticTourDate: {
        departureDate: selected.departureDate,
        source: p2CandidateApplied ? 'whole-trip-date-optimizer-681b-p2' : (selected.smartFlightDateSelectionVersion ? 'automatic-smart-flight-date-selection-677b' : 'automatic-provider-cheap-one-way-date'),
        providerBacked: true,
        minDepartureDate
      }
    }, query, { unitAmountUsd: usd });
    if (automaticBuilder && index < stops.length) nextEarliestDate = addDaysIso(selected.departureDate, stopNightsForLeg(stops, index));
    workingTour = recomputeTourTotals({ ...workingTour, legs, stops: synchronizeStopsWithLegDates(stops, legs) }, query);
  }

  const synchronizedStops = automaticBuilder ? synchronizeStopsWithLegDates(stops, legs) : stops;
  const patched = recomputeTourTotals({ ...tour, legs, stops: synchronizedStops }, query);
  return {
    tour: patched,
    summary: {
      enabled: true,
      version: automaticBuilder ? 'GV-RANK-659A' : ((scanner650BEnabled() || String(process.env.ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A || '').trim().toLowerCase() === 'true') ? 'GV-FLIGHT-657A' : 'GV-FLIGHT-650B'),
      month,
      automaticTourBuilder: automaticBuilder,
      chronologicalDatePlan: automaticBuilder,
      exactDateWindowPreserved: Boolean(exactWindow),
      requestedExactDepartureDate: exactWindow?.departureDate || null,
      requestedExactReturnDate: exactWindow?.returnDate || null,
      selectedProviderDateCount,
      estimatedDateFallbackCount,
      scannedLegCount: scanned.length,
      supportedObservationCount: supportedObservations,
      appliedObservationCount,
      skippedOverBudgetCount,
      liveProviderCallsMade,
      source: automaticBuilder ? 'automatic-generated-tour-cheap-one-way-date-builder-with-route-ambition-659a' : ((scanner650BEnabled() || String(process.env.ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A || '').trim().toLowerCase() === 'true') ? 'travelpayouts-aviasales-provider-six-month-cheapest-date' : 'travelpayouts-aviasales-provider-cheapest-date'),
      wholeTripDateOptimization: wholeTripDatePlan681BP2?.summary || { enabled: wholeTripDateOptimizer681BP2Enabled(), version: WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2, applied: false, reason: exactWindow ? 'exact-date-request-preserved' : 'not-run' },
      selectionPolicy: wholeTripDatePlan681BP2?.applied ? 'compare complete route schedules across the flexible first-departure window; require an exact-date provider observation for every flight leg; include current hotel, ground and access planning estimates in the whole-trip total; choose the lowest budget-fit complete schedule; never let an incomplete schedule win cheapest' : (smartFlightDateSelection677BEnabled() ? ((smartRouteRelativeFlightQuality677BR3Enabled() || smartFlightQualityGuardrails677BR2Enabled()) ? 'scan provider-backed one-way options in sequence; preserve R1 date integrity; rank modest-premium options by total-trip budget pressure, fare, duration, connections and useful time; apply route-relative flight-duration thresholds; exclude clearly inefficient short/medium-haul observations from confident smart-choice ranking and label limited provider evidence honestly' : 'scan provider-backed one-way options in sequence; allow up to a three-day route-cadence shift; rank modest-premium options by total-trip budget pressure, fare, duration, connections and useful departure/arrival time; preserve exact user dates and never apply a fare that breaks the full-trip budget') : (smartDurationFlightSelection677AEnabled() ? 'scan provider-backed one-way options in sequence; keep the itinerary cadence; rank reasonably priced options by fare, duration, connection count and timing; never apply a fare that breaks the user budget' : (automaticBuilder ? 'automatically build the final tour by scanning one-way legs in sequence; first useful departure may come from the six-month scan, later legs must match the planned city-night cadence, and medium/high budgets may prefer more memorable international value routes when feasible; hide raw flight search from the user; preserve budget guardrail' : ((scanner650BEnabled() || String(process.env.ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A || '').trim().toLowerCase() === 'true') ? 'scan the next six months for each one-way leg; choose cheapest usable date; prefer better timing within 18 percent of cheapest; do not apply provider fare if it breaks budget guardrail' : 'choose cheapest usable date; prefer better timing within 18 percent of cheapest; do not apply provider fare if it breaks budget guardrail')))),
      rawFlightSearchHiddenFromUser: true,
      flightProviderContract: adapterSummary683C(),
      scannedLegs: scanned
    }
  };
}


async function globalFallbackResponse(routeQuery, reason, details = {}) {
  const durationDecision674A = routeQuery.durationDecision674A || resolveAdaptiveDuration674A(routeQuery);
  const fallback = findBestGlobalTour(routeQuery);
  if (!fallback || !fallback.tour) return null;
  fallback.tour = priceTourForParty(fallback.tour, routeQuery);
  fallback.tours = [fallback.tour];
  const fallbackGuard = evaluateTour(fallback.tour, routeQuery);
  if (!fallbackGuard.accepted) return null;
  fallback.tour = fallbackGuard.tour;
  fallback.tours = [fallbackGuard.tour];
  const fallbackEntryEligibility = recommendationEligibility(fallbackGuard.tour, routeQuery);
  if (fallbackEntryEligibility.hardBlocked) {
    return {
      ok: true,
      supported: false,
      reason: 'no-entry-eligible-route',
      message: 'The fallback route conflicts with a current authoritative entry restriction for the saved passport profile. Choose another route or update the travel profile.',
      tour: null,
      tours: [],
      entryEligibility: fallbackEntryEligibility,
      diagnostics: { generatedTourSelected: false, entryEligibilityVersion: ENTRY_ELIGIBILITY_VERSION, entryRestrictedFallback: true }
    };
  }
  let enrichment = await enrichTourWithCheapFlights(fallbackGuard.tour, routeQuery);
  if (isOverUserBudget(enrichment.tour, routeQuery)) {
    enrichment = {
      tour: fallback.tour,
      summary: {
        enabled: scannerEnabled(),
        version: 'GV-TOUR-653A-R1',
        scannedLegCount: enrichment.summary?.scannedLegCount || 0,
        liveProviderCallsMade: enrichment.summary?.liveProviderCallsMade || 0,
        skippedOverBudgetCount: (enrichment.summary?.skippedOverBudgetCount || 0) + 1,
        source: 'budget-safe-global-fallback-with-provider-prices-held-back',
        rawFlightSearchHiddenFromUser: true,
        budgetGuardrail: 'provider prices were not applied because the combined route would exceed the user budget'
      }
    };
  }
  const publicLiveFare684A = await applyPublicLiveFarePilot684A(enrichment.tour, routeQuery);
  const liveVerification = await verifyTourWithLiveProviders(publicLiveFare684A.tour, routeQuery);
  enrichment = {
    ...enrichment,
    tour: liveVerification.tour,
    liveProviderVerification: liveVerification.summary,
    publicLiveFarePilot684A: publicLiveFare684A.summary
  };
  if (liveVerification.summary?.overBudget || publicLiveFare684A.summary?.overBudget) return null;
  const exactPreservedTour = exactDateWindow669d(routeQuery)
    ? recomputeTourTotals(applyExactDateWindow669d(enrichment.tour, routeQuery), routeQuery)
    : enrichment.tour;
  const visualizerTour = buildVisualizerTour(guardEnabled() ? normalizeAirportIntegrity(exactPreservedTour, routeQuery) : exactPreservedTour, routeQuery, enrichment);
  const finalGuard = evaluateTour(visualizerTour, routeQuery);
  if (!finalGuard.accepted) {
    return {
      ok: true,
      supported: false,
      reason: 'no-route-passed-feasibility-guard',
      message: 'No route passed the trip-length, geographic, and airport checks. Try fewer stops or a longer trip.',
      tour: null,
      tours: [],
      noFeasibleTour: { reason: 'no-route-passed-feasibility-guard' },
      diagnostics: {
        generatedTourSelected: false,
        routeFeasibilityGuard: {
          enabled: true,
          version: GUARD_VERSION,
          accepted: false,
          reasons: finalGuard.reasons,
          metrics: finalGuard.metrics,
          warnings: finalGuard.warnings
        }
      }
    };
  }
  const guardedVisualizerTour = decoratePickTour670a(finalGuard.tour, routeQuery);
  guardedVisualizerTour.adaptiveDurationDecision = durationDecision674A;
  guardedVisualizerTour.entryEligibility = recommendationEligibility(guardedVisualizerTour, routeQuery);
  if (!allTourStopsProductionActive(guardedVisualizerTour)) {
    return {
      ok: true,
      supported: false,
      reason: 'inactive-destination-blocked',
      message: 'The generated route included a destination that is not on the verified production-active allowlist. Please regenerate the tour.',
      tour: null,
      tours: [],
      diagnostics: {
        generatedTourSelected: false,
        verifiedActivationEnabled: verifiedActivationEnabled(),
        repairVersion: 'GV-PROD-669B'
      }
    };
  }
  if (guardedVisualizerTour?.itineraryDatePlan?.consistent === false) {
    return {
      ok: true,
      supported: false,
      reason: 'stale-or-mixed-itinerary-dates',
      message: 'The route dates could not be synchronized safely. Please regenerate the tour.',
      tour: null,
      tours: [],
      diagnostics: {
        generatedTourSelected: false,
        itineraryDatePlan: guardedVisualizerTour.itineraryDatePlan
      }
    };
  }
  const strictFinalBudgetFit684BR3 = strictBudgetFit684BR3(guardedVisualizerTour, routeQuery);
  const strictPilotGuardRequired684BR3 = Boolean(
    enrichment?.publicLiveFarePilot684A?.applied === true
  );
  if ((strictPilotGuardRequired684BR3 && strictFinalBudgetFit684BR3.overBudget === true) || isOverUserBudget(guardedVisualizerTour, routeQuery)) {
    return {
      ok: true,
      supported: false,
      reason: 'no-generated-tour-within-budget',
      message: 'No strong route found within this budget. Try increasing the budget, reducing stops, or choosing a shorter trip.',
      tour: null,
      tours: [],
      noFeasibleTour: { reason: 'no-generated-tour-within-budget' },
      diagnostics: {
        generatedTourSelected: false,
        globalFallbackUsed: true,
        globalFallbackReason: 'final-budget-guardrail',
        budgetGuardrail: 'generated-route-exceeded-user-budget',
        overBudgetEstimateUsd: totalEstimateUsdFromTour(guardedVisualizerTour, routeQuery),
        budgetCeilingUsd: budgetCeilingUsd(visualizerTour, routeQuery),
        strictCurrencyBudgetFit684BR3: strictFinalBudgetFit684BR3
      }
    };
  }
  return {
    ...fallback,
    version: GENERATED_TOUR_VERSION,
    mode: 'generated-tour-visualizer',
    pricingPolicy: {
      aiRouteCurator: null,
      source: scannerEnabled()
        ? (automaticCheapDateTourBuilderEnabled() ? 'automatic-cheap-one-way-tour-builder-with-global-estimated-fallback-657b' : (scanner650BEnabled() ? 'provider-backed-when-available-with-global-estimated-fallback' : 'cheap-one-way-scanner-with-global-estimated-fallback'))
        : 'global-estimated-route-fallback-scanner-disabled',
      userVisibleRawFlightSearch: false,
      providerVerificationRequiredBeforeBooking: true,
      publicLiveFarePilot684A: {
        version: VERSION_684A,
        status: status684A(),
        policy: 'final selected schedule only; exact airport/date Duffel LIVE evidence; single-adult pilot; all flight legs must resolve live or none are applied; affiliate purchase handoff remains unchanged'
      },
      affordableFlightDiscovery684B: {
        version: VERSION_684B,
        status: status684B(),
        policy: 'when a non-lowest-cost lane would otherwise have no flight route or only a ground route, inspect at most two plausible flight candidates; select one only after complete exact-date 684A LIVE evidence proves it remains within the user budget'
      }
    },
    tour: guardedVisualizerTour,
    tours: [guardedVisualizerTour],
    entryEligibility: guardedVisualizerTour.entryEligibility,
    globalGeneratedTourFallback: {
      enabled: true,
      version: GLOBAL_FALLBACK_VERSION,
      reason,
      details
    },
    diagnostics: {
      ...(fallback.diagnostics || {}),
      generatedTourSelected: true,
      entryEligibilityVersion: ENTRY_ELIGIBILITY_VERSION,
      globalFallbackUsed: true,
      globalFallbackReason: reason,
      adaptiveDuration: durationDecision674A,
      liveProviderCallsMade: enrichment.summary.liveProviderCallsMade || 0,
      liveProviderVerification: enrichment.liveProviderVerification || null,
      publicLiveFarePilot684A: enrichment.publicLiveFarePilot684A || { ...status684A(), attempted: false, applied: false, reason: 'not-run' },
      affordableFlightDiscovery684B: enrichment.affordableFlightDiscovery684B || { ...status684B(), attempted: false, applied: false, reason: 'not-run' },
      scannedLegCount: enrichment.summary.scannedLegCount || 0,
      routeFeasibilityGuard: {
        enabled: guardEnabled(),
        version: GUARD_VERSION,
        accepted: true,
        metrics: fallbackGuard.metrics,
        warnings: fallbackGuard.warnings
      }
    }
  };
}


function routeProviderEvidenceScore(enrichment, query = {}) {
  const tour = enrichment?.tour;
  const summary = enrichment?.summary || {};
  const applied = Number(summary.appliedObservationCount || 0);
  const supported = Number(summary.supportedObservationCount || 0);
  const total = totalEstimateUsdFromTour(tour, query);
  const ceiling = budgetCeilingUsd(tour, query);
  const budgetRoom = Math.max(0, ceiling - total);
  return applied * 100000 + supported * 10000 - total + Math.min(500, budgetRoom) + flightPreferenceAdjustment680BR1(tour, query);
}

function routeRankingEnabled() {
  return String(process.env.ENABLE_PROVIDER_CHEAP_DATE_ROUTE_RANKING_657A || '').trim().toLowerCase() === 'true';
}

async function selectTourWithOptionalProviderRanking(tours = [], query = {}) {
  const budgetSafe = (Array.isArray(tours) ? tours : []).filter(tour => !isOverUserBudget(tour, query));
  if (!budgetSafe.length) return null;
  const guarded = guardCandidateTours(budgetSafe, query);
  const requestedDiversityRole687B = requestedPickRole670a(query);
  let diversitySelection687B = null;
  let feasibleTours;
  if (aiRouteDiversity687BEnabled(query) && requestedDiversityRole687B) {
    diversitySelection687B = await selectDiverseRoleCandidate687B(guarded.tours, query);
    feasibleTours = diversitySelection687B?.tour ? [diversitySelection687B.tour] : [];
  } else {
    feasibleTours = roleScopedCandidatePool670a(guarded.tours, query);
  }
  const diversityDiagnostics687B = diversitySelection687B?.diagnostics || {
    enabled: aiRouteDiversity687BEnabled(query),
    version: AI_ROUTE_DIVERSITY_VERSION_687B,
    requestedRole: requestedDiversityRole687B || null,
    selectedBy: aiRouteDiversity687BEnabled(query) ? 'no-role-selection' : 'feature-disabled'
  };
  if (!feasibleTours.length) {
    return {
      tour: null,
      enrichment: null,
      routeRanking: { enabled: false, aiRouteDiversity687B: diversityDiagnostics687B, routeFeasibilityGuard: guarded.diagnostics }
    };
  }

  // GV-REC-677C: optimize the complete stop sequence before provider/date enrichment.
  // Saved/manual route orders and gateway-dependent routes are preserved. The
  // existing role assignment remains authoritative; 677C only improves feasible
  // candidates inside that already-safe pool.
  const orderOptimizationRows = feasibleTours.map((tour) => optimizeTourOrder677C(tour, query));
  const orderOptimizedTours = orderOptimizationRows.map(row => row.tour);
  const destinationValueRows = orderOptimizedTours.map((tour) => {
    const evaluation = destinationValueCandidateAdjustment677D(tour, query);
    return { tour: annotateDestinationValue677D(tour, query), evaluation };
  });
  const destinationOptimizedTours = destinationValueRows.map(row => row.tour);
  const destinationValueSummary = {
    enabled: destinationValueProximity677DEnabled(),
    version: DESTINATION_VALUE_PROXIMITY_VERSION_677D,
    candidateSetOptimization: destinationValueProximity677DEnabled(),
    candidateCount: destinationValueRows.length,
    weakCandidateCount: destinationValueRows.filter(row => row.evaluation?.qualityBand === 'weak-destination-value' || row.evaluation?.qualityBand === 'low-destination-value').length,
    candidates: destinationValueRows.slice(0, 8).map(row => ({
      route: (row.tour?.stops || []).map(stop => stop.city || stop.displayCity || stop.cityId),
      adjustment: row.evaluation?.adjustment || 0,
      qualityBand: row.evaluation?.qualityBand || null,
      reasons: row.evaluation?.reasons || [],
      originAdjacentStops: row.evaluation?.metrics?.originAdjacentStops || 0,
      dayTripRangeStops: row.evaluation?.metrics?.dayTripRangeStops || 0,
      closePairCount: row.evaluation?.metrics?.closePairCount || 0
    }))
  };
  const wholeTripOptimizationSummary = {
    enabled: wholeTripRouteOptimization677CEnabled(),
    version: WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C,
    candidateSetOptimization: wholeTripRouteOptimization677CEnabled(),
    routeOrderOptimization: wholeTripRouteOptimization677CEnabled(),
    candidateCount: orderOptimizationRows.length,
    reorderedCandidateCount: orderOptimizationRows.filter(row => row.diagnostics?.changed).length,
    candidates: orderOptimizationRows.slice(0, 8).map(row => row.diagnostics)
  };

  // GV-AI-662A: route curator runs only on already budget-safe and route-feasible backend candidates.
  // An optional LLM endpoint can reorder candidates by wow/story value, but it cannot
  // invent cities, prices, dates, airports, or hotels. If no endpoint is configured,
  // the deterministic wow-curator safely improves ordering and keeps the old fallback.
  const curated = await curateCandidateTours(destinationOptimizedTours, query);
  const curatedTours = curated.tours && curated.tours.length ? curated.tours : destinationOptimizedTours;

  if (!scannerEnabled() || !routeRankingEnabled()) {
    return {
      tour: selectBudgetSafeTour(curatedTours, query),
      enrichment: null,
      routeRanking: { enabled: false, aiRouteDiversity687B: diversityDiagnostics687B, aiRouteCurator: curated.diagnostics || { enabled: false }, routeFeasibilityGuard: guarded.diagnostics, wholeTripRouteOptimization: wholeTripOptimizationSummary, destinationValueProximity: destinationValueSummary }
    };
  }
  const candidateLimit = Math.max(1, Math.min(Number(query.routeRankingCandidateLimit || 2) || 2, 3));
  const candidates = curatedTours.slice().sort((a, b) => {
    const aWhole = wholeTripRouteOptimization677CEnabled() ? wholeTripCandidateAdjustment677C(a, query).adjustment : 0;
    const bWhole = wholeTripRouteOptimization677CEnabled() ? wholeTripCandidateAdjustment677C(b, query).adjustment : 0;
    const aDestinationValue = destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(a, query).adjustment : 0;
    const bDestinationValue = destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(b, query).adjustment : 0;
    return (automaticTourCandidateScore(b, query) + bWhole + bDestinationValue) - (automaticTourCandidateScore(a, query) + aWhole + aDestinationValue);
  }).slice(0, candidateLimit);
  const enriched = [];
  for (const candidate of candidates) {
    const enrichment = await enrichTourWithCheapFlights(candidate, query);
    if (!isOverUserBudget(enrichment.tour, query)) {
      const wholeTripAdjustment = wholeTripRouteOptimization677CEnabled() ? wholeTripCandidateAdjustment677C(enrichment.tour, query).adjustment : 0;
      const destinationValueAdjustment = destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(enrichment.tour, query).adjustment : 0;
      enriched.push({ candidate, enrichment, wholeTripAdjustment, destinationValueAdjustment, score: routeProviderEvidenceScore(enrichment, query) + wholeTripAdjustment * 100 + destinationValueAdjustment * 100 });
    }
  }
  if (!enriched.length) {
    return {
      tour: selectBudgetSafeTour(curatedTours, query),
      enrichment: null,
      routeRanking: { enabled: true, evaluatedCandidates: candidates.length, selectedWithProviderEvidence: false, aiRouteDiversity687B: diversityDiagnostics687B, aiRouteCurator: curated.diagnostics || { enabled: false }, routeFeasibilityGuard: guarded.diagnostics, wholeTripRouteOptimization: wholeTripOptimizationSummary, destinationValueProximity: destinationValueSummary }
    };
  }
  enriched.sort((a, b) => b.score - a.score || totalEstimateUsdFromTour(a.enrichment.tour, query) - totalEstimateUsdFromTour(b.enrichment.tour, query));
  return {
    tour: enriched[0].candidate,
    enrichment: enriched[0].enrichment,
    routeRanking: {
      enabled: true,
      evaluatedCandidates: candidates.length,
      selectedWithProviderEvidence: true,
      selectedScore: Math.round(enriched[0].score),
      selectedWholeTripAdjustment: Number(enriched[0].wholeTripAdjustment || 0),
      selectedDestinationValueAdjustment: Number(enriched[0].destinationValueAdjustment || 0),
      aiRouteDiversity687B: diversityDiagnostics687B,
      aiRouteCurator: curated.diagnostics || { enabled: false },
      routeFeasibilityGuard: guarded.diagnostics,
      wholeTripRouteOptimization: wholeTripOptimizationSummary,
      destinationValueProximity: destinationValueSummary
    }
  };
}

async function attemptBudgetSafeRouteRecovery669c(routeQuery = {}, liveVerification = {}) {
  if (!budgetSafeRouteRecovery669cEnabled()) return null;
  const currentStopCap = Math.max(1, maxStopsForTrip(routeQuery, liveVerification?.tour || {}));
  const attempt = budgetRecoveryAttempt669c(routeQuery);
  if (currentStopCap <= 1 || attempt >= 3) return null;

  const nextStopCap = currentStopCap - 1;
  const recovered = await getGeneratedTour({
    ...routeQuery,
    maxStops: String(nextStopCap),
    __budgetRecoveryAttempt669c: String(attempt + 1),
    __budgetRecoveryOriginalStopCap669c: String(routeQuery.__budgetRecoveryOriginalStopCap669c || currentStopCap)
  });

  if (!recovered || recovered.supported !== true || !recovered.tour) return null;
  return {
    ...recovered,
    diagnostics: {
      ...(recovered.diagnostics || {}),
      budgetSafeRouteRecovery: {
        enabled: true,
        version: 'GV-PROD-669C',
        reason: 'provider-verified-route-over-budget',
        originalStopCap: Number(routeQuery.__budgetRecoveryOriginalStopCap669c || currentStopCap),
        recoveredStopCap: nextStopCap,
        attempts: attempt + 1,
        thresholdsRelaxed: false,
        originalProviderVerification: liveVerification?.summary || null
      }
    }
  };
}

async function getGeneratedTour(query = {}) {
  // GV-PERF-R3: request-local response diagnostics only. Stage durations are
  // monotonic wall time; selection may already include provider/date enrichment.
  const startedR3 = process.hrtime.bigint();
  const elapsedR3 = start => Number(process.hrtime.bigint() - start) / 1e6;
  const performanceR3 = {
    version: 'GV-PERF-R3',
    globalRouteGraphMs: 0,
    legacyRouteEngineMs: 0,
    candidatePreparationMs: 0,
    routeSelectionMs: 0,
    initial684BMs: 0,
    cheapFlightEnrichmentMs: 0,
    cheapFlightEnrichmentReused: false,
    publicLiveFare684AMs: 0,
    liveProviderVerificationMs: 0,
    finalizationMs: 0,
    totalMs: 0
  };
  // GV-PERF-R4 narrows the two broad R3 hotspots without changing behavior.
  const performanceR4 = {
    version: 'GV-PERF-R4',
    firstProviderScanMs: 0,
    secondProviderScansMs: 0,
    secondProviderScanCount: 0,
    providerCandidateBuildMs: 0,
    deterministicFallbackMs: 0,
    postLive684BRescueMs: 0,
    rescueProviderRequests: 0,
    budgetRecoveryMs: 0,
    visualizerMs: 0,
    finalGuardMs: 0,
    responseAssemblyMs: 0
  };
  let candidatePreparationStartedR3 = null;
  let finalizationStartedR3 = null;
  // Keep early returns and exceptions inside the existing orchestration. The
  // outer response decoration also measures fallback/recursive wall time in totalMs.
  const resultR3 = await (async () => {
  if (!generatedTourEnabled()) {
    return { ok: true, supported: false, reason: 'feature-disabled', requiredFlag: 'ENABLE_GENERATED_TOUR_651A=true' };
  }
  query = prepareFlexibleLeadTimeQuery680BR1(query);
  let durationDecision674A = resolveAdaptiveDuration674A(query);
  const pace680BR1 = normalizeTravelPace680BR1(query);
  if (durationDecision674A.mode === 'adaptive' && pace680BR1 === 'relaxed') {
    durationDecision674A = { ...durationDecision674A, nights: Math.min(21, durationDecision674A.nights + 2), preferenceAdjustment: 'relaxed-pace-added-two-nights' };
  }
  const durationQuery = {
    ...query,
    totalNights: String(durationDecision674A.nights),
    nights: String(durationDecision674A.nights),
    adaptiveDuration: durationDecision674A.mode === 'adaptive' ? 'true' : 'false'
  };
  const stopCap = maxStopsForTrip(durationQuery);
  const requestedMaxStops = Number(query.maxStops ?? query.stops);
  let preferenceStopCap = stopCap;
  if (pace680BR1 === 'relaxed') preferenceStopCap = Math.max(2, stopCap - 1);
  if (pace680BR1 === 'see-more') preferenceStopCap = stopCap;
  const inferredTheme680BR1 = preferenceTheme680BR1(query);
  const routeQuery = {
    ...durationQuery,
    ...(inferredTheme680BR1 && !query.theme ? { theme: inferredTheme680BR1 } : {}),
    ...(guardEnabled() ? {
      maxStops: Number.isFinite(requestedMaxStops) && requestedMaxStops > 0
        ? String(Math.min(preferenceStopCap, Math.round(requestedMaxStops)))
        : String(preferenceStopCap)
    } : {}),
    durationDecision674A,
    recommendationScope: query.recommendationScope || 'generated-tour',
    mode: 'generated-tour'
  };
  const party = normalizeParty(routeQuery);
  routeQuery.adults = String(party.adults);
  routeQuery.children = String(party.children);
  routeQuery.infants = String(party.infants);
  routeQuery.passengers = String(party.travellers);
  routeQuery.rooms = String(party.rooms);

  // GV-GLOBAL-665B generates provider-informed candidate routes on demand from the unified global
  // city/airport graph for every origin. The legacy curated route engine remains
  // available and both candidate sets are validated before AI ranking.
  const graphEnabledR3 = globalRouteGraphEnabled();
  const graphStartedR3 = process.hrtime.bigint();
  const graph = graphEnabledR3
    ? await generateProviderDrivenGlobalRouteCandidates(routeQuery)
    : { tours: [], diagnostics: { enabled: false, version: GLOBAL_ROUTE_GRAPH_VERSION } };

  performanceR3.globalRouteGraphMs = graphEnabledR3 ? elapsedR3(graphStartedR3) : 0;
  const graphPerformanceR4 = graph?.diagnostics?.performanceR4 || {};
  performanceR4.firstProviderScanMs = Number(graphPerformanceR4.firstProviderScanMs || 0);
  performanceR4.secondProviderScansMs = Number(graphPerformanceR4.secondProviderScansMs || 0);
  performanceR4.secondProviderScanCount = Number(graphPerformanceR4.secondProviderScanCount || 0);
  performanceR4.providerCandidateBuildMs = Number(graphPerformanceR4.providerCandidateBuildMs || 0);
  performanceR4.deterministicFallbackMs = Number(graphPerformanceR4.deterministicFallbackMs || 0);

  let base;
  const legacyStartedR3 = process.hrtime.bigint();
  try {
    base = await getMultiCityTours(routeQuery);
    performanceR3.legacyRouteEngineMs = elapsedR3(legacyStartedR3);
  } catch (error) {
    performanceR3.legacyRouteEngineMs = elapsedR3(legacyStartedR3);
    if (Array.isArray(graph.tours) && graph.tours.length) {
      base = {
        ok: true,
        supported: true,
        requested: { origin: graph.origin || null },
        tours: [],
        diagnostics: {
          legacyRouteEngineError: { code: error.code || error.name || 'ROUTE_ENGINE_ERROR', message: error.message || 'Base route engine could not build this origin.' }
        }
      };
    } else {
      const fallback = await globalFallbackResponse(routeQuery, 'base-route-engine-error', {
        code: error.code || error.name || 'ROUTE_ENGINE_ERROR',
        message: error.message || 'Base route engine could not build this origin.'
      });
      if (fallback) return fallback;
      throw error;
    }
  }

  candidatePreparationStartedR3 = process.hrtime.bigint();
  const legacyTours = Array.isArray(base.tours) ? base.tours : [];
  const graphTours = Array.isArray(graph.tours) ? graph.tours : [];
  const combined = [];
  const entryBlockedCandidates = [];
  const seenRoutes = new Set();
  for (const candidate of [...graphTours, ...legacyTours]) {
    if (!candidate) continue;
    if (!allTourStopsProductionActive(candidate)) continue;
    const stops = Array.isArray(candidate.stops) ? candidate.stops : [];
    const key = stops.map(stop => String(stop.airportCode || stop.code || stop.cityId || stop.city || '').toUpperCase()).join('>');
    if (key && seenRoutes.has(key)) continue;
    if (key) seenRoutes.add(key);
    const candidateEntryEligibility = recommendationEligibility(candidate, routeQuery);
    if (candidateEntryEligibility.hardBlocked) {
      entryBlockedCandidates.push({ routeKey: key, summary: candidateEntryEligibility.summary, checks: candidateEntryEligibility.checks.filter(check => check.hardBlock) });
      continue;
    }
    combined.push(priceTourForParty({ ...candidate, entryEligibility: candidateEntryEligibility }, routeQuery));
  }

  if (!combined.length && entryBlockedCandidates.length) {
    return {
      ok: true,
      supported: false,
      reason: 'no-entry-eligible-route',
      message: 'Available routes conflict with a current authoritative entry restriction for the saved passport profile. Try another region, update the profile, or choose a different passport where legally applicable.',
      tour: null,
      tours: [],
      entryEligibility: { version: ENTRY_ELIGIBILITY_VERSION, overallStatus: 'blocked', hardBlocked: true, blockedCandidates: entryBlockedCandidates.slice(0, 8) },
      diagnostics: { generatedTourSelected: false, entryEligibilityVersion: ENTRY_ELIGIBILITY_VERSION, entryBlockedCandidateCount: entryBlockedCandidates.length }
    };
  }

  let smartDurationDecision677A = durationDecision674A?.version === SMART_DURATION_VERSION_677A ? durationDecision674A : null;
  if (smartDurationFlightSelection677AEnabled() && durationDecision674A.mode === 'adaptive' && combined.length && !query.__smartDurationDecision677A) {
    const previewSafe = combined.filter(tour => !isOverUserBudget(tour, routeQuery));
    const previewGuard = guardCandidateTours(previewSafe, routeQuery);
    const previewPool = roleScopedCandidatePool670a(previewGuard.tours, routeQuery);
    const previewTour = selectBudgetSafeTour(previewPool, routeQuery);
    if (previewTour) {
      smartDurationDecision677A = resolveSmartDuration677A(previewTour, routeQuery, durationDecision674A);
      if (smartDurationDecision677A.nights !== durationDecision674A.nights) {
        performanceR3.candidatePreparationMs = elapsedR3(candidatePreparationStartedR3);
        candidatePreparationStartedR3 = null;
        const refinedResponseR3 = await getGeneratedTour({
          ...query,
          __smartDurationDecision677A: smartDurationDecision677A,
          __smartDurationRefinementPass677A: '1'
        });
        const refinedTimingR3 = refinedResponseR3.diagnostics?.performanceR3;
        if (refinedTimingR3) {
          // The refinement runs before selection. Preserve the selected pass's
          // timings and include both sequential route-generation/preparation passes.
          Object.assign(performanceR3, refinedTimingR3, {
            globalRouteGraphMs: performanceR3.globalRouteGraphMs + refinedTimingR3.globalRouteGraphMs,
            legacyRouteEngineMs: performanceR3.legacyRouteEngineMs + refinedTimingR3.legacyRouteEngineMs,
            candidatePreparationMs: performanceR3.candidatePreparationMs + refinedTimingR3.candidatePreparationMs
          });
        }
        const refinedTimingR4 = refinedResponseR3.diagnostics?.performanceR4;
        if (refinedTimingR4) {
          Object.assign(performanceR4, refinedTimingR4, {
            firstProviderScanMs: performanceR4.firstProviderScanMs + refinedTimingR4.firstProviderScanMs,
            secondProviderScansMs: performanceR4.secondProviderScansMs + refinedTimingR4.secondProviderScansMs,
            secondProviderScanCount: performanceR4.secondProviderScanCount + refinedTimingR4.secondProviderScanCount,
            providerCandidateBuildMs: performanceR4.providerCandidateBuildMs + refinedTimingR4.providerCandidateBuildMs,
            deterministicFallbackMs: performanceR4.deterministicFallbackMs + refinedTimingR4.deterministicFallbackMs
          });
        }
        return refinedResponseR3;
      }
      routeQuery.smartDurationDecision677A = smartDurationDecision677A;
    }
  }

  performanceR3.candidatePreparationMs = elapsedR3(candidatePreparationStartedR3);
  candidatePreparationStartedR3 = null;
  const selectionStartedR3 = process.hrtime.bigint();
  let selection = await selectTourWithOptionalProviderRanking(combined, routeQuery);
  performanceR3.routeSelectionMs = elapsedR3(selectionStartedR3);
  let selectedTour = selection?.tour ? (guardEnabled() ? normalizeAirportIntegrity(selection.tour, routeQuery) : selection.tour) : null;

  // GV-REC-684B: planning-only role assignment can accidentally hide a genuinely
  // affordable flight trip (for example, returning only a regional ground route).
  // For default / balance / memorable lanes, inspect at most two plausible flight
  // candidates and require complete 684A exact-date LIVE evidence before rescuing
  // one into the result. Lowest-cost is intentionally left alone so a cheaper ground
  // trip can remain the true lowest-cost option.
  const discoveryStartedR3 = process.hrtime.bigint();
  let affordableFlightDiscovery684B = await discoverAffordableFlightTour684B(
    combined,
    selectedTour,
    routeQuery,
    {
      enrichTour: enrichTourWithCheapFlights,
      applyLiveFare: (tour, q) => applyPublicLiveFarePilot684A(tour, q),
      isOverBudget: isOverUserBudgetStrict684BR3,
      normalizeTour: (tour, q) => guardEnabled() ? normalizeAirportIntegrity(tour, q) : tour,
      totalUsd: totalEstimateUsdFromTour,
      budgetCeiling: budgetCeilingUsd,
      scoreCandidate: affordableFlightDiscoveryCandidateScore684B
    }
  );
  performanceR3.initial684BMs = elapsedR3(discoveryStartedR3);
  if (affordableFlightDiscovery684B.summary?.applied && affordableFlightDiscovery684B.tour) {
    const requestedDiscoveryRole684B = requestedPickRole670a(routeQuery);
    selectedTour = requestedDiscoveryRole684B
      ? {
          ...affordableFlightDiscovery684B.tour,
          sourceTourRole684B: tourRole670a(affordableFlightDiscovery684B.tour) || null,
          tourRole: requestedDiscoveryRole684B,
          tourRoleLabel: pickRoleLabel670a(requestedDiscoveryRole684B),
          recommendationLabel: pickRoleLabel670a(requestedDiscoveryRole684B)
        }
      : affordableFlightDiscovery684B.tour;
    selection = {
      ...(selection || {}),
      tour: selectedTour,
      enrichment: { ...(affordableFlightDiscovery684B.enrichment || {}), tour: selectedTour },
      routeRanking: {
        ...(selection?.routeRanking || {}),
        affordableFlightDiscovery684B: affordableFlightDiscovery684B.summary
      }
    };
  }

  if (!selectedTour) {
    const fallback = await globalFallbackResponse(routeQuery, 'base-routes-exceeded-user-budget', {
      noFeasibleTour: base.noFeasibleTour || { reason: 'base-routes-exceeded-user-budget' },
      diagnostics: base.diagnostics || null
    });
    if (fallback) {
      return {
        ...fallback,
        diagnostics: {
          ...(fallback.diagnostics || {}),
          affordableFlightDiscovery684B: affordableFlightDiscovery684B.summary || { ...status684B(), attempted: false, applied: false, reason: 'not-run' }
        }
      };
    }
    return {
      ok: true,
      supported: true,
      version: GENERATED_TOUR_VERSION,
      mode: 'generated-tour',
      requested: base.requested || {},
      tour: null,
      tours: [],
      noFeasibleTour: base.noFeasibleTour || { reason: 'no-generated-tour' },
      diagnostics: { ...(base.diagnostics || {}), generatedTourSelected: false, affordableFlightDiscovery684B: affordableFlightDiscovery684B.summary || { ...status684B(), attempted: false, applied: false, reason: 'not-run' } }
    };
  }

  let enrichment = selection?.enrichment;
  performanceR3.cheapFlightEnrichmentReused = Boolean(enrichment);
  if (!enrichment) {
    const enrichmentStartedR3 = process.hrtime.bigint();
    enrichment = await enrichTourWithCheapFlights(selectedTour, routeQuery);
    performanceR3.cheapFlightEnrichmentMs = elapsedR3(enrichmentStartedR3);
  }
  if (isOverUserBudget(enrichment.tour, routeQuery)) {
    enrichment = {
      tour: exactDateWindow669d(routeQuery) ? applyExactDateWindow669d(selectedTour, routeQuery) : selectedTour,
      summary: {
        enabled: scannerEnabled(),
        version: 'GV-TOUR-653A-R1',
        scannedLegCount: enrichment.summary?.scannedLegCount || 0,
        liveProviderCallsMade: enrichment.summary?.liveProviderCallsMade || 0,
        skippedOverBudgetCount: (enrichment.summary?.skippedOverBudgetCount || 0) + 1,
        source: 'budget-safe-base-route-with-provider-prices-held-back',
        rawFlightSearchHiddenFromUser: true,
        budgetGuardrail: 'provider prices were not applied because the combined route would exceed the user budget'
      }
    };
  }
  const publicLiveFareStartedR3 = process.hrtime.bigint();
  const publicLiveFare684A = await applyPublicLiveFarePilot684A(enrichment.tour, routeQuery);
  performanceR3.publicLiveFare684AMs = elapsedR3(publicLiveFareStartedR3);
  const verificationStartedR3 = process.hrtime.bigint();
  const liveVerification = await verifyTourWithLiveProviders(publicLiveFare684A.tour, routeQuery);
  performanceR3.liveProviderVerificationMs = elapsedR3(verificationStartedR3);
  // Includes existing post-verification rescue/recovery, when taken, as well as
  // budget checks, visualizer, guard, entry decoration and response assembly.
  finalizationStartedR3 = process.hrtime.bigint();
  enrichment = {
    ...enrichment,
    tour: liveVerification.tour,
    liveProviderVerification: liveVerification.summary,
    publicLiveFarePilot684A: publicLiveFare684A.summary
  };
  const strictLiveBudgetFit684BR3 = strictBudgetFit684BR3(enrichment.tour, routeQuery);
  let routeStillOverBudgetAfterLive684B = Boolean(
    liveVerification.summary?.overBudget
      || publicLiveFare684A.summary?.overBudget
      || (publicLiveFare684A.summary?.applied === true && strictLiveBudgetFit684BR3.overBudget === true)
  );
  if (routeStillOverBudgetAfterLive684B && affordableFlightDiscovery684B.summary?.reason === '684b-selected-route-already-has-flight') {
    const postLive684BRescueStartedR4 = process.hrtime.bigint();
    // GV-REC-684B-R3 preserves R2 rescue: the selected planning route may already contain flights, so
    // R1 intentionally skipped discovery. If 684A then proves that selected route
    // is over budget, give the bounded shortlist one chance to rescue a DIFFERENT
    // flight-bearing route using complete exact-date live evidence. This is the
    // Toronto C$1,500 failure mode: do not stop at the first flight route merely
    // because it had flights before its real fare was known.
    const overBudgetFlightRescue684B = await discoverAffordableFlightTour684B(
      combined,
      selectedTour,
      routeQuery,
      {
        enrichTour: enrichTourWithCheapFlights,
        applyLiveFare: (tour, q) => applyPublicLiveFarePilot684A(tour, q),
        isOverBudget: isOverUserBudgetStrict684BR3,
        normalizeTour: (tour, q) => guardEnabled() ? normalizeAirportIntegrity(tour, q) : tour,
        totalUsd: totalEstimateUsdFromTour,
        budgetCeiling: budgetCeilingUsd,
        scoreCandidate: affordableFlightDiscoveryCandidateScore684B,
        allowSelectedFlightFallback: true
      }
    );
    affordableFlightDiscovery684B = overBudgetFlightRescue684B;
    performanceR4.rescueProviderRequests = Number(overBudgetFlightRescue684B.summary?.providerRequests || 0);
    if (overBudgetFlightRescue684B.summary?.applied && overBudgetFlightRescue684B.tour) {
      const requestedDiscoveryRole684B = requestedPickRole670a(routeQuery);
      const rescuedSelectedTour684B = requestedDiscoveryRole684B
        ? {
            ...overBudgetFlightRescue684B.tour,
            sourceTourRole684B: tourRole670a(overBudgetFlightRescue684B.tour) || null,
            tourRole: requestedDiscoveryRole684B,
            tourRoleLabel: pickRoleLabel670a(requestedDiscoveryRole684B),
            recommendationLabel: pickRoleLabel670a(requestedDiscoveryRole684B)
          }
        : overBudgetFlightRescue684B.tour;
      const rescuedVerification684B = await verifyTourWithLiveProviders(rescuedSelectedTour684B, routeQuery);
      const rescuedOverBudget684B = Boolean(rescuedVerification684B.summary?.overBudget || isOverUserBudgetStrict684BR3(rescuedVerification684B.tour, routeQuery));
      if (!rescuedOverBudget684B) {
        selectedTour = rescuedSelectedTour684B;
        enrichment = {
          ...(overBudgetFlightRescue684B.enrichment || {}),
          tour: rescuedVerification684B.tour,
          liveProviderVerification: rescuedVerification684B.summary,
          publicLiveFarePilot684A: overBudgetFlightRescue684B.enrichment?.publicLiveFarePilot684A || null,
          affordableFlightDiscovery684B: overBudgetFlightRescue684B.summary
        };
        selection = {
          ...(selection || {}),
          tour: selectedTour,
          enrichment,
          routeRanking: {
            ...(selection?.routeRanking || {}),
            affordableFlightDiscovery684B: overBudgetFlightRescue684B.summary
          }
        };
        routeStillOverBudgetAfterLive684B = false;
      }
    }
    performanceR4.postLive684BRescueMs = elapsedR3(postLive684BRescueStartedR4);
  }
  if (routeStillOverBudgetAfterLive684B) {
    const budgetVerification = publicLiveFare684A.summary?.overBudget && !liveVerification.summary?.overBudget
      ? { ...liveVerification, summary: { ...liveVerification.summary, overBudget: true, budgetClaim: 'over-budget-after-684a-live-fare', publicLiveFarePilot684A: publicLiveFare684A.summary } }
      : liveVerification;
    const budgetRecoveryStartedR4 = process.hrtime.bigint();
    const recovered = await attemptBudgetSafeRouteRecovery669c(routeQuery, budgetVerification);
    performanceR4.budgetRecoveryMs = elapsedR3(budgetRecoveryStartedR4);
    if (recovered) return recovered;
    return {
      ok: true,
      supported: false,
      reason: 'provider-verified-route-over-budget',
      message: 'Provider evidence increased the route above the entered budget. Please regenerate or increase the budget.',
      tour: null,
      tours: [],
      noFeasibleTour: { reason: 'provider-verified-route-over-budget' },
      diagnostics: {
        generatedTourSelected: false,
        liveProviderVerification: liveVerification.summary,
        publicLiveFarePilot684A: publicLiveFare684A.summary,
        affordableFlightDiscovery684B: affordableFlightDiscovery684B.summary || { ...status684B(), attempted: false, applied: false, reason: 'not-run' }
      }
    };
  }
  const visualizerStartedR4 = process.hrtime.bigint();
  const exactPreservedTour = exactDateWindow669d(routeQuery)
    ? recomputeTourTotals(applyExactDateWindow669d(enrichment.tour, routeQuery), routeQuery)
    : enrichment.tour;
  const visualizerTour = buildVisualizerTour(guardEnabled() ? normalizeAirportIntegrity(exactPreservedTour, routeQuery) : exactPreservedTour, routeQuery, enrichment);
  performanceR4.visualizerMs = elapsedR3(visualizerStartedR4);
  const finalGuardStartedR4 = process.hrtime.bigint();
  const finalGuard = evaluateTour(visualizerTour, routeQuery);
  performanceR4.finalGuardMs = elapsedR3(finalGuardStartedR4);
  if (!finalGuard.accepted) {
    return {
      ok: true,
      supported: false,
      reason: 'no-route-passed-feasibility-guard',
      message: 'No route passed the trip-length, geographic, and airport checks. Try fewer stops or a longer trip.',
      tour: null,
      tours: [],
      noFeasibleTour: { reason: 'no-route-passed-feasibility-guard' },
      diagnostics: {
        generatedTourSelected: false,
        routeFeasibilityGuard: {
          enabled: true,
          version: GUARD_VERSION,
          accepted: false,
          reasons: finalGuard.reasons,
          metrics: finalGuard.metrics,
          warnings: finalGuard.warnings
        }
      }
    };
  }
  const guardedVisualizerTour = decoratePickTour670a(finalGuard.tour, routeQuery);
  const finalDurationDecision677A = smartDurationDecision677A || durationDecision674A;
  guardedVisualizerTour.adaptiveDurationDecision = finalDurationDecision677A;
  guardedVisualizerTour.smartDurationDecision = smartDurationDecision677A || null;
  guardedVisualizerTour.entryEligibility = recommendationEligibility(guardedVisualizerTour, routeQuery);
  if (guardedVisualizerTour?.itineraryDatePlan?.consistent === false) {
    return {
      ok: true,
      supported: false,
      reason: 'stale-or-mixed-itinerary-dates',
      message: 'The route dates could not be synchronized safely. Please regenerate the tour.',
      tour: null,
      tours: [],
      diagnostics: {
        generatedTourSelected: false,
        itineraryDatePlan: guardedVisualizerTour.itineraryDatePlan
      }
    };
  }
  const strictFinalBudgetFitMain684BR3 = strictBudgetFit684BR3(guardedVisualizerTour, routeQuery);
  const strictPilotGuardRequiredMain684BR3 = Boolean(
    enrichment?.publicLiveFarePilot684A?.applied === true
      || affordableFlightDiscovery684B?.summary?.applied === true
  );
  if ((strictPilotGuardRequiredMain684BR3 && strictFinalBudgetFitMain684BR3.overBudget === true) || isOverUserBudget(guardedVisualizerTour, routeQuery)) {
    return {
      ok: true,
      supported: false,
      reason: 'no-generated-tour-within-budget',
      message: 'No strong route found within this budget. Try increasing the budget, reducing stops, or choosing a shorter trip.',
      tour: null,
      tours: [],
      noFeasibleTour: { reason: 'no-generated-tour-within-budget' },
      diagnostics: {
        generatedTourSelected: false,
        globalFallbackUsed: false,
        globalFallbackReason: 'final-generated-route-budget-guardrail',
        budgetGuardrail: 'generated-route-exceeded-user-budget',
        overBudgetEstimateUsd: totalEstimateUsdFromTour(guardedVisualizerTour, routeQuery),
        budgetCeilingUsd: budgetCeilingUsd(guardedVisualizerTour, routeQuery),
        strictCurrencyBudgetFit684BR3: strictFinalBudgetFitMain684BR3
      }
    };
  }
  const responseAssemblyStartedR4 = process.hrtime.bigint();
  const finalResponseR4 = {
    ok: true,
    supported: true,
    version: GENERATED_TOUR_VERSION,
    mode: 'generated-tour-visualizer',
    requested: base.requested || {},
    pricingPolicy: {
      aiRouteDiversity687B: selection?.routeRanking?.aiRouteDiversity687B ? { enabled: selection.routeRanking.aiRouteDiversity687B.enabled, version: selection.routeRanking.aiRouteDiversity687B.version, selectedBy: selection.routeRanking.aiRouteDiversity687B.selectedBy } : null,
      aiRouteCurator: selection?.routeRanking?.aiRouteCurator ? { enabled: selection.routeRanking.aiRouteCurator.enabled, selectedBy: selection.routeRanking.aiRouteCurator.selectedBy } : null,
      source: scannerEnabled() ? (automaticCheapDateTourBuilderEnabled() ? 'automatic-provider-cheap-date-tour-builder+provider-driven-global-route-graph-665b' : (scanner650BEnabled() ? 'provider-backed-six-month-cheapest-one-way-date-scanner-657a' : 'cheap-one-way-scanner-with-planning-fallback')) : 'planning-fallback-scanner-disabled',
      userVisibleRawFlightSearch: false,
      providerVerificationRequiredBeforeBooking: true,
      liveProviderVerification: { enabled: liveProviderVerificationEnabled(), version: LIVE_PROVIDER_VERIFICATION_VERSION, summary: enrichment.liveProviderVerification || null },
      publicLiveFarePilot684A: { version: VERSION_684A, status: status684A(), summary: enrichment.publicLiveFarePilot684A || null },
      affordableFlightDiscovery684B: { version: VERSION_684B, status: status684B(), summary: enrichment.affordableFlightDiscovery684B || affordableFlightDiscovery684B?.summary || null },
      passengerRoomPricing: {
        enabled: true,
        version: PRICING_INTEGRITY_VERSION,
        party: normalizeParty(routeQuery),
        rule: 'flight and public-transfer amounts scale by travellers; stay estimates scale by required room count'
      }
    },
    bookingPolicy: {
      version: 'GV-LINK-663A+GV-GLOBAL-665B+GV-MVP-666A+GV-DATE-666B+GV-LIVE-667B',
      flightLinks: 'provider ticket link when available; otherwise prefilled Aviasales one-way comparison',
      hotelLinks: 'specific Agoda hotel when available; otherwise prefilled Agoda city search',
      exactBookablePriceClaimedOnlyWithProviderEvidence: true,
      finalPriceRequiresPartnerConfirmation: true
    },
    tour: guardedVisualizerTour,
    tours: [guardedVisualizerTour],
    entryEligibility: guardedVisualizerTour.entryEligibility,
    diagnostics: {
      ...(base.diagnostics || {}),
      globalRouteGraph: graph.diagnostics || { enabled: false, version: GLOBAL_ROUTE_GRAPH_VERSION },
      generatedTourSelected: true,
      entryEligibilityVersion: ENTRY_ELIGIBILITY_VERSION,
      entryBlockedCandidateCount: entryBlockedCandidates.length,
      globalFallbackUsed: false,
      mapFirstThreePicks: {
        enabled: mapFirstThreePicks670aEnabled(),
        version: 'GV-UX-670A',
        requestedRole: requestedPickRole670a(routeQuery) || null,
        roleMatched: guardedVisualizerTour?.pickRoleMatched !== false
      },
      aiAssistedRouteDiversity687B: {
        enabled: aiRouteDiversity687BEnabled(routeQuery),
        version: AI_ROUTE_DIVERSITY_VERSION_687B,
        requestedRole: requestedPickRole670a(routeQuery) || null,
        selection: selection?.routeRanking?.aiRouteDiversity687B || guardedVisualizerTour?.aiAssistedRouteDiversity687B || null,
        safetyBoundary: 'AI may rank only already-valid candidate IDs; deterministic budget, route, entry and provider evidence remain authoritative'
      },
      quality680BR1: {
        version: 'GV-QUALITY-680B-R1',
        recommendationScopePreserved: routeQuery.recommendationScope,
        automaticLeadTime: routeQuery.__leadTime680BR1 || null,
        preferences: {
          travelPace: normalizeTravelPace680BR1(routeQuery),
          flightPreference: normalizeFlightPreference680BR1(routeQuery),
          priorities: preferenceKeys680BR1(routeQuery),
          inferredTheme: routeQuery.theme || null,
          maxStopsAfterPace: Number(routeQuery.maxStops || 0) || null
        }
      },
      adaptiveDuration: finalDurationDecision677A,
      smartDuration: smartDurationDecision677A || null,
      smartFlightSelection: {
        enabled: smartFlightDateSelection677BEnabled() || smartDurationFlightSelection677AEnabled(),
        version: smartFlightDateIntegrity677BR1Enabled() && smartFlightDateSelection677BEnabled() ? SMART_FLIGHT_DATE_INTEGRITY_VERSION_677B_R1 : (smartFlightDateSelection677BEnabled() ? SMART_FLIGHT_DATE_SELECTION_VERSION_677B : SMART_DURATION_VERSION_677A),
        policy: smartFlightDateSelection677BEnabled()
          ? (enrichment?.summary?.wholeTripDateOptimization?.applied
            ? `681B-P2 compares complete synchronized schedules within the ${automaticLegWindowDays(routeQuery, 0)}-day flexible window; every flight leg must have exact-date provider evidence, while hotel, ground and access amounts remain planning estimates`
            : (smartFlightDateIntegrity677BR1Enabled()
              ? `provider-backed options balance fare, duration, connections, useful travel time and full-trip budget pressure; the first trip departure may shift within the ${automaticLegWindowDays(routeQuery, 0)}-day flexible window, while downstream legs remain on the canonical stay cadence`
              : 'provider-backed options may shift route cadence by up to three days and balance fare, duration, connections, useful travel time and full-trip budget pressure; exact user dates remain protected'))
          : 'provider-backed flight observations balance fare, duration, connection count and timing while preserving budget guardrails'
      },
      smartFlightQualityGuardrails: {
        enabled: smartRouteRelativeFlightQuality677BR3Enabled() || smartFlightQualityGuardrails677BR2Enabled(),
        version: smartRouteRelativeFlightQuality677BR3Enabled() ? SMART_FLIGHT_ROUTE_RELATIVE_QUALITY_VERSION_677B_R3 : (smartFlightQualityGuardrails677BR2Enabled() ? SMART_FLIGHT_QUALITY_GUARDRAIL_VERSION_677B_R2 : null),
        policy: smartRouteRelativeFlightQuality677BR3Enabled()
          ? 'route-relative flight quality thresholds compare observed journey duration against a direct-ish distance baseline; inefficient short/medium-haul observations are excluded from confident smart ranking or labelled as limited provider evidence; R2 budget and honesty guardrails remain preserved'
          : (smartFlightQualityGuardrails677BR2Enabled() ? 'avoid presenting severely inefficient provider observations as smart choices; use route-distance and observed-duration guardrails; preserve canonical date when all observed options are poor; label limited provider evidence honestly' : null)
      },
      smartFlightDateSelection: {
        enabled: smartFlightDateSelection677BEnabled(),
        version: smartFlightDateIntegrity677BR1Enabled() && smartFlightDateSelection677BEnabled() ? SMART_FLIGHT_DATE_INTEGRITY_VERSION_677B_R1 : SMART_FLIGHT_DATE_SELECTION_VERSION_677B,
        maxAutomaticDateShiftDays: automaticLegWindowDays(routeQuery, 0),
        firstLegMaxAutomaticDateShiftDays: automaticLegWindowDays(routeQuery, 0),
        downstreamLegMaxAutomaticDateShiftDays: automaticLegWindowDays(routeQuery, 1),
        independentDownstreamDateShifts: !(smartFlightDateIntegrity677BR1Enabled() && smartFlightDateSelection677BEnabled()),
        routeOrderOptimization: wholeTripRouteOptimization677CEnabled(),
        policy: enrichment?.summary?.wholeTripDateOptimization?.applied
          ? `681B-P2 moves the complete synchronized schedule together: the first departure may shift within ${automaticLegWindowDays(routeQuery, 0)} days, and every downstream flight date is derived from the preserved city-night cadence rather than shifted independently`
          : (wholeTripRouteOptimization677CEnabled()
            ? `677C compares the complete feasible route and stop order before provider/date enrichment; 681B-P1 permits provider-backed movement only on the first departure within a ${automaticLegWindowDays(routeQuery, 0)}-day window so downstream city-night cadence remains intact`
            : (smartFlightDateIntegrity677BR1Enabled() && smartFlightDateSelection677BEnabled()
              ? `681B-P1 permits provider-backed date movement only on the initial departure within a ${automaticLegWindowDays(routeQuery, 0)}-day window; all later legs stay on the established city-night cadence so optimization cannot silently add nights or create mixed itinerary dates`
              : 'V1 optimizes each flight/date within the current route sequence and full-trip budget guardrail; route permutation is intentionally deferred'))
      },
      wholeTripDateOptimization681BP2: enrichment?.summary?.wholeTripDateOptimization || { enabled: wholeTripDateOptimizer681BP2Enabled(), version: WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2, applied: false, reason: 'not-run' },
      wholeTripRouteOptimization: {
        enabled: wholeTripRouteOptimization677CEnabled(),
        version: WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C,
        routeOrderOptimization: wholeTripRouteOptimization677CEnabled(),
        candidateSetOptimization: wholeTripRouteOptimization677CEnabled(),
        selectedCandidate: selection?.routeRanking?.wholeTripRouteOptimization || null,
        selectedTourOrder: guardedVisualizerTour?.routeOrderOptimization || null,
        selectedCandidateQuality: wholeTripRouteOptimization677CEnabled() ? wholeTripCandidateAdjustment677C(guardedVisualizerTour, routeQuery) : null,
        policy: 'compare the whole itinerary using travel burden, backtracking, total-group budget pressure, route-relative provider quality and destination redundancy; preserve saved/manual order and gateway dependencies'
      },
      destinationValueProximity: {
        enabled: destinationValueProximity677DEnabled(),
        version: DESTINATION_VALUE_PROXIMITY_VERSION_677D,
        candidateSetOptimization: destinationValueProximity677DEnabled(),
        selectedCandidate: selection?.routeRanking?.destinationValueProximity || null,
        selectedTourQuality: destinationValueProximity677DEnabled() ? destinationValueCandidateAdjustment677D(guardedVisualizerTour, routeQuery) : null,
        policy: 'protect scarce overnight stops from origin-adjacent/day-trip-range redundancy, reward familiar-anchor + discovery mix modestly, and allow a stronger single destination to beat a forced weak multi-stop route'
      },
      transportModeIntegrity: {
        enabled: transportModeIntegrity677AR1Enabled(),
        version: TRANSPORT_MODE_INTEGRITY_VERSION_677A_R1,
        policy: 'pure ground legs are preserved only when geographically plausible; composite flight+ground legs remain flight-bearing'
      },
      routeProviderRanking: selection?.routeRanking || { enabled: false },
      aiRouteCurator: selection?.routeRanking?.aiRouteCurator || null,
      liveProviderCallsMade: enrichment.summary.liveProviderCallsMade || 0,
      liveProviderVerification: enrichment.liveProviderVerification || null,
      publicLiveFarePilot684A: enrichment.publicLiveFarePilot684A || { ...status684A(), attempted: false, applied: false, reason: 'not-run' },
      affordableFlightDiscovery684B: enrichment.affordableFlightDiscovery684B || affordableFlightDiscovery684B?.summary || { ...status684B(), attempted: false, applied: false, reason: 'not-run' },
      scannedLegCount: enrichment.summary.scannedLegCount || 0,
      routeFeasibilityGuard: {
        enabled: guardEnabled(),
        version: GUARD_VERSION,
        accepted: true,
        metrics: finalGuard.metrics,
        warnings: finalGuard.warnings,
        candidateDiagnostics: selection?.routeRanking?.routeFeasibilityGuard || null
      }
    }
  };
  performanceR4.responseAssemblyMs = elapsedR3(responseAssemblyStartedR4);
  return finalResponseR4;
  })();
  const responseR3 = {
    ...resultR3,
    diagnostics: { ...(resultR3.diagnostics || {}), performanceR3, performanceR4 }
  };
  const finishedR3 = process.hrtime.bigint();
  if (candidatePreparationStartedR3 !== null) {
    performanceR3.candidatePreparationMs = Number(finishedR3 - candidatePreparationStartedR3) / 1e6;
  }
  if (finalizationStartedR3 !== null) {
    performanceR3.finalizationMs = Number(finishedR3 - finalizationStartedR3) / 1e6;
  }
  performanceR3.totalMs = Number(finishedR3 - startedR3) / 1e6;
  return responseR3;
}

module.exports = {
  GENERATED_TOUR_VERSION,
  FLEXIBLE_DATE_ENGINE_VERSION_681B_P1,
  WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2,
  STAY22_EVIDENCE_VERSION_682B,
  PROPERTY_IDENTITY_VERSION_682C,
  VERSION_683H,
  VERSION_684A,
  VERSION_684B,
  SMART_DURATION_VERSION_677A,
  TRANSPORT_MODE_INTEGRITY_VERSION_677A_R1,
  SMART_FLIGHT_DATE_SELECTION_VERSION_677B,
  SMART_FLIGHT_DATE_INTEGRITY_VERSION_677B_R1,
  SMART_FLIGHT_QUALITY_GUARDRAIL_VERSION_677B_R2,
  SMART_FLIGHT_ROUTE_RELATIVE_QUALITY_VERSION_677B_R3,
  WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C,
  DESTINATION_VALUE_PROXIMITY_VERSION_677D,
  scannerEnabled,
  scanner650BEnabled,
  automaticCheapDateTourBuilderEnabled,
  generatedTourEnabled,
  getGeneratedTour,
  buildVisualizerTour,
  enrichTourWithCheapFlights,
  automaticMinimumLeadDays680B,
  initialAutomaticStartDate,
  automaticTourCandidateScore,
  selectBudgetSafeTour,
  effectiveFlexibleMonth680BR1,
  prepareFlexibleLeadTimeQuery680BR1,
  preferenceMatchAdjustment680BR1,
  flightPreferenceAdjustment680BR1,
  _internal: { safeMonth, defaultScanStartMonth, cheapDateScanMonths, legCode, convertProviderPriceToUsd, routeRankingEnabled, priceTourForParty, automaticCheapDateTourBuilderEnabled, initialAutomaticStartDate, synchronizeStopsWithLegDates, automaticFirstLegWindowDays681BP1, automaticLegWindowDays, maxAllowedDepartureDate, filterObservationsWithinDateWindow, selectObservationWithinDateWindow, automaticAlignedLegDate, maxStopsForTrip, evaluateTour, officialDepartureDateForLeg, enrichLegsForPresentation, itineraryDateConsistency, allTourStopsProductionActive, mvpValidationRepairs669bEnabled, budgetSafeRouteRecovery669cEnabled, budgetRecoveryAttempt669c, exactDateFamilyOccupancy669dEnabled, exactDateWindow669d, allocateExactNights669d, applyExactDateWindow669d, exactObservationForDate669d, mapFirstThreePicks670aEnabled, normalizePickRole670a, requestedPickRole670a, tourRole670a, routeKey670aR2, threePickBalanceScore670aR2, threePickMemorableScore670aR2, threePickRoleAssignments670aR2, roleScopedCandidatePool670a, decoratePickTour670a, explicitTripNights674A, resolveAdaptiveDuration674A, smartDurationFlightSelection677AEnabled, smartStopBounds677A, routeTravelHours677A, smartBudgetCapacity677A, resolveSmartDuration677A, smartFlightDateSelection677BEnabled, smartFlightQualityGuardrails677BR2Enabled, smartRouteRelativeFlightQuality677BR3Enabled, wholeTripRouteOptimization677CEnabled, optimizeTourOrder677C, wholeTripCandidateAdjustment677C, destinationValueProximity677DEnabled, destinationValueCandidateAdjustment677D, selectionContext677B, transportModeIntegrity677AR1Enabled, smartFlightDateIntegrity677BR1Enabled, wholeTripDateOptimizer681BP2Enabled, duffelP2Enabled683H, duffelP2Status683H, stay22P2DatePricingEnabled682B, stay22P2OptimizerEligible682B, stay22P2MaxRequests682B, stopHotelEstimateUsd682B, selectedHotelName682B, selectedHotelIdentity682C, stay22HotelPricingForCandidate682B, monthsCoveringDateRange681BP2, mergeMonthlyProviderResults681BP2, buildWholeTripDatePlan681BP2, legHasFlightComponent677AR1, legHasGroundComponent677AR1, pureGroundLeg677AR1, normalizeTransportModeIntegrity677AR1, strictBudgetFit684BR3, isOverUserBudgetStrict684BR3 }
};
