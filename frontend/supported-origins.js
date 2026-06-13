// Globevoy supported origin source of truth.
// Keep this file production-only: do not import draft origin-airport mapping data here.
(function (window) {
  const origins = [
    {
      label: 'Toronto (YYZ)',
      city: 'Toronto',
      code: 'YYZ',
      originCode: 'YTO',
      airportCode: 'YYZ',
      country: 'Canada',
      suggestedCurrency: 'CAD',
      aliases: ['toronto', 'yto', 'yyz', 'toronto yyz', 'toronto (yyz)'],
      lat: 43.68,
      lng: -79.62,
      x: 22,
      y: 43
    },
    {
      label: 'New York (JFK)',
      city: 'New York',
      code: 'JFK',
      originCode: 'NYC',
      airportCode: 'JFK',
      country: 'United States',
      suggestedCurrency: 'USD',
      aliases: ['new york', 'nyc', 'jfk', 'new york jfk', 'new york (jfk)'],
      lat: 40.64,
      lng: -73.78,
      x: 25,
      y: 45
    },
    {
      label: 'Los Angeles (LAX)',
      city: 'Los Angeles',
      code: 'LAX',
      originCode: 'LAX',
      airportCode: 'LAX',
      country: 'United States',
      suggestedCurrency: 'USD',
      aliases: ['los angeles', 'la', 'lax', 'los angeles lax', 'los angeles (lax)'],
      lat: 33.94,
      lng: -118.41,
      x: 15,
      y: 51
    },
    {
      label: 'London (LHR)',
      city: 'London',
      code: 'LHR',
      originCode: 'LON',
      airportCode: 'LHR',
      country: 'United Kingdom',
      suggestedCurrency: 'GBP',
      aliases: ['london', 'london uk', 'lon', 'lhr', 'london lhr', 'london (lhr)'],
      lat: 51.47,
      lng: -0.45,
      x: 49,
      y: 36
    },
    {
      label: 'Dubai (DXB)',
      city: 'Dubai',
      code: 'DXB',
      originCode: 'DXB',
      airportCode: 'DXB',
      country: 'United Arab Emirates',
      suggestedCurrency: 'USD',
      aliases: ['dubai', 'dxb', 'dubai dxb', 'dubai (dxb)'],
      lat: 25.25,
      lng: 55.37,
      x: 64,
      y: 53
    },
    {
      label: 'Singapore (SIN)',
      city: 'Singapore',
      code: 'SIN',
      originCode: 'SIN',
      airportCode: 'SIN',
      country: 'Singapore',
      suggestedCurrency: 'USD',
      aliases: ['singapore', 'sin', 'singapore sin', 'singapore (sin)'],
      lat: 1.36,
      lng: 103.99,
      x: 76,
      y: 66
    },
    {
      label: 'Montreal (YUL)',
      city: 'Montreal',
      code: 'YUL',
      originCode: 'YUL',
      airportCode: 'YUL',
      country: 'Canada',
      suggestedCurrency: 'CAD',
      aliases: ['montreal', 'montréal', 'yul', 'montreal yul', 'montreal (yul)'],
      lat: 45.47,
      lng: -73.74,
      x: 23,
      y: 41
    },
    {
      label: 'Vancouver (YVR)',
      city: 'Vancouver',
      code: 'YVR',
      originCode: 'YVR',
      airportCode: 'YVR',
      country: 'Canada',
      suggestedCurrency: 'CAD',
      aliases: ['vancouver', 'yvr', 'vancouver yvr', 'vancouver (yvr)'],
      lat: 49.19,
      lng: -123.18,
      x: 14,
      y: 38
    },
    {
      label: 'Sydney (SYD)',
      city: 'Sydney',
      code: 'SYD',
      originCode: 'SYD',
      airportCode: 'SYD',
      country: 'Australia',
      suggestedCurrency: 'AUD',
      aliases: ['sydney', 'sydney australia', 'syd', 'sydney syd', 'sydney (syd)'],
      lat: -33.95,
      lng: 151.18,
      x: 83,
      y: 78
    },
    {
      label: 'Paris (CDG)',
      city: 'Paris',
      code: 'CDG',
      originCode: 'PAR',
      airportCode: 'CDG',
      country: 'France',
      suggestedCurrency: 'EUR',
      aliases: ['paris', 'par', 'cdg', 'paris cdg', 'paris (cdg)'],
      lat: 49.01,
      lng: 2.55,
      x: 50,
      y: 38
    }
  ];

  const shortlist = 'Toronto, New York, Los Angeles, London, Dubai, Singapore, Montreal, Vancouver, Sydney, or Paris';
  const unsupportedOriginMessage = 'This origin is not supported yet. Try Toronto or New York.';
  const emptyOriginMessage = 'Please enter a supported origin city or airport.';

  function clone(origin) {
    return {
      ...origin,
      aliases: Array.isArray(origin.aliases) ? origin.aliases.slice() : []
    };
  }

  function all() {
    return origins.map(clone);
  }

  function searchText(value) {
    return String(value || '')
      .replace(/\s*\([A-Z]{3}\)\s*$/i, '')
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function label(origin) {
    return origin ? `${origin.city} (${origin.code})` : '';
  }

  function matchesOrigin(origin, query, allowPrefix) {
    const city = origin.city.toLowerCase();
    const code = origin.code.toLowerCase();
    const originCode = String(origin.originCode || '').toLowerCase();
    const airportCode = String(origin.airportCode || '').toLowerCase();
    const fullLabel = label(origin).toLowerCase();
    const aliases = Array.isArray(origin.aliases) ? origin.aliases.map(searchText) : [];
    if ([city, code, originCode, airportCode, fullLabel, ...aliases].includes(query)) return true;
    return Boolean(allowPrefix && (city.startsWith(query) || fullLabel.startsWith(query) || query.startsWith(city)));
  }

  function find(value, options) {
    const query = searchText(value);
    if (!query) return null;
    const allowPrefix = !options || options.allowPrefix !== false;
    const match = origins.find(origin => matchesOrigin(origin, query, allowPrefix));
    return match ? clone(match) : null;
  }

  function matching(value) {
    const query = searchText(value);
    if (!query) return all();
    return origins
      .filter(origin => {
        const haystack = [
          origin.city,
          origin.code,
          origin.originCode,
          origin.airportCode,
          label(origin),
          ...(Array.isArray(origin.aliases) ? origin.aliases : [])
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .map(clone);
  }

  function currencyFor(valueOrOrigin, fallback) {
    const origin = typeof valueOrOrigin === 'object' && valueOrOrigin
      ? valueOrOrigin
      : find(valueOrOrigin);
    return (origin && origin.suggestedCurrency) || fallback || 'CAD';
  }

  window.GlobevoySupportedOrigins = {
    origins: all(),
    shortlist,
    unsupportedOriginMessage,
    emptyOriginMessage,
    all,
    find,
    matching,
    label,
    searchText,
    currencyFor
  };
})(window);
