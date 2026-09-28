'use strict';

const ENTRY_ELIGIBILITY_VERSION = 'GV-ENTRY-675A';
const US_RULE_EFFECTIVE_DATE = '2026-01-01';
const US_RULE_REVIEWED_AT = '2026-07-29';
const US_RULE_SOURCE = 'https://travel.state.gov/content/travel/en/News/visas-news/suspension-of-visa-issuance-to-foreign-nationals-to-protect-the-security-of-the-united-states.html';
const IATA_TRAVEL_CENTRE = 'https://www.iata.org/en/travel-centre/';
const SHERPA_TRAVEL_REQUIREMENTS = 'https://apply.joinsherpa.com/travel-restrictions';

// Presidential Proclamation 10998 lists, effective 2026-01-01.
const US_FULL_SUSPENSION = new Set([
  'AF','MM','BF','TD','CG','GQ','ER','HT','IR','LA','LY','ML','NE','SL','SO','SS','SD','SY','YE','PS'
]);
const US_PARTIAL_TOURIST_SUSPENSION = new Set([
  'AO','AG','BJ','BI','CI','CU','DM','GA','GM','MW','MR','NG','SN','TZ','TG','TO','VE','ZM','ZW'
]);

function cleanCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  return ['1','true','yes','on'].includes(String(value || '').trim().toLowerCase());
}

