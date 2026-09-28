const { fallbackFlightCandidates } = require('../../../../data/destination-meta');

const DEFAULT_ENDPOINT = 'https://api.travelpayouts.com/graphql/v1/query';
const AVIASALES_AFFILIATE = {
  campaignId: process.env.TRAVELPAYOUTS_AVIASALES_CAMPAIGN_ID || '100',
  marker: process.env.TRAVELPAYOUTS_AVIASALES_MARKER || '725649',
  partnerId: process.env.TRAVELPAYOUTS_AVIASALES_PARTNER_ID || '4114',
  source: process.env.TRAVELPAYOUTS_AVIASALES_TRS || '526085'
};

function safeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function addUtcDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeTripNights(value) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function usableReturnDate(value, departureDate) {
  const normalized = normalizeIsoDate(value);
  return normalized && normalized > departureDate ? normalized : null;
}

function resolveFallbackTravelDates(options = {}) {
  const nights = normalizeTripNights(options.nights);
  const bestDepartureDate = normalizeIsoDate(options.bestDepartureDate);
  if (bestDepartureDate) {
    return {
      departureDate: bestDepartureDate,
      returnDate: usableReturnDate(options.bestReturnDate, bestDepartureDate) || addUtcDays(bestDepartureDate, nights),
      source: 'resolved-best-dates'
    };
  }

  const departureDate = normalizeIsoDate(options.departureDate);
  if (departureDate) {
    return {
      departureDate,
      returnDate: usableReturnDate(options.returnDate, departureDate) || addUtcDays(departureDate, nights),
      source: 'explicit-request-dates'
    };
  }

  const month = normalizeDepartMonth(options.month).slice(0, 7);
  const monthDepartureDate = `${month}-15`;
  return {
    departureDate: monthDepartureDate,
    returnDate: addUtcDays(monthDepartureDate, nights),
    source: 'requested-month-and-nights'
  };
}

function aviasalesDatePart(value) {
  const normalized = normalizeIsoDate(value);
  if (!normalized) return '';
  return `${normalized.slice(8, 10)}${normalized.slice(5, 7)}`;
}

function buildFallbackAviasalesLink({ originCode, destinationCode, ...dateOptions } = {}) {
  const origin = safeCode(originCode);
  const destination = safeCode(destinationCode);
  if (!origin || !destination) return '';
  const dates = resolveFallbackTravelDates(dateOptions);
  const departure = aviasalesDatePart(dates.departureDate);
  const returning = aviasalesDatePart(dates.returnDate);
  const directUrl = `https://www.aviasales.com/search/${origin}${departure}${destination}${returning}${origin}1`;
  return wrapAviasalesAffiliateLink(directUrl);
}

function normalizeDepartMonth(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 2).padStart(2, '0');
  return `${year}-${month}-01`;
}

function convertFlightValueToUsd(value, currency) {
  const amount = Number(value || 0);
  const code = String(currency || process.env.TRAVELPAYOUTS_PRICE_CURRENCY || 'RUB').toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (code === 'USD') return amount;
  if (code === 'CAD') return amount * Number(process.env.CAD_TO_USD || 0.735);
  if (code === 'RUB') return amount * Number(process.env.RUB_TO_USD || 0.011);
  return amount;
}

function wrapAviasalesAffiliateLink(url) {
  const target = String(url || '').trim();
  if (!target) return target;
  if (/^https:\/\/tp\.media\/r\?/i.test(target)) return target;

  const params = new URLSearchParams({
    campaign_id: AVIASALES_AFFILIATE.campaignId,
    marker: AVIASALES_AFFILIATE.marker,
    p: AVIASALES_AFFILIATE.partnerId,
    trs: AVIASALES_AFFILIATE.source,
    u: target
  });

  return `https://tp.media/r?${params.toString()}`;
}

function buildAviasalesLink(ticketLink, originCode, destinationCode, dateOptions = {}) {
  const raw = String(ticketLink || '').trim();
  if (/^https:\/\/tp\.media\/r\?/i.test(raw)) return raw;

  let directUrl;
  if (/^https?:\/\//i.test(raw)) directUrl = raw;
  else if (raw.startsWith('/search/')) directUrl = `https://www.aviasales.com${raw}`;
  else if (raw.startsWith('/')) directUrl = `https://www.aviasales.com/search${raw}`;
  else if (raw) directUrl = `https://www.aviasales.com/search/${raw}`;
  else return buildFallbackAviasalesLink({ originCode, destinationCode, ...dateOptions });

  return wrapAviasalesAffiliateLink(directUrl);
}

async function fetchTravelpayoutsCandidates({ originCode, month, limit = 30 }) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const useMocks = String(process.env.GLOBEVOY_USE_MOCKS || '').toLowerCase() === 'true';
  const origin = safeCode(originCode || 'YTO');

  if (!token || useMocks) {
    return {
      source: token && useMocks ? 'mock-forced' : 'mock-no-token',
      candidates: fallbackFlightCandidates(origin)
    };
  }

  const departMonth = normalizeDepartMonth(month);
  const endpoint = process.env.TRAVELPAYOUTS_GRAPHQL_ENDPOINT || DEFAULT_ENDPOINT;
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 30));
  const query = `{
    prices_one_way(
      params: {
        origin: "${origin}"
        depart_months: "${departMonth}"
        no_lowcost: false
      }
      grouping: DIRECTIONS
      paging: { limit: ${safeLimit} offset: 0 }
      sorting: VALUE_ASC
    ) {
      destination_city_iata
      departure_at
      value
      trip_duration
      ticket_link
    }
  }`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Token': token
    },
    body: JSON.stringify({ query })
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Travelpayouts returned non-JSON response (${response.status}).`);
  }

  if (!response.ok || payload.errors) {
    const detail = payload.errors ? JSON.stringify(payload.errors).slice(0, 300) : text.slice(0, 300);
    throw new Error(`Travelpayouts request failed (${response.status}): ${detail}`);
  }

  const rows = Array.isArray(payload?.data?.prices_one_way) ? payload.data.prices_one_way : [];
  return {
    source: 'travelpayouts',
    candidates: rows.map(row => ({
      ...row,
      normalizedCurrency: 'USD',
      normalizedFlightUsd: Math.round(convertFlightValueToUsd(row.value)),
      bookingLink: buildAviasalesLink(row.ticket_link, origin, row.destination_city_iata)
    }))
  };
}

module.exports = {
  fetchTravelpayoutsCandidates,
  convertFlightValueToUsd,
  buildAviasalesLink,
  buildFallbackAviasalesLink,
  resolveFallbackTravelDates,
  wrapAviasalesAffiliateLink
};
