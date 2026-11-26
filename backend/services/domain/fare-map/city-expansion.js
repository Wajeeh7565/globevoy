'use strict';

const { catalogueMarkets } = require('../../providers/stays/nuitee/nuitee-market');

const FLAG = 'FARE_MAP_CITY_EXPANSION';
const stayMarketTypes = new Set(['exact-city-country', 'alias-city-country', 'coordinate-confirmed-market', 'fuzzy-city-country']);
// These country/territory codes currently fall through to "Other" in the base registry.
const regions = {
  BM: ['Americas', 'north-america'], CC: ['Oceania', 'oceania'], CX: ['Oceania', 'oceania'],
  CV: ['Africa', 'sub-saharan-africa'], FK: ['Americas', 'south-america'], FO: ['Europe', 'northern-europe'],
  IS: ['Europe', 'northern-europe'], KM: ['Africa', 'sub-saharan-africa'], MG: ['Africa', 'sub-saharan-africa'],
  MU: ['Africa', 'sub-saharan-africa'], MV: ['Asia', 'south-asia'], RE: ['Africa', 'sub-saharan-africa'],
  SC: ['Africa', 'sub-saharan-africa'], SH: ['Africa', 'sub-saharan-africa'], SJ: ['Europe', 'northern-europe'],
  TR: ['Asia', 'middle-east'], YT: ['Africa', 'sub-saharan-africa']
};
const iata = /^[A-Z]{3}$/;
const inconclusiveFlight = new Set(['flight-provider:no-live-observations', 'flight-provider:provider-error']);
const index = (rows, key) => new Map(rows.map(row => [row[key], row]));

function enabled(env) {
  return String(env?.[FLAG] || '').trim().toLowerCase() === 'on';
}

function check(city, catalogue, mapping, directCounts, nuiteeMarket, legacyAudit) {
  const reasons = [];
  const { origin, destination } = city;
  const { travelpayouts: flight, agoda: stay } = mapping || {};
  const regionsFromFoundation = legacyAudit && /^(northern|southern)-europe$/.test(destination.regionCluster)
    ? ['Europe', destination.regionCluster] : null;
  const correction = city.worldRegion === 'Other' && (regions[city.countryCode] || regionsFromFoundation);
  const metadata = correction ? { worldRegion: correction[0], regionCluster: correction[1] } : null;

  const trustedIds = catalogue?.trustedDestinationIds || [];
  const trusted = catalogue?.eligibilityStatus === 'trusted' && (trustedIds.includes(city.cityId) ||
    legacyAudit && trustedIds.includes(origin.providerLocationCode) && catalogue.canonicalCityName === city.displayName);
  const expandedLegacy = Boolean(legacyAudit && trusted);
  // Some foundation catalogue coordinates describe the airport. For this legacy
  // recovery, the validated city coordinates are corroborated by the hotel centroid.
  const corroboratedLegacyCenter = expandedLegacy && city.validation.coordinatesValidated === true &&
    Number.isFinite(stay?.distanceKm) && stay.distanceKm <= 25;
  const associatedCode = catalogue?.cityCode === origin.providerLocationCode ||
    expandedLegacy && catalogue?.flightableAirportCodes?.includes(origin.providerLocationCode);
  // The audit lists both GCN (Grand Canyon) and FLG (Flagstaff Pulliam). The fare
  // code is already FLG, so use that exact physical airport for Flagstaff pricing.
  const airportOverride = expandedLegacy && city.cityId === 'flagstaff-us' &&
    origin.providerLocationCode === 'FLG' && catalogue.flightableAirportCodes?.includes('FLG') &&
    flight?.physicalAirports?.some(airport => airport.code === 'FLG' && airport.countryCode === city.countryCode &&
      airport.flightable === true) ? 'FLG' : null;
  // Trusted foundation coordinates can describe the city centre rather than the provider
  // reference point. Other registry coordinates are rounded to six decimal places.
  const coordinateTolerance = trusted ? 0.15 : 0.000001;
  if (!catalogue || (!trusted && catalogue.eligibilityStatus !== 'eligible') || catalogue.countryCode !== city.countryCode ||
      !associatedCode || !catalogue.flightableAirportCodes?.includes(origin.preferredAirportCode) ||
      !Number.isFinite(catalogue.latitude) || !Number.isFinite(catalogue.longitude) ||
      !corroboratedLegacyCenter && (Math.abs(catalogue.latitude - city.latitude) > coordinateTolerance ||
        Math.abs(catalogue.longitude - city.longitude) > coordinateTolerance) ||
      catalogue.timeZone !== city.timeZone ||
      !Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90 ||
      !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180 ||
      !city.displayName?.trim() || !city.country?.trim() || !/^[A-Z]{2}$/.test(city.countryCode) || !city.timeZone ||
      !city.worldRegion || city.worldRegion === 'Other' && !metadata ||
      !Number.isInteger(destination.minimumRecommendedNights) || !Number.isInteger(destination.maximumRecommendedNights) ||
      destination.minimumRecommendedNights < 2 || destination.maximumRecommendedNights < destination.minimumRecommendedNights) {
    reasons.push('catalogue-metadata-unresolved');
  }
  if (origin.eligible !== true || mapping?.countryCode !== city.countryCode || !flight?.mappingAccepted || !flight.staticFlightable ||
      !flight.countryConsistent || flight.gateway || !iata.test(origin.providerLocationCode) ||
      flight.locationCode !== origin.providerLocationCode || flight.preferredAirportCode !== origin.preferredAirportCode ||
      !flight.physicalAirports?.some(airport => airport.code === origin.preferredAirportCode &&
        airport.countryCode === city.countryCode && airport.flightable === true)) {
    reasons.push('direct-provider-airport-unresolved');
  }
  if (directCounts.get(origin.providerLocationCode) > 1) reasons.push('ambiguous-direct-fare-code');
  if (legacyAudit) {
    if (!inconclusiveFlight.has(legacyAudit.activation?.reason)) {
      const auditedReasons = legacyAudit.recommendationReadiness?.reasons;
      reasons.push(...(auditedReasons?.length ? auditedReasons : [legacyAudit.activation?.reason || 'legacy-audit-unresolved']));
    } else {
      const hotel = legacyAudit.evidence?.agoda;
      if (!stay?.mappingAccepted || !/^inherited-(exact|validated)$/.test(stay.mappingType) ||
          hotel?.evidenceMode !== 'production-provider-response' || hotel.agodaCityId !== stay.cityId ||
          !hotel.providerMappingVerified || !hotel.inventoryObserved || !hotel.qualityQualifiedRate) {
        reasons.push('legacy-hotel-audit-unresolved');
      }
      if (!Number.isFinite(stay?.distanceKm) || stay.distanceKm > 25) reasons.push('legacy-hotel-centroid-outside-market');
    }
  } else if (!nuiteeMarket) {
    if (!stay?.mappingAccepted || !(stay.cityId > 0 && stay.hotelCount > 0)) reasons.push('hotel-market-unresolved');
    else if (!stayMarketTypes.has(stay.mappingType)) reasons.push('hotel-market-outside-destination');
  }

  return {
    cityId: city.cityId, city: city.displayName, countryCode: city.countryCode,
    code: origin.providerLocationCode, airport: origin.preferredAirportCode, airportOverride,
    hotelMapping: stay?.mappingType || null, nuiteeMarket: nuiteeMarket || null, reasons, metadata
  };
}

