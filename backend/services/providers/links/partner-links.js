'use strict';

const { getDestination } = require('../../../data/destination-meta');
const { wrapAviasalesAffiliateLink } = require('../flights/travelpayouts/travelpayouts');
const { normalizeParty } = require('../../domain/pricing/traveller-pricing');
const { SOURCE_TYPES, normalizeFlightEvidence, normalizeHotelEvidence } = require('../../domain/pricing/price-evidence-integrity');
const { classifyAgodaLandingUrl679AR1 } = require('../stays/agoda/agoda');
const { isDuffelEvidence, usableDuffelEvidence } = require('../flights/duffel/live-evidence-integrity-005');

const DEFAULT_AGODA_CID = process.env.AGODA_AFFILIATE_CID || process.env.AGODA_CID || '1963873';

const AGODA_HANDOFF_INTEGRITY_VERSION_679A_R2 = 'GV-HOTEL-679A-R2';
const BOOKING_TRUST_VERSION_680A = 'GV-QUALITY-680A';

function agodaHandoffIntegrity679AR2Enabled() {
  return String(process.env.ENABLE_AGODA_HANDOFF_INTEGRITY_679A_R2 || '').trim().toLowerCase() === 'true';
}

function safeText(value) {
  return String(value || '').trim();
}

function safeCode(value) {
  const code = safeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return /^[A-Z0-9]{3,5}$/.test(code) ? code : null;
}

function safeIsoDate(value) {
  const raw = safeText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

function addDays(value, days) {
  const base = safeIsoDate(value);
  if (!base) return null;
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(1, Math.round(Number(days) || 1)));
  return date.toISOString().slice(0, 10);
}

function safeHttpsUrl(value) {
  const raw = safeText(value);
  if (!/^https:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).toString();
  } catch (_) {
    return null;
  }
}

function observedAgeSeconds(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.round((Date.now() - parsed) / 1000)) : null;
}

function observationFreshness(seconds) {
  if (!Number.isFinite(Number(seconds))) return 'unknown';
  if (Number(seconds) <= 900) return 'recent-observation';
  if (Number(seconds) <= 21600) return 'cached-observation';
  return 'stale-observation';
}

function passengersFromQuery(query = {}) {
  const party = normalizeParty(query);
  return {
    adults: party.adults,
    children: party.children,
    infants: party.infants,
    travellers: party.travellers,
    seatCount: party.seatCount,
    rooms: party.rooms
  };
}

function currencyFromQuery(query = {}) {
  const code = safeText(query.currency || 'CAD').toUpperCase();
  return ['CAD', 'USD', 'EUR', 'GBP', 'AUD'].includes(code) ? code : 'CAD';
}

function aviasalesDatePart(value) {
  const date = safeIsoDate(value);
  return date ? `${date.slice(8, 10)}${date.slice(5, 7)}` : null;
}

function providerEvidence(leg = {}) {
  const selectedDate = safeIsoDate(leg.automaticTourDate?.departureDate || leg.departureDate || leg.dateLabel);
  const candidates = [leg.providerDateEvidence, leg.cheapestOneWay].filter(Boolean);
  // A current matching Duffel observation outranks a cached discovery fare.
  return candidates.find(e => isDuffelEvidence(e) && usableDuffelEvidence(e, {
    origin: endpointCode(leg.from), destination: endpointCode(leg.to), departureDate: selectedDate
  })) || leg.providerDateEvidence || leg.cheapestOneWay || {};
}

function providerFareApplied(leg = {}) {
  const evidence = providerEvidence(leg);
  if (evidence.appliedToEstimate === false) return false;
  if (evidence.productionEligible === false || leg?.providerVerification?.productionEligible === false) return false;
  return !!(leg.liveFareVerified || evidence.providerBacked);
}

function legDepartureDate(leg = {}) {
  const evidence = providerEvidence(leg);
  const auto = leg.automaticTourDate || {};
  const selected = auto.departureDate || leg.departureDate || leg.dateLabel;
  return selected ? safeIsoDate(selected) : safeIsoDate(providerFareApplied(leg) ? evidence.departureDate : null);
}

function endpointCode(node = {}) {
  return safeCode(node.airportCode || node.code || node.displayCode);
}

