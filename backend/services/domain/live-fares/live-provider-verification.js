'use strict';

// GV-EVIDENCE-667E: exact-date provider evidence plus transport-evidence integrity.
// This layer never treats a comparison link as a guaranteed fare. It verifies whether
// the selected route/date appears in provider results, records evidence freshness, and
// downgrades the budget claim whenever critical items remain estimates.

const { fetchFlightDates683C } = require('../../providers/flights/flight-provider-router-683c');
const { fetchAgodaStayEstimate, AGODA_PROVIDER_STAY_VERSION_679A, AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1, BOOKING_TRUST_VERSION_680A, providerStayIntegration679AEnabled, priceLinkIntegrity679AR1Enabled } = require('../../providers/stays/agoda/agoda');
const { AGODA_HANDOFF_INTEGRITY_VERSION_679A_R2, agodaHandoffIntegrity679AR2Enabled } = require('../../providers/links/partner-links');
const { getDestination } = require('../../../data/destination-meta');
const { normalizeParty, priceTransportLeg, applyTravellerPricingToTour } = require('../pricing/traveller-pricing');
const { currencyToUsdRate, normalizeCurrency } = require('../../../budget-presentation');
const { applyCanonicalIntegrity, enabled: canonicalIntegrityEnabled, CANONICAL_INTEGRITY_VERSION } = require('../pricing/canonical-total-evidence');
const { SOURCE_TYPES, normalizeFlightEvidence, normalizeHotelEvidence } = require('../pricing/price-evidence-integrity');
const { STAY22_EVIDENCE_VERSION_682B, enabled: stay22EvidenceEnabled682B, fetchStay22Evidence } = require('../../providers/stays/stay22/stay22-evidence-682b');
const { PROPERTY_IDENTITY_VERSION_682C, buildPropertyIdentity } = require('../../providers/stays/shared/property-identity-682c');

const LIVE_PROVIDER_VERIFICATION_VERSION = 'GV-EVIDENCE-667E';
const DEFAULT_MAX_FLIGHT_LEGS = 4;
const DEFAULT_MAX_STAYS = 3;

function enabled() {
  const raw = String(process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A || process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667B || '').trim().toLowerCase();
  return raw ? raw === 'true' : false;
}

function safeDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