const packagedReview = new Map();
function reviewExpansion(evidence = require('../../../data/nuitee-city-catalogue-evidence.json'), { includeLegacyRecovery = false } = {}) {
  const packaged = evidence === require('../../../data/nuitee-city-catalogue-evidence.json');
  if (packaged && packagedReview.has(includeLegacyRecovery)) return packagedReview.get(includeLegacyRecovery);
  const base = require('../../../data/unified-city-registry-1000.json').records;
  const catalogue = index(require('../../../data/global-destination-catalogue.json').destinations, 'catalogueId');
  const mappings = index(require('../../../data/provider-mappings-1000-668b.json').records, 'cityId');
  const directCounts = new Map();
  for (const { origin } of base) {
    if (!origin.requiresGatewayTransfer) {
      const code = origin.providerLocationCode;
      directCounts.set(code, (directCounts.get(code) || 0) + 1);
    }
  }
  const markets = catalogueMarkets(evidence, base);
  const audits = includeLegacyRecovery
    ? index(require('../../../data/verified-city-activation-1000-668t.json').records, 'cityId') : null;
  const decisions = new Map();
  for (const city of base) {
    if (!city.destination.eligible || city.origin.requiresGatewayTransfer) continue;
    const legacyAudit = city.validation.bothProvidersMapped ? audits?.get(city.cityId) : null;
    if (city.validation.bothProvidersMapped && (!legacyAudit || legacyAudit.liveRecommendationEligible)) continue;
    decisions.set(city.cityId, check(city, catalogue.get(city.catalogueId), mappings.get(city.cityId),
      directCounts, markets.get(city.cityId), legacyAudit));
  }
  if (packaged) packagedReview.set(includeLegacyRecovery, decisions);
  return decisions;
}

function admit(row, review) {
  const city = row.unifiedRegistry;
  const decision = review.get(city?.cityId);
  if (!decision || decision.reasons.length || decision.countryCode !== city.countryCode ||
      decision.code !== city.origin?.providerLocationCode || decision.airport !== city.origin?.preferredAirportCode ||
      decision.city !== row.canonicalCityName || row.countryCode !== decision.countryCode ||
      row.primaryAirportCode !== decision.airport) return null;
  const { metadata, airportOverride } = decision;
  // Historical hotel records admit candidates. The production adapters verify each trip.
  return {
    ...row,
    ...(airportOverride ? { primaryAirportCode: airportOverride, flightableAirportCodes: [airportOverride] } : {}),
    expansionCandidate: true,
    nuiteeMarket: decision.nuiteeMarket,
    unifiedRegistry: metadata ? {
      ...city, worldRegion: metadata.worldRegion, destination: { ...city.destination, regionCluster: metadata.regionCluster }
    } : city
  };
}

module.exports = { FLAG, enabled, reviewExpansion, admit };