function buildAviasalesOneWaySearchUrl({ origin, destination, departureDate, adults, children = 0, infants = 0 }) {
  const from = safeCode(origin);
  const to = safeCode(destination);
  const datePart = aviasalesDatePart(departureDate);
  if (!from || !to || !datePart) return null;
  const counts = [Number(adults ?? 1), Number(children), Number(infants)];
  if (counts.some(n => !Number.isInteger(n) || n < 0 || n > 9) || counts[0] < 1 || counts[2] > counts[0] || counts.reduce((a,b)=>a+b,0) > 9) return null;
  const party = counts[2] ? counts.join('') : counts[1] ? counts.slice(0,2).join('') : String(counts[0]);
  return `https://www.aviasales.com/search/${from}${datePart}${to}${party}`;
}

function enrichFlightLeg(leg = {}, query = {}) {
  const next = { ...leg };
  const mode = `${safeText(next.mode)} ${safeText(next.transportType)}`.toLowerCase();
  const segments = Array.isArray(next.segments) ? next.segments : [];
  const hasFlight = mode.includes('flight') || segments.some(segment => `${safeText(segment?.mode)} ${safeText(segment?.transportType)}`.toLowerCase().includes('flight'));
  const isGround = !hasFlight && (mode.includes('ground') || mode.includes('rail') || mode.includes('bus'));
  const amountUsd = Number(next.estimatedFlightUsd || next.estimatedTransportUsd || next.amountUsd || 0) || null;
  if (isGround) {
    next.bookingUrl = null;
    next.providerUrl = null;
    next.bookingStatus = 'ground-partner-link-pending';
    next.booking = {
      provider: null,
      status: 'ground-partner-link-pending',
      url: null,
      label: 'Transfer options coming next',
      finalPriceRequiresPartnerConfirmation: true
    };
    next.priceProvenance = {
      category: 'ground-transfer-estimate',
      provider: 'Globevoy planning model',
      source: next.estimateSource || next.dateSource || 'ground-transfer-planning-estimate',
      amountUsd,
      finalPriceRequiresPartnerConfirmation: true
    };
    return next;
  }
  const evidence = providerEvidence(next);
  let canonicalEvidence = evidence.priceEvidence || normalizeFlightEvidence({ ...evidence, sourceType: evidence.sourceType || SOURCE_TYPES.ESTIMATED }, {
    origin: endpointCode(next.from || {}), destination: endpointCode(next.to || {}),
    departureDate: legDepartureDate(next), currency: currencyFromQuery(query), sourceType: evidence.sourceType || SOURCE_TYPES.ESTIMATED
  });
  const departureDate = legDepartureDate(next);
  const origin = endpointCode(next.from || {});
  const destination = endpointCode(next.to || {});
  const passengers = passengersFromQuery(query);
  const duffel = isDuffelEvidence(evidence);
  const usableLive = !duffel || (passengers.children === 0 && passengers.infants === 0 && usableDuffelEvidence(evidence, { origin, destination, departureDate, passengers: passengers.travellers, currency: currencyFromQuery(query) }));
  const providerApplied = providerFareApplied(next) && usableLive;
  if (duffel && usableLive) next.providerDateEvidence = evidence;
  if (duffel && !usableLive) canonicalEvidence = { ...canonicalEvidence, sourceType: SOURCE_TYPES.UNAVAILABLE, isBookable: false, productionEligible: false };
  if (duffel) canonicalEvidence = { ...canonicalEvidence, isBookable: false };
  const exactVerified = !!(
    providerApplied
    && next?.providerVerification?.verified
    && next?.providerVerification?.exactDateMatch
    && next?.providerVerification?.productionEligible !== false
  );
  // Duffel verifies prices; it supplies no Aviasales itinerary referral guarantee.
  const existingProviderUrl = exactVerified && !duffel ? safeHttpsUrl(
    evidence.bookingLink || evidence.ticketLink || evidence.ticket_link || next.bookingUrl || next.providerUrl
  ) : null;
  const prefilledDirect = buildAviasalesOneWaySearchUrl({
    origin,
    destination,
    departureDate,
    adults: passengers.adults, children: passengers.children, infants: passengers.infants
  });
  const bookingUrl = existingProviderUrl || (prefilledDirect ? wrapAviasalesAffiliateLink(prefilledDirect) : null);
  const observedAt = evidence.observedAt || evidence.updatedAt || next?.providerVerification?.observedAt || next?.providerVerification?.checkedAt || null;
  const ageSeconds = Number.isFinite(Number(evidence.observedAgeSeconds))
    ? Number(evidence.observedAgeSeconds)
    : observedAgeSeconds(observedAt);
  const itineraryHint = Boolean(existingProviderUrl && exactVerified);
  const bookingStatus = itineraryHint ? 'provider-itinerary-hint' : (bookingUrl ? 'prefilled-comparison-link' : 'unavailable');

  next.bookingUrl = bookingUrl;
  next.providerUrl = bookingUrl;
  next.bookingStatus = bookingStatus;
  next.booking = {
    provider: 'Aviasales',
    status: bookingStatus,
    url: bookingUrl,
    directSearchUrl: prefilledDirect,
    label: 'Compare flights on Aviasales',
    evidenceProvider: duffel ? 'Duffel' : null,
    referralPriceGuaranteed: false,
    exactTicketClaimed: false,
    exactItineraryHint: itineraryHint,
    prefilled: !!prefilledDirect,
    route: { origin, destination, departureDate },
    passengers,
    finalPriceRequiresPartnerConfirmation: true,
    trust: {
      version: BOOKING_TRUST_VERSION_680A,
      priceState: canonicalEvidence.sourceType === SOURCE_TYPES.LIVE ? 'current-provider-result' : canonicalEvidence.sourceType === SOURCE_TYPES.CACHED ? 'cached-provider-observation' : canonicalEvidence.sourceType === SOURCE_TYPES.UNAVAILABLE ? 'unavailable' : 'planning-estimate',
      sourceType: canonicalEvidence.sourceType,
      evidenceId: canonicalEvidence.evidenceId,
      handoffState: itineraryHint ? 'itinerary-hint' : (bookingUrl ? 'route-search' : 'unavailable'),
      currentPriceConfirmed: false,
      availabilityConfirmed: false,
      baggageBasis: 'unknown-unless-confirmed-on-partner',
      taxAndFeeBasis: 'confirm-on-partner',
      observedAt,
      observedAgeSeconds: ageSeconds,
      freshness: observationFreshness(ageSeconds),
      ctaLabel: 'Compare flights on Aviasales'
    }
  };
  // GV-FLIGHT-IGNAV-002: Ignav-priced legs expose a booking-links lookup the
  // browser calls on click. Ignav links earn no referral commission.
  if (/^ignav(?:-|$)/i.test(String(evidence.source || '')) && evidence.ignavId && providerApplied) {
    next.booking.evidenceProvider = 'Ignav';
    next.booking.liveBookingLinks = {
      provider: 'Ignav',
      ignavId: String(evidence.ignavId),
      bookingProof: evidence.bookingProof,
      endpoint: '/api/flight-booking-links',
      method: 'POST',
      commissionEarned: false,
      label: 'See booking options for this flight'
    };
  }
  next.priceProvenance = {
    category: providerApplied ? 'provider-observation' : 'planning-estimate',
    sourceType: canonicalEvidence.sourceType,
    evidenceId: canonicalEvidence.evidenceId,
    currentPriceConfirmed: canonicalEvidence.sourceType === SOURCE_TYPES.LIVE && canonicalEvidence.isBookable,
    provider: duffel ? 'Duffel' : /^ignav(?:-|$)/i.test(String(evidence.source || '')) && providerApplied ? 'Ignav' : providerApplied ? 'Travelpayouts/Aviasales' : 'Globevoy planning model',
    source: providerApplied ? (evidence.source || next.estimateSource || 'travelpayouts-provider-observation') : (next.estimateSource || next.dateSource || 'planning-estimate'),
    amountUsd,
    unitAmountUsd: Number(next?.pricingIntegrity?.unitAmountUsd || evidence.perPassengerAmountUsd || 0) || null,
    partyTotalAmountUsd: amountUsd,
    passengerPricingVersion: next?.pricingIntegrity?.version || null,
    observedCurrency: providerApplied ? (evidence.currency || query.currency || null) : 'USD',
    observedAt: providerApplied ? observedAt : null,
    checkedAt: next?.providerVerification?.checkedAt || null,
    observedAgeSeconds: providerApplied ? ageSeconds : null,
    freshness: providerApplied ? observationFreshness(ageSeconds) : null,
    exactDateMatch: providerApplied ? Boolean(evidence.exactDateMatch || next?.providerVerification?.exactDateMatch) : false,
    cacheHit: providerApplied ? Boolean(evidence.cacheHit || next?.providerVerification?.cacheHit) : false,
    cached: providerApplied ? Boolean(evidence.cacheHit || next?.providerVerification?.cacheHit) : false,
    appliedToEstimate: providerApplied,
    finalPriceRequiresPartnerConfirmation: true
  };
  return next;
}

