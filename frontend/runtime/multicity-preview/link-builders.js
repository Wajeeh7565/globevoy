(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GlobevoyMehdiLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function safeCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  }

  function safeDate(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid ISO date: ${text}`);
    const date = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error(`Invalid ISO date: ${text}`);
    return text;
  }

  function buildAviasalesComplexRouteLink({ originCode, anchorCode, returnOriginCode, departureDate, returnDate, currency, affiliateConfig }) {
    const origin = safeCode(originCode);
    const anchor = safeCode(anchorCode);
    const returnOrigin = safeCode(returnOriginCode);
    const outbound = safeDate(departureDate);
    const returning = safeDate(returnDate);
    if (!origin || !anchor || !returnOrigin) throw new Error('All flight airport codes are required.');

    const supportedCurrencies = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];
    const requestedCurrency = String(currency || 'CAD').toUpperCase();
    const normalizedCurrency = supportedCurrencies.includes(requestedCurrency) ? requestedCurrency : 'CAD';

    // The official documentation describes complex-route query parameters, but the
    // manually accepted redirect did not reliably preserve both legs and dates.
    // Open the official multi-city comparison experience and show exact manual-entry
    // instructions instead of claiming that the itinerary was transferred.
    const direct = new URL('https://www.aviasales.com/');
    direct.hash = 'multicity';

    const config = affiliateConfig || {};
    const wrapped = new URL('https://tp.media/r');
    wrapped.searchParams.set('campaign_id', String(config.campaignId || '100'));
    wrapped.searchParams.set('marker', String(config.marker || 'PLACEHOLDER_MARKER'));
    wrapped.searchParams.set('p', String(config.partnerId || '4114'));
    wrapped.searchParams.set('trs', String(config.source || '526085'));
    wrapped.searchParams.set('u', direct.toString());

    return {
      status: 'manual-entry-required',
      url: wrapped.toString(),
      directComparisonUrl: direct.toString(),
      affiliateMarkerStatus: config.marker ? 'existing-public-config' : 'placeholder-marker',
      exactPrefillClaimed: false,
      segments: [
        { origin, destination: anchor, departureDate: outbound },
        { origin: returnOrigin, destination: origin, departureDate: returning }
      ],
      passengers: { adults: 1, children: 0, infants: 0 },
      cabin: 'economy',
      currency: normalizedCurrency,
      buttonLabel: 'Open flight comparison',
      instruction: 'Enter the two flight legs shown above on the comparison site.',
      limitation: 'The accepted Aviasales redirect did not reliably preserve the complete open-jaw itinerary, exact dates, locale or display currency.'
    };
  }

  function buildAgodaStayLink({ agodaCityId, city, checkIn, checkOut, currency, affiliateConfig }) {
    const cityId = Number(agodaCityId);
    if (!Number.isFinite(cityId) || cityId <= 0) {
      return { status: 'unavailable', url: null, reason: 'No verified Agoda city ID is available for this reviewed destination.' };
    }
    const supported = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];
    const code = String(currency || '').toUpperCase();
    const normalizedCurrency = supported.includes(code) ? code : 'CAD';
    const url = new URL('https://www.agoda.com/search');
    url.searchParams.set('city', String(cityId));
    url.searchParams.set('checkIn', safeDate(checkIn));
    url.searchParams.set('checkOut', safeDate(checkOut));
    url.searchParams.set('rooms', '1');
    url.searchParams.set('adults', '1');
    url.searchParams.set('children', '0');
    url.searchParams.set('currency', normalizedCurrency);
    url.searchParams.set('cid', String((affiliateConfig || {}).cid || '1963873'));
    url.searchParams.set('tag', `globevoy-mehdi-demo-${String(city || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`);
    return {
      status: 'available',
      url: url.toString(),
      cityId,
      checkIn,
      checkOut,
      currency: normalizedCurrency,
      affiliateStatus: 'existing-public-config'
    };
  }

  return { buildAviasalesComplexRouteLink, buildAgodaStayLink, safeCode, safeDate };
});