function safeIata(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function endpointCode(node = {}) {
  return safeIata(node.airportCode || node.code || node.displayCode);
}

function transportEvidenceEnabled() {
  const raw = String(process.env.ENABLE_TRANSPORT_EVIDENCE_ACTION_LABELS_667E || '').trim().toLowerCase();
  return raw ? raw === 'true' : false;
}

function isGroundLeg(leg = {}) {
  const text = `${String(leg.mode || '')} ${String(leg.transportType || '')} ${String(leg.operator || '')}`.toLowerCase();
  const segments = Array.isArray(leg.segments) ? leg.segments : [];
  const hasFlight = text.includes('flight') || segments.some(segment => `${String(segment?.mode || '')} ${String(segment?.transportType || '')}`.toLowerCase().includes('flight'));
  if (hasFlight) return false;
  return text.includes('ground')
    || text.includes('rail')
    || text.includes('bus')
    || text.includes('ferry')
    || text.includes('boat')
    || text.includes('shuttle')
    || text.includes('transfer')
    || text.trim().length > 0;
}

function officialLegDate(leg = {}) {
  const evidence = leg.cheapestOneWay || leg.providerDateEvidence || {};
  const auto = leg.automaticTourDate || {};
  const providerApplied = evidence.appliedToEstimate !== false && (leg.liveFareVerified || evidence.providerBacked);
  return safeDate(providerApplied ? evidence.departureDate : null)
    || safeDate(auto.departureDate)
    || safeDate(leg.departureDate)
    || safeDate(leg.dateLabel);
}

function exactObservation(result = {}, date) {
  const exact = safeDate(date);
  if (!exact) return null;
  return (Array.isArray(result.observations) ? result.observations : []).find((row) => safeDate(row?.departureDate) === exact) || null;
}

function matchingObservation(result = {}, request = {}) {
  const candidate = exactObservation(result, request.departureDate);
  if (!candidate) return null;
  const evidence = candidate.priceEvidence || normalizeFlightEvidence(candidate, { ...request, sourceType: SOURCE_TYPES.CACHED });
  return evidence.routeMatch && evidence.dateMatch && evidence.currencyMatch ? { candidate, evidence } : null;
}

function ageSeconds(timestamp) {
  const parsed = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

function freshnessLabel({ cacheHit, age }) {
  if (cacheHit) return 'cached-within-provider-ttl';
  if (Number.isFinite(age) && age <= 300) return 'fresh-provider-request';
  return 'provider-observation';
}

function existingDecisionGradeLiveEvidence683JR2(leg = {}) {
  const evidence = leg.providerDateEvidence || leg.cheapestOneWay || {};
  const origin = endpointCode(leg.from || {});
  const destination = endpointCode(leg.to || {});
  const departureDate = safeDate(leg.departureDate || leg.dateLabel || evidence.departureDate);
  const providerCurrency = normalizeCurrency(evidence.providerCurrency || evidence.currency || 'USD');
  const canonical = evidence.priceEvidence || normalizeFlightEvidence(evidence, {
    origin,
    destination,
    departureDate,
    currency: providerCurrency,
    sourceType: evidence.sourceType || SOURCE_TYPES.ESTIMATED
  });
  const marker = evidence.canonicalLiveEvidence683JR2 || null;
  const decisionGrade = evidence.providerEvidenceClass === 'LIVE_PROVIDER'
    && evidence.providerRankingGrade === 'DECISION_GRADE';
  const markerEligible = marker?.version === 'GV-PROVIDER-683J-R2'
    && marker?.nonDowngradeEligible === true;
  const exactLive = canonical?.sourceType === SOURCE_TYPES.LIVE
    && canonical?.isExactDate === true
    && canonical?.routeMatch === true
    && canonical?.dateMatch === true;
  if (!origin || !destination || !departureDate || !exactLive || (!decisionGrade && !markerEligible)) return null;
  return { evidence, canonical, marker, origin, destination, departureDate };
}

function preserveExistingLiveDecisionGrade683JR2(leg = {}, query = {}) {
  const existing = existingDecisionGradeLiveEvidence683JR2(leg);
  if (!existing) return null;
  const evidence = {
    ...existing.evidence,
    priceEvidence: existing.canonical,
    evidenceId: existing.evidence.evidenceId || existing.canonical.evidenceId,
    sourceType: SOURCE_TYPES.LIVE,
    providerEvidenceClass: existing.evidence.providerEvidenceClass || 'LIVE_PROVIDER',
    providerRankingGrade: existing.evidence.providerRankingGrade || 'DECISION_GRADE',
    productionEligible: existing.evidence.productionEligible !== false,
    providerBacked: existing.evidence.providerBacked !== false,
    appliedToEstimate: existing.evidence.appliedToEstimate !== false,
    canonicalLiveEvidence683JR2: existing.marker || existing.evidence.canonicalLiveEvidence683JR2
  };
  const party = normalizeParty(query);
  const observedAt = evidence.observedAt || evidence.providerFetchedAt || evidence.retrievedAt || null;
  return {
    leg: {
      ...leg,
      liveFareVerified: true,
      providerFareObserved: true,
      providerVerificationRequired: false,
      providerDateEvidence: evidence,
      cheapestOneWay: evidence,
      providerVerification: {
        version: LIVE_PROVIDER_VERIFICATION_VERSION,
        status: 'existing-live-decision-grade-preserved-683j-r2',
        critical: true,
        verified: true,
        providerFareObserved: true,
        sourceType: SOURCE_TYPES.LIVE,
        evidenceId: evidence.evidenceId || existing.canonical.evidenceId,
        currentPriceConfirmed: true,
        availabilityConfirmed: false,
        isBookable: false,
        exactDateMatch: true,
        provider: evidence.source || 'Live flight provider',
        route: { origin: existing.origin, destination: existing.destination, departureDate: existing.departureDate },
        checkedAt: new Date().toISOString(),
        observedAt,
        observedAgeSeconds: ageSeconds(observedAt),
        freshness: freshnessLabel({ cacheHit: Boolean(evidence.cacheHit), age: ageSeconds(observedAt) }),
        cacheHit: Boolean(evidence.cacheHit),
        endpointUsed: evidence.endpointUsed || null,
        passengerCount: party.travellers,
        fareUnits: party.flightFareUnits,
        productionEligible: evidence.productionEligible !== false,
        nonDowngradePreserved683JR2: true,
        canonicalLiveEvidence683JR2: evidence.canonicalLiveEvidence683JR2 || null
      }
    },
    outcome: 'live-provider-observation-preserved-683j-r2'
  };
}

function destinationForStop(stop = {}) {
  const refs = [stop.cityId, stop.id, stop.code, stop.airportCode, stop.city].filter(Boolean);
  for (const ref of refs) {
    const record = getDestination(ref);
    if (record) return record;
  }
  const agodaCityId = Number(stop.agodaCityId || stop?.hotel?.agodaCityId || 0) || null;
  if (!agodaCityId) return null;
  return {
    id: stop.cityId || stop.id || null,
    city: stop.city || 'Destination',
    code: stop.code || stop.airportCode || null,
    agodaCityId,
    fallbackNightlyUsd: Number(stop?.hotel?.estimatedNightlyUsd || stop?.hotel?.averageNightlyUsd || 85)
  };
}

function budgetCeilingUsd(tour = {}, query = {}) {
  const direct = Number(tour.totalBudgetUsd || query.budgetUsd || 0);
  if (Number.isFinite(direct) && direct > 0) return direct + Math.max(5, direct * 0.005);
  const amount = Number(query.budget || 0);
  if (!Number.isFinite(amount) || amount <= 0) return Infinity;
  const rate = currencyToUsdRate(normalizeCurrency(query.currency || 'CAD'));
  const converted = amount * rate;
  return converted + Math.max(5, converted * 0.005);
}

function totalUsd(tour = {}) {
  return Number(tour.estimatedTotalUsd || 0)
    || (Array.isArray(tour.legs) ? tour.legs.reduce((sum, leg) => sum + Number(leg.estimatedTransportUsd || leg.estimatedFlightUsd || leg.amountUsd || 0), 0) : 0)
      + (Array.isArray(tour.stops) ? tour.stops.reduce((sum, stop) => sum + Number(stop?.hotel?.estimatedStayUsd || stop?.hotel?.totalStayUsd || 0), 0) : 0);
}

async function verifyFlightLeg(leg, query = {}, options = {}) {
  if (isGroundLeg(leg)) {
    return {
      leg: {
        ...leg,
        providerVerification: {
          version: LIVE_PROVIDER_VERIFICATION_VERSION,
          status: 'ground-transport-estimate-requires-partner-confirmation',
          critical: transportEvidenceEnabled(),
          verified: false,
          productionEligible: false
        }
      },
      outcome: 'ground-transfer'
    };
  }

  // 683J-R2 evidence non-downgrade rule: if P2 already selected an exact-date
  // LIVE/DECISION_GRADE observation, later legacy/default-provider verification may
  // not overwrite it with cached/planning evidence. Preserve it and skip the
  // redundant provider lookup entirely.
  const preserved683JR2 = preserveExistingLiveDecisionGrade683JR2(leg, query);
  if (preserved683JR2) return preserved683JR2;

  const origin = endpointCode(leg.from || {});
  const destination = endpointCode(leg.to || {});
  const departureDate = officialLegDate(leg);
  if (!origin || !destination || !departureDate) {
    return {
      leg: {
        ...leg,
        providerVerification: {
          version: LIVE_PROVIDER_VERIFICATION_VERSION,
          status: 'missing-route-date-or-airport',
          critical: true,
          verified: false,
          route: { origin, destination, departureDate }
        }
      },
      outcome: 'missing-input'
    };
  }

  let result;
  try {
    result = await fetchFlightDates683C({
      origin,
      destination,
      currency: normalizeCurrency(query.currency || 'CAD'),
      month: departureDate.slice(0, 7),
      limit: 31,
      _fetchFn: options._fetchFn
    });
  } catch (error) {
    result = { supported: false, reason: 'provider-error', error: error.message, observations: [] };
  }

  const matched = matchingObservation(result, { origin, destination, departureDate, currency: normalizeCurrency(query.currency || 'CAD') });
  const observation = matched?.candidate || null;
  if (!observation) {
    return {
      leg: {
        ...leg,
        providerVerification: {
          version: LIVE_PROVIDER_VERIFICATION_VERSION,
          status: result?.reason || 'no-exact-date-observation',
          critical: true,
          verified: false,
          exactDateMatch: false,
          provider: result?.providerContract?.provider?.label || 'Flight provider',
          route: { origin, destination, departureDate },
          checkedAt: new Date().toISOString(),
          cacheHit: Boolean(result?.cacheHit),
          endpointUsed: result?.endpointUsed || null
        }
      },
      outcome: 'not-verified'
    };
  }

  const observedAt = observation.observedAt || observation.providerFetchedAt || result.fetchedAt || new Date().toISOString();
  const observedAgeSeconds = ageSeconds(observedAt);
  const perPassengerUsd = Number(observation.price || 0) * currencyToUsdRate(normalizeCurrency(observation.currency || query.currency || 'CAD'));
  const party = normalizeParty(query);
  const allowInjectedEvidence = String(process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION || '').trim().toLowerCase() === 'true';
  const providerDescriptor = result?.providerContract?.provider || {};
  const providerEvidenceClass = observation.providerEvidenceClass || providerDescriptor.evidenceClass || null;
  const providerRankingGrade = observation.providerRankingGrade || providerDescriptor.rankingGrade || null;
  const providerCanBeProductionEvidence = providerDescriptor.productionApproved !== false
    && providerEvidenceClass !== 'TEST_ONLY'
    && providerEvidenceClass !== 'UNAVAILABLE';
  const productionEligible = (!options._fetchFn || allowInjectedEvidence) && providerCanBeProductionEvidence;
  const liveDecisionGrade = productionEligible
    && providerEvidenceClass === 'LIVE_PROVIDER'
    && providerRankingGrade === 'DECISION_GRADE';
  const evidence = {
    ...(leg.providerDateEvidence || leg.cheapestOneWay || {}),
    departureDate,
    departureTime: observation.departureTime || null,
    arrivalTime: observation.arrivalTime || null,
    price: Number(observation.price || 0),
    currency: observation.currency || normalizeCurrency(query.currency || 'CAD'),
    airline: observation.airline || null,
    flightNumber: observation.flightNumber || null,
    transfers: observation.transfers,
    durationMinutes: observation.durationMinutes,
    durationLabel: observation.durationLabel || null,
    bookingLink: observation.bookingLink || null,
    source: observation.source || result?.providerContract?.provider?.id || 'flight-provider',
    providerBacked: true,
    appliedToEstimate: true,
    exactDateMatch: true,
    observedAt,
    observedAgeSeconds,
    cacheHit: Boolean(result.cacheHit),
    freshness: freshnessLabel({ cacheHit: result.cacheHit, age: observedAgeSeconds }),
    endpointUsed: result.endpointUsed || null,
    perPassengerAmountUsd: Number(perPassengerUsd.toFixed(2)),
    passengerPricingVersion: 'GV-MVP-666A',
    productionEligible
  };
  evidence.priceEvidence = matched.evidence;
  evidence.evidenceId = matched.evidence.evidenceId;
  evidence.sourceType = matched.evidence?.sourceType || observation.sourceType || SOURCE_TYPES.CACHED;
  evidence.providerEvidenceClass = providerEvidenceClass;
  evidence.providerRankingGrade = providerRankingGrade;

  if (!productionEligible) {
    return {
      leg: {
        ...leg,
        providerVerification: {
          version: LIVE_PROVIDER_VERIFICATION_VERSION,
          status: 'test-only-provider-response-not-production-evidence',
          critical: true,
          verified: false,
          exactDateMatch: true,
          provider: result?.providerContract?.provider?.label || 'Flight provider',
          route: { origin, destination, departureDate },
          checkedAt: new Date().toISOString(),
          productionEligible: false
        }
      },
      outcome: 'not-verified'
    };
  }

  const priced = priceTransportLeg({
    ...leg,
    mode: 'flight',
    transportType: 'flight',
    departureDate,
    dateLabel: departureDate,
    airline: observation.airline || leg.airline || null,
    liveFareVerified: liveDecisionGrade,
    providerFareObserved: true,
    providerDateEvidence: evidence,
    cheapestOneWay: evidence,
    estimateSource: 'provider-neutral-exact-date-flight-evidence-683c'
  }, query, { party, unitAmountUsd: perPassengerUsd });

  priced.providerVerification = {
    version: LIVE_PROVIDER_VERIFICATION_VERSION,
    status: liveDecisionGrade ? 'exact-date-live-provider-observation' : 'exact-date-provider-observation',
    critical: true,
    verified: liveDecisionGrade,
    providerFareObserved: true,
    sourceType: matched.evidence?.sourceType || observation.sourceType || SOURCE_TYPES.CACHED,
    evidenceId: matched.evidence.evidenceId,
    currentPriceConfirmed: liveDecisionGrade,
    availabilityConfirmed: false,
    isBookable: false,
    exactDateMatch: true,
    provider: result?.providerContract?.provider?.label || 'Flight provider',
    route: { origin, destination, departureDate },
    checkedAt: new Date().toISOString(),
    observedAt,
    observedAgeSeconds,
    freshness: evidence.freshness,
    cacheHit: Boolean(result.cacheHit),
    endpointUsed: result.endpointUsed || null,
    passengerCount: party.travellers,
    fareUnits: party.flightFareUnits,
    productionEligible
  };

  return { leg: priced, outcome: observation.providerEvidenceClass === 'LIVE_PROVIDER' ? 'live-provider-observation' : 'cached-observation' };
}

async function verifyStay(stop, query = {}, options = {}) {
  const destination = destinationForStop(stop);
  const checkIn = safeDate(stop.arrivalDate || stop.checkIn || stop?.hotel?.checkIn);
  const checkOut = safeDate(stop.departureDate || stop.checkOut || stop?.hotel?.checkOut);
  const nights = Math.max(1, Math.round(Number(stop.nights || 1)));
  const party = normalizeParty(query);
  const currency = normalizeCurrency(query.currency || 'CAD');
  const selectedPropertyIdentity = buildPropertyIdentity(stop?.hotel || {}, { city: destination?.city || stop.city, country: destination?.country || stop.country });
  const selectedPropertyName = selectedPropertyIdentity.safeForTargetedProviderSearch ? selectedPropertyIdentity.canonicalName : null;

  if (!destination || !checkIn || !checkOut) {
    return {
      stop: {
        ...stop,
        hotel: {
          ...(stop.hotel || {}),
          propertyIdentity: buildPropertyIdentity(stop.hotel || {}, { city: stop.city, country: stop.country }),
          providerVerification: {
            version: LIVE_PROVIDER_VERIFICATION_VERSION,
            status: 'missing-destination-or-stay-dates',
            critical: true,
            verified: false,
            checkIn,
            checkOut
          }
        }
      },
      outcome: 'missing-input'
    };
  }

  const stay22Promise = stay22EvidenceEnabled682B()
    ? fetchStay22Evidence({
        address: [destination.city || stop.city, destination.country || stop.country].filter(Boolean).join(', '),
        city: destination.city || stop.city || null,
        country: destination.country || stop.country || null,
        checkIn,
        checkOut,
        adults: party.adults,
        children: party.children,
        rooms: party.rooms,
        currency,
        targetProperty: selectedPropertyName,
        targetIdentity: selectedPropertyIdentity
      }, process.env, { _fetchFn: options._stay22FetchFn })
      .catch(error => ({ enabled: true, version: STAY22_EVIDENCE_VERSION_682B, status: 'provider-error', error: error.message, productionEligible: false }))
    : Promise.resolve({ enabled: false, version: STAY22_EVIDENCE_VERSION_682B, status: 'feature-disabled', productionEligible: false });

  const agodaPromise = destination?.agodaCityId
    ? fetchAgodaStayEstimate({
        destination,
        nights,
        month: checkIn,
        currency,
        hotelStyle: query.hotelStyle || query.stayStyle || '',
        adults: party.adults,
        children: party.children,
        rooms: party.rooms,
        _fetchFn: options._agodaFetchFn || options._fetchFn
      }).catch(error => ({ source: 'provider-error', error: error.message }))
    : Promise.resolve({ source: 'provider-unavailable', error: 'missing-agoda-mapping' });

  const [stay22Evidence, stay] = await Promise.all([stay22Promise, agodaPromise]);
  const stay22Match = stay22Evidence?.exactPropertyMatch || null;
  const stay22CanApply = Boolean(
    stay22Match
    && stay22Evidence?.productionEligible === true
    && stay22Evidence?.exactStayDates === true
    && Number(stay22Match.totalUsd || 0) > 0
    && stay22Evidence?.propertyMatchDecision?.matched === true
    && Number(stay22Evidence?.propertyMatchDecision?.score || 0) >= Number(stay22Evidence?.matchThreshold || 0.9)
  );

  // 682B safety rule: a city-wide Stay22 alternative is evidence about the city stay
  // market only. It never replaces the selected hotel's price. Only a strong same-
  // property match with explicit production approval can alter the selected stay total.
  if (stay22CanApply) {
    const totalStayUsd = Number(stay22Match.totalUsd);
    const observedAt = stay22Evidence.observedAt || new Date().toISOString();
    const existingHotel = { ...(stop.hotel || {}) };
    const hotel = {
      ...existingHotel,
      name: existingHotel.name || selectedPropertyName || stay22Match.propertyName || `${stop.city || 'Destination'} stay`,
      hotelName: existingHotel.hotelName || selectedPropertyName || stay22Match.propertyName || null,
      estimatedNightlyUsd: Number((totalStayUsd / nights).toFixed(2)),
      averageNightlyUsd: Number((totalStayUsd / nights).toFixed(2)),
      estimatedStayUsd: totalStayUsd,
      totalStayUsd,
      providerBacked: true,
      livePriceVerified: false,
      propertyIdentity: { ...selectedPropertyIdentity, matchedStay22PropertyId: stay22Match.propertyId || null, matchedStay22PropertyName: stay22Match.propertyName || null, matchDecision: stay22Evidence.propertyMatchDecision || null },
      stay22Evidence,
      stay22RateEvidence: {
        version: STAY22_EVIDENCE_VERSION_682B,
        sourceClass: stay22Evidence.sourceClass,
        evidenceRole: 'same-property-rate',
        supplier: stay22Match.supplier,
        propertyName: stay22Match.propertyName,
        propertyId: stay22Match.propertyId,
        total: stay22Match.total,
        currency: stay22Match.currency,
        totalUsd: totalStayUsd,
        checkIn,
        checkOut,
        observedAt,
        providerCache: stay22Match.providerCache || stay22Evidence.providerCache || null,
        clientCacheHit: stay22Match.clientCacheHit === true || stay22Evidence?.cache?.hit === true,
        targetNameScore: stay22Match.targetNameScore,
        finalPriceRequiresPartnerConfirmation: true,
        availabilityConfirmed: false,
        bookingHandoffUnchanged: true
      },
      providerVerification: {
        version: LIVE_PROVIDER_VERIFICATION_VERSION,
        status: 'stay22-same-property-exact-stay-rate',
        critical: true,
        verified: true,
        provider: 'Stay22',
        rateProvider: 'Stay22',
        rateEvidenceVersion: STAY22_EVIDENCE_VERSION_682B,
        handoffProvider: existingHotel?.providerHotel?.provider || existingHotel?.booking?.provider || 'Agoda',
        exactPropertyMatch: true,
        propertyIdentityVersion: PROPERTY_IDENTITY_VERSION_682C,
        propertyMatchBasis: stay22Evidence?.propertyMatchDecision?.basis || 'property-identity-hardened-match',
        propertyMatchScore: Number(stay22Evidence?.propertyMatchDecision?.score || 0),
        supplier: stay22Match.supplier || null,
        checkIn,
        checkOut,
        exactStayDates: true,
        checkedAt: new Date().toISOString(),
        observedAt,
        observedAgeSeconds: ageSeconds(observedAt),
        party: { adults: party.adults, children: party.children, rooms: party.rooms },
        productionEligible: true,
        sourceClass: stay22Evidence.sourceClass,
        providerResponseMode: stay22Evidence.mode || 'stay22-direct-travel-api',
        priceParityVerified: false,
        currentLandingPriceConfirmed: false,
        finalPriceRequiresPartnerConfirmation: true,
        availabilityConfirmed: false,
        isBookable: false,
        bookingHandoffUnchanged: true
      }
    };

    hotel.priceEvidence = normalizeHotelEvidence({
      amount: stay22Match.total,
      stayTotal: stay22Match.total,
      currency: stay22Match.currency || currency,
      city: destination.city || stop.city,
      propertyId: stay22Match.propertyId,
      propertyName: stay22Match.propertyName || selectedPropertyName,
      checkIn,
      checkOut,
      nights,
      rooms: party.rooms,
      source: 'Stay22 Direct Travel API',
      sourceType: SOURCE_TYPES.LIVE,
      observedAt,
      retrievedAt: new Date().toISOString(),
      amountBasis: 'full-stay-total',
      taxBasis: 'provider-response-unspecified',
      feeBasis: 'provider-response-unspecified'
    }, {
      city: destination.city || stop.city,
      checkIn,
      checkOut,
      nights,
      rooms: party.rooms,
      currency: stay22Match.currency || currency,
      sourceType: SOURCE_TYPES.LIVE
    });
    hotel.sourceType = hotel.priceEvidence.sourceType;
    hotel.evidenceId = hotel.priceEvidence.evidenceId;
    hotel.providerVerification.sourceType = hotel.priceEvidence.sourceType;
    hotel.providerVerification.evidenceId = hotel.priceEvidence.evidenceId;

    return { stop: { ...stop, hotel }, outcome: 'verified-stay22' };
  }

  const allowInjectedEvidence = String(process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION || '').trim().toLowerCase() === 'true';
  const productionEligible = stay?.providerResponseMode === 'live-agoda-api' || allowInjectedEvidence;
  const verified = stay?.source === 'agoda' && stay?.providerBacked === true && Number(stay.averageNightlyUsd || 0) > 0 && productionEligible;
  if (!verified) {
    return {
      stop: {
        ...stop,
        hotel: {
          ...(stop.hotel || {}),
          propertyIdentity: selectedPropertyIdentity,
          ...(stay22EvidenceEnabled682B() ? { stay22Evidence } : {}),
          providerVerification: {
            version: LIVE_PROVIDER_VERIFICATION_VERSION,
            status: stay?.error ? 'provider-error' : (stay?.providerResponseMode === 'injected-provider-response' ? 'test-only-provider-response-not-production-evidence' : 'no-exact-stay-rate'),
            critical: true,
            verified: false,
            provider: 'Agoda',
            checkIn,
            checkOut,
            checkedAt: new Date().toISOString(),
            party: { adults: party.adults, children: party.children, rooms: party.rooms },
            productionEligible: false,
            providerResponseMode: stay?.providerResponseMode || null,
            ...(stay22EvidenceEnabled682B() ? {
              stay22EvidenceVersion: STAY22_EVIDENCE_VERSION_682B,
              stay22Status: stay22Evidence?.status || null,
              stay22CityBenchmarkOnly: Boolean(stay22Evidence?.cityBenchmark && !stay22Evidence?.exactPropertyMatch)
            } : {})
          }
        }
      },
      outcome: 'not-verified'
    };
  }

  const hotel = {
    ...(stop.hotel || {}),
    ...stay,
    ...(stay22EvidenceEnabled682B() ? { stay22Evidence } : {}),
    name: stay.hotelName || stop?.hotel?.name || `${stop.city || 'Destination'} stay`,
    hotelName: stay.hotelName || stop?.hotel?.hotelName || null,
    estimatedNightlyUsd: Number(stay.averageNightlyUsd || 0),
    averageNightlyUsd: Number(stay.averageNightlyUsd || 0),
    estimatedStayUsd: Number(stay.totalStayUsd || 0),
    totalStayUsd: Number(stay.totalStayUsd || 0),
    source: 'agoda',
    livePriceVerified: false,
    providerBacked: true,
    ...(providerStayIntegration679AEnabled() && stay.providerHotel ? {
      providerHotel: stay.providerHotel,
      agodaHotelId: stay.providerHotel.hotelId || stay.hotelId || null,
      imageUrl: stay.providerHotel.imageUrl || stay.hotelImageUrl || null,
      hotelImageUrl: stay.providerHotel.imageUrl || stay.hotelImageUrl || null,
      bookingUrl: stay.providerHotel.bookingUrl || stay.hotelUrl || null,
      providerUrl: stay.providerHotel.bookingUrl || stay.hotelUrl || null,
      rating: stay.providerHotel.reviewScore ?? stay.reviewScore ?? stay.qualitySignals?.rating ?? null,
      reviewScore: stay.providerHotel.reviewScore ?? stay.reviewScore ?? stay.qualitySignals?.rating ?? null,
      reviewCount: stay.providerHotel.reviewCount ?? stay.reviewCount ?? stay.qualitySignals?.reviewCount ?? null,
      starRating: stay.providerHotel.starRating ?? stay.starRating ?? stay.qualitySignals?.stars ?? null
    } : {}),
    propertyIdentity: buildPropertyIdentity({ ...(stop.hotel || {}), ...stay, providerHotel: stay.providerHotel || stop?.hotel?.providerHotel }, { city: destination.city || stop.city, country: destination.country || stop.country }),
    providerVerification: {
      version: LIVE_PROVIDER_VERIFICATION_VERSION,
      status: priceLinkIntegrity679AR1Enabled() ? 'exact-date-provider-rate-observation' : 'exact-stay-provider-rate-evidence',
      critical: true,
      verified: true,
      provider: 'Agoda',
      ...(providerStayIntegration679AEnabled() ? { integrationVersion: AGODA_PROVIDER_STAY_VERSION_679A, hotelId: stay.providerHotel?.hotelId || stay.hotelId || null } : {}),
      ...(priceLinkIntegrity679AR1Enabled() ? {
        priceLinkIntegrityVersion: AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1,
        priceParityVerified: false,
        currentLandingPriceConfirmed: false,
        finalPriceRequiresPartnerConfirmation: true,
        bookingTrustVersion: BOOKING_TRUST_VERSION_680A,
        priceState: 'provider-rate-observed',
        currentPriceConfirmed: false,
        availabilityConfirmed: false,
        providerLinkType: stay.providerHotel?.linkType || 'provider-link-unverified',
        directPropertyLink: stay.providerHotel?.directPropertyLink === true
      } : {}),
      checkIn,
      checkOut,
      exactStayDates: true,
      checkedAt: new Date().toISOString(),
      observedAt: stay.observedAt || new Date().toISOString(),
      observedAgeSeconds: ageSeconds(stay.observedAt),
      party: { adults: party.adults, children: party.children, rooms: party.rooms },
      sampleSize: Number(stay.sampleSize || 0) || null,
      productionEligible: true,
      providerResponseMode: stay.providerResponseMode || 'live-agoda-api',
      ...(stay22EvidenceEnabled682B() ? {
        stay22EvidenceVersion: STAY22_EVIDENCE_VERSION_682B,
        stay22Status: stay22Evidence?.status || null,
        stay22CityBenchmarkOnly: Boolean(stay22Evidence?.cityBenchmark && !stay22Evidence?.exactPropertyMatch)
      } : {})
    }
  };

  hotel.priceEvidence = normalizeHotelEvidence({ ...hotel, sourceType: SOURCE_TYPES.LIVE, checkIn, checkOut, currency }, {
    cityId: destination.id || stop.cityId || null,
    checkIn,
    checkOut,
    currency,
    sourceType: SOURCE_TYPES.LIVE,
    source: 'Agoda',
    observedAt: stay.observedAt || new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    isBookable: false,
    isExactStay: true
  });
  hotel.sourceType = hotel.priceEvidence.sourceType;
  hotel.evidenceId = hotel.priceEvidence.evidenceId;
  hotel.providerVerification.sourceType = hotel.priceEvidence.sourceType;
  hotel.providerVerification.evidenceId = hotel.priceEvidence.evidenceId;
  hotel.providerVerification.isBookable = false;

  return { stop: { ...stop, hotel }, outcome: 'verified' };
}

function buildSummary({ flightResults, stayResults, pricedTour, query }) {
  const canonical = pricedTour?.canonicalPricing || null;
  const flightCritical = canonical
    ? canonical.components.filter(item => item.kind === 'flight' && item.evidence?.critical).length
    : flightResults.filter((item) => item.outcome !== 'ground-transfer').length;
  const flightVerified = canonical
    ? canonical.components.filter(item => item.kind === 'flight' && item.evidence?.verified).length
    : flightResults.filter((item) => item.outcome === 'verified').length;
  const transportCritical = canonical
    ? canonical.components.filter(item => ['ground-transfer', 'rail', 'bus', 'ferry', 'shuttle', 'origin-access', 'destination-access'].includes(item.kind) && item.evidence?.critical).length
    : flightResults.filter((item) => item.outcome === 'ground-transfer' && item.leg?.providerVerification?.critical).length;
  const transportVerified = canonical
    ? canonical.components.filter(item => ['ground-transfer', 'rail', 'bus', 'ferry', 'shuttle', 'origin-access', 'destination-access'].includes(item.kind) && item.evidence?.verified).length
    : 0;
  const stayCritical = canonical
    ? canonical.components.filter(item => item.kind === 'stay' && item.evidence?.critical).length
    : stayResults.length;
  const stayVerified = canonical
    ? canonical.components.filter(item => item.kind === 'stay' && item.evidence?.verified).length
    : stayResults.filter((item) => String(item.outcome || '').startsWith('verified')).length;
  const criticalCount = canonical ? canonical.criticalCount : flightCritical + transportCritical + stayCritical;
  const verifiedCount = canonical ? canonical.verifiedCount : flightVerified + transportVerified + stayVerified;
  const providerCoverage = criticalCount ? verifiedCount / criticalCount : 0;
  const enrichedAgodaStayCount = stayResults.filter(item => Boolean(item?.stop?.hotel?.providerHotel)).length;
  const stay22EvidenceCount = stayResults.filter(item => Boolean(item?.stop?.hotel?.stay22Evidence)).length;
  const stay22ExactMatchedCount = stayResults.filter(item => item?.stop?.hotel?.providerVerification?.rateProvider === 'Stay22' && item?.stop?.hotel?.providerVerification?.verified === true).length;
  const stay22CityBenchmarkCount = stayResults.filter(item => Boolean(item?.stop?.hotel?.stay22Evidence?.cityBenchmark) && item?.stop?.hotel?.providerVerification?.rateProvider !== 'Stay22').length;
  const ceilingUsd = budgetCeilingUsd(pricedTour, query);
  const estimateUsd = canonical ? canonical.canonicalTotalUsd : totalUsd(pricedTour);
  const overBudget = estimateUsd > ceilingUsd;
  const allCriticalVerified = criticalCount > 0 && verifiedCount === criticalCount;
  const priceParityVerifiedStayCount = stayResults.filter(item => item?.stop?.hotel?.providerVerification?.priceParityVerified === true).length;
  const agodaLandingParityGap = priceLinkIntegrity679AR1Enabled() && enrichedAgodaStayCount > 0 && priceParityVerifiedStayCount < enrichedAgodaStayCount;
  const budgetClaim = !overBudget && allCriticalVerified && !agodaLandingParityGap ? 'provider-backed-fit' : (!overBudget ? 'estimated-to-fit-budget' : 'over-budget-after-provider-verification');
  return {
    enabled: true,
    version: LIVE_PROVIDER_VERIFICATION_VERSION,
    canonicalIntegrityVersion: canonical?.version || null,
    checkedAt: new Date().toISOString(),
    flightCritical,
    flightVerified,
    transportCritical,
    transportVerified,
    stayCritical,
    stayVerified,
    criticalCount,
    verifiedCount,
    providerCoverage: Number(providerCoverage.toFixed(3)),
    allCriticalVerified,
    budgetClaim,
    estimatedTotalUsd: Math.round(estimateUsd),
    estimatedDisplayTotal: canonical?.canonicalDisplayTotal ?? null,
    visibleCardTotalUsd: canonical?.visibleCardTotalUsd ?? Math.round(estimateUsd),
    visibleCardDisplayTotal: canonical?.visibleCardDisplayTotal ?? null,
    totalsMatchVisibleCards: canonical ? canonical.totalsMatchVisibleCards === true : null,
    budgetCeilingUsd: Number.isFinite(ceilingUsd) ? Math.round(ceilingUsd) : null,
    overBudget,
    finalAvailabilityRequiresPartnerConfirmation: true,
    stay22Evidence: {
      enabled: stay22EvidenceEnabled682B(),
      version: STAY22_EVIDENCE_VERSION_682B,
      evidenceStayCount: stay22EvidenceCount,
      exactMatchedStayCount: stay22ExactMatchedCount,
      cityBenchmarkOnlyCount: stay22CityBenchmarkCount,
      bookingHandoffChanged: false,
      cityBenchmarkNeverReplacesSelectedProperty: true,
      finalAvailabilityRequiresPartnerConfirmation: true
    },
    agodaProviderStay: {
      enabled: providerStayIntegration679AEnabled(),
      version: AGODA_PROVIDER_STAY_VERSION_679A,
      priceLinkIntegrityEnabled: priceLinkIntegrity679AR1Enabled(),
      priceLinkIntegrityVersion: priceLinkIntegrity679AR1Enabled() ? AGODA_PRICE_LINK_INTEGRITY_VERSION_679A_R1 : null,
      handoffIntegrityEnabled: agodaHandoffIntegrity679AR2Enabled(),
      handoffIntegrityVersion: agodaHandoffIntegrity679AR2Enabled() ? AGODA_HANDOFF_INTEGRITY_VERSION_679A_R2 : null,
      enrichedStayCount: enrichedAgodaStayCount,
      verifiedStayCount: stayVerified,
      priceParityVerifiedStayCount,
      landingPriceParityComplete: enrichedAgodaStayCount > 0 ? !agodaLandingParityGap : null,
      finalAvailabilityRequiresPartnerConfirmation: true,
      finalPriceRequiresPartnerConfirmation: true
    },
    meaning: 'Evidence coverage and budget status are derived from the same final visible pricing ledger. Flights, rail, bus, ferry, gateway transfers and stays are critical when they contribute to the itinerary; only production-eligible exact evidence can support a provider-backed fit claim.'
  };
}

async function verifyTourWithLiveProviders(tour = {}, query = {}, options = {}) {
  if (!enabled()) {
    return {
      tour,
      summary: {
        enabled: false,
        version: LIVE_PROVIDER_VERIFICATION_VERSION,
        reason: 'feature-disabled',
        budgetClaim: 'estimated-to-fit-budget'
      }
    };
  }

  const maxFlightLegs = Math.max(1, Math.min(Number(process.env.GV_LIVE_667A_MAX_FLIGHT_LEGS || DEFAULT_MAX_FLIGHT_LEGS), 6));
  const maxStays = Math.max(1, Math.min(Number(process.env.GV_LIVE_667A_MAX_STAYS || DEFAULT_MAX_STAYS), 5));
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const stops = Array.isArray(tour.stops) ? tour.stops : [];

  const flightResults = await Promise.all(legs.map(async (leg, index) => {
    if (index >= maxFlightLegs && !isGroundLeg(leg)) {
      return {
        leg: {
          ...leg,
          providerVerification: {
            version: LIVE_PROVIDER_VERIFICATION_VERSION,
            status: 'verification-call-cap-reached',
            critical: true,
            verified: false
          }
        },
        outcome: 'not-verified'
      };
    }
    return verifyFlightLeg(leg, query, options);
  }));

  const stayResults = await Promise.all(stops.map(async (stop, index) => {
    if (index >= maxStays) {
      return {
        stop: {
          ...stop,
          hotel: {
            ...(stop.hotel || {}),
            providerVerification: {
              version: LIVE_PROVIDER_VERIFICATION_VERSION,
              status: 'verification-call-cap-reached',
              critical: true,
              verified: false
            }
          }
        },
        outcome: 'not-verified'
      };
    }
    return verifyStay(stop, query, options);
  }));

  const partyPricedTour = applyTravellerPricingToTour({
    ...tour,
    legs: flightResults.map((item) => item.leg),
    stops: stayResults.map((item) => item.stop)
  }, query);
  const verifiedTour = canonicalIntegrityEnabled() ? applyCanonicalIntegrity(partyPricedTour, query) : partyPricedTour;
  const summary = buildSummary({ flightResults, stayResults, pricedTour: verifiedTour, query });

  return {
    tour: {
      ...verifiedTour,
      liveProviderVerification: summary,
      affordabilityClaim: summary.budgetClaim,
      canonicalPricing: verifiedTour.canonicalPricing || null
    },
    summary
  };
}

module.exports = {
  LIVE_PROVIDER_VERIFICATION_VERSION,
  enabled,
  verifyTourWithLiveProviders,
  _internal: {
    safeDate,
    endpointCode,
    officialLegDate,
    exactObservation,
    freshnessLabel,
    existingDecisionGradeLiveEvidence683JR2,
    preserveExistingLiveDecisionGrade683JR2,
    budgetCeilingUsd,
    totalUsd,
    verifyFlightLeg,
    verifyStay,
    buildSummary,
    CANONICAL_INTEGRITY_VERSION
  }
};