function destinationRecordForStop(stop = {}) {
  const candidates = [stop.cityId, stop.id, stop.code, stop.airportCode, stop.city].filter(Boolean);
  for (const candidate of candidates) {
    const record = getDestination(candidate);
    if (record) return record;
  }
  return null;
}

function withAgodaAffiliateParams(rawUrl, { checkIn, checkOut, currency, city, adults, children, rooms, hotelId }) {
  const classified = classifyAgodaLandingUrl679AR1(rawUrl, hotelId);
  const urlString = classified.url;
  if (!urlString) return null;
  if (!checkIn || !checkOut || checkOut <= checkIn) return null;
  try {
    const url = new URL(urlString);
    const partnerSearch = classified.linkType === 'provider-search-results';
    // Update existing aliases instead of appending contradictory guest/date values.
    // Partner-search spellings follow Agoda's supplied landingURL contract.
    function setContext(aliases, fallback, value) {
      const keys = [...url.searchParams.keys()].filter(key => aliases.includes(key.toLowerCase()));
      const selected = keys[0] || fallback;
      for (const key of keys) url.searchParams.delete(key);
      url.searchParams.set(selected, String(value));
    }
    setContext(['checkin'], partnerSearch ? 'checkin' : 'checkIn', checkIn);
    setContext(['checkout'], partnerSearch ? 'checkout' : 'checkOut', checkOut);
    setContext(['rooms'], partnerSearch ? 'Rooms' : 'rooms', passengersCount(rooms, 1));
    setContext(['adults','numberofadults'], partnerSearch ? 'NumberofAdults' : 'adults', passengersCount(adults, 1));
    setContext(['children','numberofchildren'], partnerSearch ? 'NumberofChildren' : 'children', passengersCount(children, 0));
    url.searchParams.set('currency', currency);
    url.searchParams.set('cid', url.searchParams.get('cid') || DEFAULT_AGODA_CID);
    url.searchParams.set('tag', url.searchParams.get('tag') || `globevoy-tour-${safeText(city).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`);
    return url.toString();
  } catch (_) {
    return null;
  }
}

