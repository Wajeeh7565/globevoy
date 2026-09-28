'use strict';

// GV-PROVIDER-682C — selected-property identity preservation and cross-provider match hardening.
// This module never books or substitutes a different property. It only records identity
// evidence and decides whether a Stay22 result is safe to treat as the selected property.

const PROPERTY_IDENTITY_VERSION_682C = 'GV-PROVIDER-682C';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(the|hotel|hotels|inn|resort|apartments?|aparthotel)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function genericPropertyName(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length < 4) return true;
  const genericFragments = [
    'central value stay', 'value stay', 'destination stay', 'central stay',
    'recommended stay', 'stay estimate', 'hotel estimate', 'city stay',
    'budget stay', 'comfortable stay', 'selected stay', 'accommodation estimate'
  ];
  return genericFragments.some(fragment => normalized === fragment || normalized.includes(fragment));
}

function cleanId(value) {
  const id = String(value || '').trim();
  return id && id.length <= 160 ? id : null;
}

function providerRefsFromHotel(hotel = {}) {
  const refs = [];
  const seen = new Set();
  function add(provider, id, source) {
    const pid = cleanId(id);
    if (!pid) return;
    const p = String(provider || 'unknown').trim().toLowerCase();
    const key = `${p}:${pid}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ provider: p, id: pid, source: source || null });
  }
  add(hotel?.providerHotel?.provider || 'agoda', hotel?.providerHotel?.hotelId, 'providerHotel.hotelId');
  add('agoda', hotel?.agodaHotelId, 'agodaHotelId');
  add(hotel?.provider || 'unknown', hotel?.hotelId, 'hotelId');
  add('stay22', hotel?.stay22RateEvidence?.propertyId, 'stay22RateEvidence.propertyId');
  if (hotel?.propertyIdentity?.providerRefs) {
    for (const ref of hotel.propertyIdentity.providerRefs) add(ref?.provider, ref?.id, ref?.source || 'preserved');
  }
  return refs;
}

function selectedPropertyName(hotel = {}) {
  return hotel?.providerHotel?.hotelName || hotel?.hotelName || hotel?.name || hotel?.propertyIdentity?.canonicalName || null;
}

function buildPropertyIdentity(hotel = {}, context = {}) {
  const name = selectedPropertyName(hotel);
  const normalizedName = normalizeText(name);
  const generic = genericPropertyName(name);
  const city = String(context.city || hotel?.city || hotel?.providerHotel?.city || '').trim() || null;
  const country = String(context.country || hotel?.country || hotel?.providerHotel?.country || '').trim() || null;
  const refs = providerRefsFromHotel(hotel);
  return {
    version: PROPERTY_IDENTITY_VERSION_682C,
    status: !name ? 'missing' : (generic ? 'generic-placeholder' : 'specific-property'),
    canonicalName: name ? String(name).trim() : null,
    normalizedName: normalizedName || null,
    city,
    country,
    providerRefs: refs,
    providerRefCount: refs.length,
    safeForTargetedProviderSearch: Boolean(name && !generic && normalizedName.length >= 4),
    source: hotel?.providerHotel?.hotelName ? 'provider-hotel' : (hotel?.hotelName ? 'hotelName' : (hotel?.name ? 'name' : 'unknown'))
  };
}

function tokenScore(a, b) {
  const at = new Set(normalizeText(a).split(' ').filter(Boolean));
  const bt = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (!at.size || !bt.size) return 0;
  let intersection = 0;
  for (const token of at) if (bt.has(token)) intersection += 1;
  const union = new Set([...at, ...bt]).size;
  const targetCoverage = intersection / bt.size;
  const candidateCoverage = intersection / at.size;
  const jaccard = intersection / union;
  return Number((jaccard * 0.40 + targetCoverage * 0.35 + candidateCoverage * 0.25).toFixed(4));
}

function nameScore(candidateName, identity = {}) {
  const a = normalizeText(candidateName);
  const b = String(identity.normalizedName || normalizeText(identity.canonicalName)).trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  return tokenScore(a, b);
}

function locationScore(row = {}, identity = {}) {
  const address = normalizeText(row.address || '');
  const city = normalizeText(identity.city || '');
  const country = normalizeText(identity.country || '');
  let score = 0;
  let checks = 0;
  if (city && address) { checks += 1; score += address.includes(city) ? 1 : 0; }
  if (country && address) { checks += 1; score += address.includes(country) ? 1 : 0; }
  return checks ? Number((score / checks).toFixed(4)) : null;
}

function sameProviderId(row = {}, identity = {}) {
  const refs = Array.isArray(identity.providerRefs) ? identity.providerRefs : [];
  for (const ref of refs) {
    const provider = String(ref?.provider || '').toLowerCase();
    const id = cleanId(ref?.id);
    if (!id) continue;
    if (provider === 'stay22' && cleanId(row.propertyId) === id) return { matched: true, basis: 'stay22-property-id' };
    if (provider === String(row.supplier || '').toLowerCase() && cleanId(row.supplierPropertyId) === id) return { matched: true, basis: 'supplier-property-id' };
  }
  return { matched: false, basis: null };
}

function evaluateRowMatch(row = {}, identity = {}, options = {}) {
  if (!identity || identity.safeForTargetedProviderSearch !== true) {
    return { eligible: false, score: 0, basis: 'identity-not-specific', nameScore: 0, locationScore: null, idMatch: false };
  }
  const id = sameProviderId(row, identity);
  if (id.matched) return { eligible: true, score: 1, basis: id.basis, nameScore: 1, locationScore: locationScore(row, identity), idMatch: true };

  const n = nameScore(row.propertyName, identity);
  const l = locationScore(row, identity);
  const exactNormalizedName = normalizeText(row.propertyName) === identity.normalizedName;
  const nameThreshold = Number.isFinite(Number(options.nameThreshold)) ? Number(options.nameThreshold) : 0.90;
  const addressNorm = normalizeText(row.address || '');
  const cityNorm = normalizeText(identity.city || '');
  const countryNorm = normalizeText(identity.country || '');
  const cityPass = !(cityNorm && addressNorm) || addressNorm.includes(cityNorm);
  const countryPass = !(countryNorm && addressNorm) || addressNorm.includes(countryNorm);
  const locationPass = cityPass && countryPass;
  const eligible = locationPass && (exactNormalizedName || n >= nameThreshold);
  // Exact normalized name stays strongest. Fuzzy matches lose a little confidence when location is unavailable.
  const score = exactNormalizedName ? 0.995 : Number((n * (l === null ? 0.96 : (0.90 + 0.10 * l))).toFixed(4));
  return { eligible, score, basis: exactNormalizedName ? 'normalized-name-exact' : 'normalized-name-plus-location', nameScore: n, locationScore: l, idMatch: false };
}

function chooseConfidentMatch(rows = [], identity = {}, options = {}) {
  const evaluated = rows.map(row => ({ row, match: evaluateRowMatch(row, identity, options) }))
    .filter(item => item.match.eligible)
    .sort((a, b) => b.match.score - a.match.score || Number(a.row.total || 0) - Number(b.row.total || 0));
  if (!evaluated.length) return { row: null, decision: { matched: false, reason: 'no-confident-property-match', identity } };

  const top = evaluated[0];
  const topName = normalizeText(top.row.propertyName);
  const secondDistinct = evaluated.find(item => normalizeText(item.row.propertyName) !== topName);
  const ambiguityMargin = Number.isFinite(Number(options.ambiguityMargin)) ? Number(options.ambiguityMargin) : 0.02;
  if (!top.match.idMatch && secondDistinct && (top.match.score - secondDistinct.match.score) < ambiguityMargin) {
    return {
      row: null,
      decision: {
        matched: false,
        reason: 'ambiguous-property-match',
        identity,
        topCandidate: { propertyName: top.row.propertyName, score: top.match.score },
        secondCandidate: { propertyName: secondDistinct.row.propertyName, score: secondDistinct.match.score }
      }
    };
  }
  return {
    row: { ...top.row, propertyIdentityMatch: top.match },
    decision: {
      matched: true,
      reason: 'confident-property-match',
      identity,
      basis: top.match.basis,
      score: top.match.score,
      nameScore: top.match.nameScore,
      locationScore: top.match.locationScore,
      idMatch: top.match.idMatch,
      matchedPropertyId: top.row.propertyId || null,
      matchedSupplierPropertyId: top.row.supplierPropertyId || null,
      matchedPropertyName: top.row.propertyName || null
    }
  };
}

module.exports = {
  PROPERTY_IDENTITY_VERSION_682C,
  normalizeText,
  genericPropertyName,
  providerRefsFromHotel,
  selectedPropertyName,
  buildPropertyIdentity,
  nameScore,
  locationScore,
  sameProviderId,
  evaluateRowMatch,
  chooseConfidentMatch
};