function cleanText(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function safeHttpsUrl(value) {
  const url = cleanText(value, 700);
  return /^https:\/\//i.test(url) ? url : '';
}

function profileFrom(input = {}) {
  return {
    passportCountryCode: cleanCode(input.passportCountryCode || input.passport || input.nationality),
    passportCountry: cleanText(input.passportCountry || input.passportName),
    secondPassportCountryCode: cleanCode(input.secondPassportCountryCode || input.secondPassport),
    secondPassportCountry: cleanText(input.secondPassportCountry || input.secondPassportName),
    useSecondPassportForTrip: bool(input.useSecondPassportForTrip || input.travelOnSecondPassport),
    residenceCountryCode: cleanCode(input.residenceCountryCode || input.residence),
    residenceCountry: cleanText(input.residenceCountry || input.residenceName),
    entryAware: input.entryAware === undefined ? true : bool(input.entryAware),
    validUsVisaOn20260101: bool(input.validUsVisaOn20260101 || input.validUsVisaBefore2026 || input.usVisaProtectedByPP10998),
    usLawfulPermanentResident: bool(input.usLawfulPermanentResident || input.usLpr || input.greenCardHolder),
    purpose: cleanText(input.purpose || 'tourism', 40).toLowerCase()
  };
}

function profileFromQuery(query = {}) {
  return profileFrom({
    ...query,
    entryAware: query.entryProfile === undefined ? query.entryAware : query.entryProfile,
    validUsVisaOn20260101: query.validUsVisaOn20260101,
    usLawfulPermanentResident: query.usLawfulPermanentResident
  });
}

function nodeFrom(value = {}, kind = 'destination', index = 0) {
  return {
    kind,
    index,
    city: cleanText(value.city || value.displayName || value.name || value.destinationCity || 'Destination'),
    country: cleanText(value.country || value.countryName || ''),
    countryCode: cleanCode(value.countryCode || value.iso2 || value.destinationCountryCode),
    airportCode: cleanText(value.airportCode || value.code || value.displayCode || '', 8).toUpperCase()
  };
}

function itineraryFromTour(tour = {}) {
  const origin = nodeFrom(tour.origin || {}, 'origin', 0);
  const stops = (Array.isArray(tour.cities) ? tour.cities : (Array.isArray(tour.stops) ? tour.stops : []))
    .map((stop, index) => nodeFrom(stop, 'destination', index + 1));
  return { origin, stops };
}

function normalizeItinerary(input = {}) {
  if (input.tour) return itineraryFromTour(input.tour);
  if (input.itinerary && !Array.isArray(input.itinerary)) {
    const origin = nodeFrom(input.itinerary.origin || {}, 'origin', 0);
    const rawStops = input.itinerary.stops || input.itinerary.destinations || [];
    return { origin, stops: (Array.isArray(rawStops) ? rawStops : []).map((s, i) => nodeFrom(s, 'destination', i + 1)) };
  }
  const raw = Array.isArray(input.itinerary) ? input.itinerary : [];
  const originItem = raw.find(x => String(x?.kind || '').toLowerCase() === 'origin') || input.origin || {};
  const stops = raw.filter(x => String(x?.kind || '').toLowerCase() !== 'origin');
  return { origin: nodeFrom(originItem, 'origin', 0), stops: stops.map((s, i) => nodeFrom(s, 'destination', i + 1)) };
}

function travelPassportCode(profile) {
  return profile.useSecondPassportForTrip && profile.secondPassportCountryCode
    ? profile.secondPassportCountryCode
    : profile.passportCountryCode;
}

function alternatePassportAvoidsUsSuspension(profile) {
  const second = profile.secondPassportCountryCode;
  return Boolean(profile.useSecondPassportForTrip && second && !US_FULL_SUSPENSION.has(second) && !US_PARTIAL_TOURIST_SUSPENSION.has(second));
}

function usCheck(profile, destination) {
  const primary = profile.passportCountryCode;
  const travelPassport = travelPassportCode(profile);
  const alternate = alternatePassportAvoidsUsSuspension(profile);
  const exception = profile.usLawfulPermanentResident || profile.validUsVisaOn20260101 || alternate;
  const base = {
    ...destination,
    source: {
      title: 'U.S. Department of State — Presidential Proclamation 10998 guidance',
      url: US_RULE_SOURCE,
      lastOfficialUpdate: '2026-02-02',
      effectiveDate: US_RULE_EFFECTIVE_DATE,
      implementationReviewedAt: US_RULE_REVIEWED_AT
    }
  };

  if (!travelPassport) {
    return {
      ...base,
      status: 'profile-required',
      label: 'Passport profile required',
      hardBlock: false,
      action: 'Add the passport nationality that will be used for this trip.'
    };
  }

  if (US_FULL_SUSPENSION.has(travelPassport)) {
    if (exception) {
      const reason = profile.usLawfulPermanentResident
        ? 'The profile says the traveller is a U.S. lawful permanent resident.'
        : profile.validUsVisaOn20260101
          ? 'The profile says the traveller held a valid U.S. visa at the proclamation effective time.'
          : 'A second passport not listed in the suspension may provide a dual-national exception.';
      return {
        ...base,
        status: 'exception-check-required',
        label: 'U.S. exception or existing document must be verified',
        hardBlock: false,
        action: `${reason} Confirm the document is still valid and confirm admissibility with the airline and U.S. authorities before purchase.`
      };
    }
    return {
      ...base,
      status: 'not-currently-eligible',
      label: 'U.S. tourist entry is currently restricted',
      hardBlock: true,
      action: 'Do not continue to partner booking for this route unless the traveller qualifies for an official exception or already holds a protected valid visa.'
    };
  }

  if (US_PARTIAL_TOURIST_SUSPENSION.has(travelPassport)) {
    if (exception) {
      return {
        ...base,
        status: 'exception-check-required',
        label: 'Existing document or exception must be verified',
        hardBlock: false,
        action: 'Tourist visa issuance is partially suspended for this nationality, but the profile indicates a possible exception or pre-existing document. Verify before purchase.'
      };
    }
    return {
      ...base,
      status: 'visa-issuance-restricted',
      label: 'U.S. tourist visa issuance is currently restricted',
      hardBlock: true,
      action: 'A normal new B-1/B-2 tourist visa may not be issuable under the current proclamation. Choose another route or verify an official exception.'
    };
  }

  return {
    ...base,
    status: 'verification-required',
    label: 'U.S. entry document check required',
    hardBlock: false,
    action: 'Verify whether a visa, visa waiver, ESTA, passport-validity rule or other document applies before purchase.'
  };
}

function genericCheck(profile, destination) {
  const passportCode = travelPassportCode(profile);
  const sameNationality = passportCode && passportCode === destination.countryCode;
  if (!passportCode) {
    return {
      ...destination,
      status: 'profile-required',
      label: 'Passport profile required',
      hardBlock: false,
      action: 'Add passport nationality and residence to receive a personalized entry checkpoint.'
    };
  }
  if (sameNationality) {
    return {
      ...destination,
      status: 'citizen-document-check',
      label: 'Citizen document check',
      hardBlock: false,
      action: 'A visa is normally not the main issue for a citizen returning to their country, but passport validity and airline document rules must still be checked.'
    };
  }
  return {
    ...destination,
    status: 'verification-required',
    label: 'Live visa or travel-authorization check required',
    hardBlock: false,
    action: 'The current Globevoy package does not guess whether this is visa-free, eVisa, eTA/ETA or visa-required. Verify with a live authoritative provider before purchase.'
  };
}

function staticEligibility(input = {}) {
  const profile = profileFrom(input.profile || input);
  const itinerary = normalizeItinerary(input);
  const checks = itinerary.stops.map(stop => stop.countryCode === 'US' ? usCheck(profile, stop) : genericCheck(profile, stop));
  const hardBlocked = checks.some(check => check.hardBlock);
  const exceptionChecks = checks.filter(check => check.status === 'exception-check-required').length;
  const profileComplete = Boolean(profile.passportCountryCode && profile.residenceCountryCode);
  let overallStatus = 'verification-required';
  // Current authoritative hard blocks cannot be bypassed by disabling personalization.
  if (hardBlocked) overallStatus = 'blocked';
  else if (!profile.entryAware) overallStatus = 'entry-check-disabled';
  else if (!profileComplete) overallStatus = 'profile-required';
  else if (exceptionChecks) overallStatus = 'exception-check-required';

  const filteredCount = checks.filter(check => check.hardBlock).length;
  const summary = overallStatus === 'blocked'
    ? `${filteredCount} destination ${filteredCount === 1 ? 'is' : 'are'} blocked by a current authoritative entry guardrail for this passport profile.`
    : overallStatus === 'profile-required'
      ? 'Add passport nationality and residence to check destination and transit requirements.'
      : overallStatus === 'entry-check-disabled'
        ? 'Entry-aware recommendations are disabled in this browser profile.'
        : exceptionChecks
          ? 'A possible exception or existing document must be verified before booking.'
          : 'No hard restriction was found by the limited built-in guardrails. Live visa, eVisa, ETA and transit verification is still required.';

  return {
    ok: true,
    supported: true,
    version: ENTRY_ELIGIBILITY_VERSION,
    checkedAt: new Date().toISOString(),
    profile: {
      passportCountryCode: profile.passportCountryCode,
      passportCountry: profile.passportCountry,
      secondPassportCountryCode: profile.secondPassportCountryCode,
      secondPassportCountry: profile.secondPassportCountry,
      useSecondPassportForTrip: profile.useSecondPassportForTrip,
      travelPassportCountryCode: travelPassportCode(profile),
      residenceCountryCode: profile.residenceCountryCode,
      residenceCountry: profile.residenceCountry,
      entryAware: profile.entryAware,
      validUsVisaOn20260101: profile.validUsVisaOn20260101,
      usLawfulPermanentResident: profile.usLawfulPermanentResident
    },
    itinerary,
    profileComplete,
    overallStatus,
    hardBlocked,
    recommendationEligible: !hardBlocked,
    summary,
    checks,
    transit: {
      status: 'unknown-until-flight-selected',
      label: 'Transit check required after flight selection',
      hardBlock: false,
      action: 'Partner comparison results may use connecting airports that are not known during route discovery. Re-check every connection country before payment.'
    },
    policyMaintenance: {
      builtInGuardrail: 'U.S. PP 10998',
      reviewedAt: US_RULE_REVIEWED_AT,
      recheckRequiredBeforeEachProductionRelease: true
    },
    provider: {
      live: false,
      mode: 'authoritative-guardrails+provider-ready',
      reason: process.env.GV_ENTRY_PROVIDER_URL ? 'configured-provider-not-yet-called' : 'live-provider-not-configured'
    },
    sources: [
      { title: 'U.S. Department of State — PP 10998 guidance', url: US_RULE_SOURCE },
      { title: 'IATA Travel Centre', url: IATA_TRAVEL_CENTRE },
      { title: 'Sherpa travel requirements', url: SHERPA_TRAVEL_REQUIREMENTS }
    ],
    disclaimer: 'Travel rules change frequently. This checkpoint is not legal advice and is not permission to board or enter a country. Airlines and border authorities make the final decision.'
  };
}

function mergeProviderResult(base, providerResult) {
  if (!providerResult || !Array.isArray(providerResult.checks)) return base;
  const normalized = providerResult.checks.map((check, index) => ({
    kind: cleanText(check.kind || 'destination', 30),
    index,
    city: cleanText(check.city || 'Destination'),
    country: cleanText(check.country || ''),
    countryCode: cleanCode(check.countryCode),
    airportCode: cleanText(check.airportCode || '', 8).toUpperCase(),
    status: cleanText(check.status || 'verification-required', 50),
    label: cleanText(check.label || 'Travel requirement check', 120),
    hardBlock: bool(check.hardBlock),
    action: cleanText(check.action || check.message || 'Verify requirements before purchase.', 500),
    source: check.source && typeof check.source === 'object' && safeHttpsUrl(check.source.url)
      ? { title: cleanText(check.source.title || 'Official source', 140), url: safeHttpsUrl(check.source.url) }
      : undefined
  }));
  const hardBlocked = normalized.some(check => check.hardBlock);
  return {
    ...base,
    overallStatus: hardBlocked ? 'blocked' : cleanText(providerResult.overallStatus || 'provider-verified', 50),
    hardBlocked,
    recommendationEligible: !hardBlocked,
    summary: cleanText(providerResult.summary || base.summary, 500),
    checks: normalized,
    transit: providerResult.transit || base.transit,
    provider: {
      live: true,
      mode: cleanText(providerResult.provider?.mode || 'configured-normalized-provider', 80),
      name: cleanText(providerResult.provider?.name || 'Travel requirements provider', 100),
      checkedAt: providerResult.provider?.checkedAt || new Date().toISOString()
    }
  };
}

async function callConfiguredProvider(input, base) {
  const url = String(process.env.GV_ENTRY_PROVIDER_URL || '').trim();
  if (!/^https:\/\//i.test(url)) return base;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(Number(process.env.GV_ENTRY_PROVIDER_TIMEOUT_MS || 6500), 15000)));
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const token = String(process.env.GV_ENTRY_PROVIDER_TOKEN || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: ENTRY_ELIGIBILITY_VERSION,
        profile: base.profile,
        itinerary: base.itinerary,
        purpose: cleanText(input.purpose || input.profile?.purpose || 'tourism', 40),
        travelDate: cleanText(input.travelDate || '', 20)
      }),
      signal: controller.signal
    });
    if (!response.ok) return { ...base, provider: { live: false, mode: 'configured-provider-error', statusCode: response.status } };
    const payload = await response.json();
    return mergeProviderResult(base, payload);
  } catch (error) {
    return { ...base, provider: { live: false, mode: 'configured-provider-error', reason: error?.name === 'AbortError' ? 'timeout' : 'request-failed' } };
  } finally {
    clearTimeout(timer);
  }
}

async function evaluateTravelEntryEligibility(input = {}) {
  const base = staticEligibility(input);
  if (input.allowProvider === false) return base;
  // A configured licensed provider may have newer rules or case-specific exceptions.
  // If it is unavailable, callConfiguredProvider returns the conservative built-in result.
  return callConfiguredProvider(input, base);
}

function recommendationEligibility(tour, query = {}) {
  return staticEligibility({ profile: profileFromQuery(query), tour, allowProvider: false });
}

module.exports = {
  ENTRY_ELIGIBILITY_VERSION,
  US_RULE_REVIEWED_AT,
  US_FULL_SUSPENSION,
  US_PARTIAL_TOURIST_SUSPENSION,
  profileFrom,
  profileFromQuery,
  itineraryFromTour,
  staticEligibility,
  evaluateTravelEntryEligibility,
  recommendationEligibility,
  _internal: { cleanCode, bool, safeHttpsUrl, travelPassportCode, alternatePassportAvoidsUsSuspension, usCheck, genericCheck, normalizeItinerary, mergeProviderResult }
};