function passengersCount(value, minimum) { return Math.max(minimum, Math.round(Number(value) || 0)); }

function buildAgodaCitySearchUrl({ cityId, checkIn, checkOut, currency, city, adults, children, rooms }) {
  const numericCityId = Number(cityId);
  if (!Number.isSafeInteger(numericCityId) || numericCityId <= 0 || !checkIn || !checkOut || checkOut <= checkIn) return null;
  const url = new URL('https://www.agoda.com/search');
  url.searchParams.set('city', String(Math.round(numericCityId)));
  url.searchParams.set('checkIn', checkIn);
  url.searchParams.set('checkOut', checkOut);
  url.searchParams.set('rooms', String(Math.max(1, rooms || 1)));
  url.searchParams.set('adults', String(Math.max(1, adults || 1)));
  url.searchParams.set('children', String(Math.max(0, children || 0)));
  url.searchParams.set('currency', currency);
  url.searchParams.set('cid', DEFAULT_AGODA_CID);
  url.searchParams.set('tag', `globevoy-tour-${safeText(city).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`);
  return url.toString();
}

function enrichStay(stop = {}, query = {}) {
  const next = { ...stop };
  const hotel = { ...(next.hotel || {}) };
  const record = destinationRecordForStop(next) || {};
  const passengers = passengersFromQuery(query);
  const currency = currencyFromQuery(query);
  const checkIn = safeIsoDate(next.arrivalDate || next.checkIn || hotel.checkIn);
  const explicitCheckOut = next.departureDate || next.checkOut || hotel.checkOut;
  const checkOut = explicitCheckOut ? safeIsoDate(explicitCheckOut) : addDays(checkIn, next.nights || 1);
  const cityId = Number(next.agodaCityId || hotel.agodaCityId || hotel.providerCityId || record.agodaCityId || 0) || null;
  const providerHotel = hotel.providerHotel || {};
  const r2AgodaHandoff = agodaHandoffIntegrity679AR2Enabled()
    && String(providerHotel.provider || hotel.provider || hotel.source || '').trim().toLowerCase().includes('agoda')
    && String(providerHotel.priceLinkIntegrityVersion || hotel?.providerVerification?.priceLinkIntegrityVersion || '') === 'GV-HOTEL-679A-R1';
  const hotelId = hotel.agodaHotelId || (String(providerHotel.provider || '').toLowerCase() === 'agoda' ? providerHotel.hotelId : null)
    || (String(hotel.provider || '').toLowerCase() === 'agoda' ? hotel.hotelId : null);
  const referrals = [providerHotel.bookingUrl, hotel.hotelUrl, hotel.bookingUrl, hotel.providerUrl, hotel.url].filter(Boolean)
    .map(url => classifyAgodaLandingUrl679AR1(url, hotelId)).filter(link => link.url);
  const selectedReferral = referrals.find(link => link.directPropertyLink) || referrals[0] || null;
  const specificHotelUrl = withAgodaAffiliateParams(selectedReferral?.url, {
    checkIn,
    checkOut,
    currency,
    city: next.city,
    adults: passengers.adults,
    children: passengers.children,
    rooms: passengers.rooms,
    hotelId
  });
  const citySearchUrl = buildAgodaCitySearchUrl({
    cityId,
    checkIn,
    checkOut,
    currency,
    city: next.city,
    adults: passengers.adults,
    children: passengers.children,
    rooms: passengers.rooms
  });
  const bookingUrl = specificHotelUrl || citySearchUrl;
  const nuiteePriced = Boolean(hotel.nuiteeHotelId) || [hotel.provider, hotel.source, providerHotel.provider].some(value => String(value || '').toLowerCase() === 'nuitee');
  const directPropertyLink = !nuiteePriced && Number.isSafeInteger(Number(hotelId)) && Number(hotelId) > 0 && Boolean(specificHotelUrl && selectedReferral?.directPropertyLink);
  const providerResultsLink = Boolean(specificHotelUrl && selectedReferral?.linkType === 'provider-search-results');
  const sourceText = safeText(hotel.source || hotel.estimateSource || '').toLowerCase();
  const verification = hotel.providerVerification || {};
  const observationCheckIn = safeIsoDate(verification.checkIn || hotel.priceEvidence?.checkIn || hotel.checkIn);
  const observationCheckOut = safeIsoDate(verification.checkOut || hotel.priceEvidence?.checkOut || hotel.checkOut);
  const datesMatch = observationCheckIn === checkIn && observationCheckOut === checkOut
    && (!hotel.priceEvidence?.checkIn || safeIsoDate(hotel.priceEvidence.checkIn) === checkIn)
    && (!hotel.priceEvidence?.checkOut || safeIsoDate(hotel.priceEvidence.checkOut) === checkOut);
  const observedParty = verification.party || hotel.requestEvidence?.party;
  const partyMatches = observedParty && ['adults', 'children', 'rooms'].every(key =>
    Number(observedParty[key]) === passengers[key]);
  const observedHotelIds = [verification.hotelId, hotel.priceEvidence?.hotelId, hotel.priceEvidence?.propertyId, providerHotel.hotelId].filter(id => id != null);
  const propertyMatches = !nuiteePriced && hotelId && observedHotelIds.length > 0
    && observedHotelIds.every(id => String(hotelId) === String(id));
  const fresh = [hotel.priceEvidence?.expiresAt, verification.expiresAt].filter(Boolean).every(expiry => Date.parse(expiry) > Date.now());
  const currencyMatches = !hotel.priceEvidence?.currency || hotel.priceEvidence.currency === currency;
  const providerRate = propertyMatches && fresh && currencyMatches && sourceText.includes('agoda') && datesMatch && partyMatches
    && Number(hotel.estimatedStayUsd || hotel.totalStayUsd || 0) > 0
    && verification.verified === true
    && verification.exactStayDates === true
    && verification.productionEligible === true;
  const amountUsd = Number(hotel.estimatedStayUsd || hotel.totalStayUsd || 0) || null;
  let canonicalEvidence = hotel.priceEvidence || normalizeHotelEvidence({ ...hotel, sourceType: providerRate ? SOURCE_TYPES.LIVE : SOURCE_TYPES.ESTIMATED }, {
    city: next.city, checkIn, checkOut, currency
  });
  if (canonicalEvidence.sourceType === SOURCE_TYPES.LIVE && !providerRate) {
    canonicalEvidence = { ...canonicalEvidence, sourceType: SOURCE_TYPES.ESTIMATED, isBookable: false, productionEligible: false };
  }

  hotel.agodaCityId = cityId;
  hotel.bookingUrl = bookingUrl;
  hotel.providerUrl = bookingUrl;
  // Active classic booking consumers also read these legacy/provider aliases.
  // Keep one validated destination; a raw/stale URL must not override context or
  // resurrect a link rejected for identity/date validation.
  for (const key of ['hotelUrl', 'url']) if (Object.hasOwn(hotel, key)) hotel[key] = bookingUrl;
  if (hotel.providerHotel) hotel.providerHotel = { ...hotel.providerHotel, bookingUrl: specificHotelUrl };
  hotel.booking = {
    provider: 'Agoda',
    status: r2AgodaHandoff
      ? (directPropertyLink ? 'provider-property-page' : (specificHotelUrl ? (providerResultsLink ? 'provider-search-results' : 'provider-link-unverified') : (citySearchUrl ? 'prefilled-city-search' : 'unavailable')))
      : (directPropertyLink ? 'specific-hotel-deep-link' : specificHotelUrl ? 'provider-search-results' : (citySearchUrl ? 'prefilled-city-search' : 'unavailable')),
    url: bookingUrl,
    label: r2AgodaHandoff
      ? (directPropertyLink ? 'View this hotel on Agoda' : (specificHotelUrl ? 'View in Agoda results' : (citySearchUrl ? 'View stays in this city' : 'Stay link unavailable')))
      : (directPropertyLink ? 'View this stay' : (specificHotelUrl ? 'View in Agoda results' : citySearchUrl ? 'View stays in this city' : 'Stay link unavailable')),
    specificHotel: directPropertyLink,
    directPropertyLink,
    handoffPropertyVerified: directPropertyLink,
    linkType: directPropertyLink ? 'provider-property-page' : (providerResultsLink ? 'provider-search-results' : (bookingUrl ? 'comparison-search' : 'none')),
    selectedProviderHotelId: hotelId || null,
    prefilled: r2AgodaHandoff ? !directPropertyLink && !!bookingUrl : !!citySearchUrl,
    ...(r2AgodaHandoff ? {
      handoffIntegrityVersion: AGODA_HANDOFF_INTEGRITY_VERSION_679A_R2,
      linkType: directPropertyLink ? 'provider-property-page' : (providerResultsLink ? 'provider-search-results' : (specificHotelUrl ? 'provider-link-unverified' : (citySearchUrl ? 'prefilled-city-search' : 'unavailable'))),
      directPropertyLink,
      providerHotelIdInLink: providerHotel.providerHotelIdInLink === true,
      finalDestinationRequiresPartnerConfirmation: directPropertyLink !== true
    } : {}),
    cityId,
    checkIn,
    checkOut,
    passengers,
    finalPriceRequiresPartnerConfirmation: true,
    trust: {
      version: BOOKING_TRUST_VERSION_680A,
      priceState: canonicalEvidence.sourceType === SOURCE_TYPES.LIVE ? 'current-provider-result' : canonicalEvidence.sourceType === SOURCE_TYPES.CACHED ? 'cached-provider-observation' : 'planning-estimate',
      sourceType: canonicalEvidence.sourceType,
      evidenceId: canonicalEvidence.evidenceId,
      handoffState: directPropertyLink ? 'property-page' : (specificHotelUrl ? 'selected-property-results' : (citySearchUrl ? 'city-search' : 'unavailable')),
      currentPriceConfirmed: false,
      availabilityConfirmed: false,
      taxAndFeeBasis: providerHotel?.rateObservation?.taxBasis || 'unknown',
      observedAt: hotel.observedAt || verification.observedAt || verification.checkedAt || null,
      finalPriceRequiresPartnerConfirmation: true,
      ctaLabel: directPropertyLink ? 'Check this property on Agoda' : (specificHotelUrl ? 'View selected property in Agoda results' : (citySearchUrl ? 'Search stays in this city' : 'Stay link unavailable'))
    }
  };
  // GV-HOTEL-NUITEE-WL-001: Nuitee live-rate stays hand off to GlobeVoy's
  // Nuitee White Label hotel page (same rate source); Agoda stays as comparison.
  const wl = hotel.nuiteeWhitelabel;
  if (nuiteePriced && wl && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/hotels\/[A-Za-z0-9_-]+\?/.test(String(wl.url || ''))) {
    hotel.booking.whitelabel = { url: wl.url, label: 'Book this hotel', provider: 'Nuitee', merchant: 'Nuitee', hotelId: wl.hotelId, checkIn, checkOut, finalPriceRequiresPartnerConfirmation: true };
  }
  if (nuiteePriced && bookingUrl) {
    hotel.booking.label = 'Compare stays on Agoda';
    hotel.booking.handoffPropertyVerified = false;
    hotel.booking.trust.handoffState = 'comparison-search';
    hotel.booking.trust.ctaLabel = 'Compare stays on Agoda';
  }
  hotel.priceProvenance = {
    category: providerRate ? 'provider-rate-evidence' : 'planning-estimate',
    sourceType: canonicalEvidence.sourceType,
    evidenceId: canonicalEvidence.evidenceId,
    currentPriceConfirmed: false,
    provider: providerRate ? 'Agoda' : 'Globevoy planning model',
    source: hotel.source || hotel.provider || (providerRate ? 'agoda' : 'stay-planning-estimate'),
    amountUsd,
    nightlyPerRoomUsd: Number(hotel?.pricingIntegrity?.nightlyPerRoomUsd || hotel.estimatedNightlyUsd || 0) || null,
    roomCount: Number(hotel?.pricingIntegrity?.roomCount || hotel.rooms || passengers.rooms || 1),
    partyStayTotalUsd: amountUsd,
    passengerPricingVersion: hotel?.pricingIntegrity?.version || null,
    sampleSize: Number(hotel.sampleSize || 0) || null,
    observedAt: providerRate ? (hotel.observedAt || hotel?.providerVerification?.observedAt || null) : null,
    checkedAt: hotel?.providerVerification?.checkedAt || null,
    observedAgeSeconds: providerRate && Number.isFinite(Number(hotel?.providerVerification?.observedAgeSeconds)) ? Number(hotel.providerVerification.observedAgeSeconds) : null,
    exactStayDates: providerRate ? Boolean(hotel?.providerVerification?.exactStayDates || hotel?.requestEvidence?.exactStayDates) : false,
    finalPriceRequiresPartnerConfirmation: true
  };
  next.agodaCityId = cityId;
  next.hotel = hotel;
  return next;
}

function summarizePriceProvenance(legs = [], stops = []) {
  const flightProviderCount = legs.filter(leg => leg?.priceProvenance?.category === 'provider-observation').length;
  const flightEstimateCount = legs.filter(leg => leg?.priceProvenance?.category === 'planning-estimate').length;
  const groundEstimateCount = legs.filter(leg => leg?.priceProvenance?.category === 'ground-transfer-estimate').length;
  const hotelProviderCount = stops.filter(stop => stop?.hotel?.priceProvenance?.category === 'provider-rate-evidence').length;
  const hotelEstimateCount = stops.filter(stop => stop?.hotel?.priceProvenance?.category === 'planning-estimate').length;
  return {
    version: 'GV-LINK-663A+GV-LIVE-667B',
    flightProviderCount,
    flightEstimateCount,
    groundEstimateCount,
    hotelProviderCount,
    hotelEstimateCount,
    allPricesRequirePartnerConfirmation: true,
    description: 'Each transport and stay amount is labelled as provider-backed/cached evidence or a planning estimate.'
  };
}

module.exports = {
  enrichFlightLeg,
  enrichStay,
  summarizePriceProvenance,
  buildAviasalesOneWaySearchUrl,
  buildAgodaCitySearchUrl,
  safeIsoDate,
  AGODA_HANDOFF_INTEGRITY_VERSION_679A_R2,
  BOOKING_TRUST_VERSION_680A,
  agodaHandoffIntegrity679AR2Enabled
};
