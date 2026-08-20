// Homepage-only nearby-origin suggestions prototype.
// This is not a supported-origin list and does not silently map user input.
(function (window) {
  const suggestions = [
    {
      mappingId: 'hamilton-on-ca',
      inputCity: 'Hamilton',
      country: 'Canada',
      region: 'Ontario',
      aliases: ['hamilton', 'hamilton ontario', 'hamilton on', 'yhm'],
      suggestedCity: 'Toronto',
      suggestedOriginCode: 'YTO',
      suggestedAirportCode: 'YYZ',
      suggestedAirportName: 'Toronto Pearson International Airport',
      suggestedCurrency: 'CAD',
      requiresUserConfirmation: true,
      displayMessage: 'Hamilton is not directly supported yet. Use Toronto Pearson (YYZ)?',
      secondaryMessage: 'We will only use YYZ if you confirm.'
    },
    {
      mappingId: 'mississauga-on-ca',
      inputCity: 'Mississauga',
      country: 'Canada',
      region: 'Ontario',
      aliases: ['mississauga', 'mississauga ontario', 'mississauga on'],
      suggestedCity: 'Toronto',
      suggestedOriginCode: 'YTO',
      suggestedAirportCode: 'YYZ',
      suggestedAirportName: 'Toronto Pearson International Airport',
      suggestedCurrency: 'CAD',
      requiresUserConfirmation: true,
      displayMessage: 'Mississauga is near Toronto Pearson. Use Toronto Pearson (YYZ)?',
      secondaryMessage: 'We will only use YYZ if you confirm.'
    }
  ];

  function clone(suggestion) {
    return {
      ...suggestion,
      aliases: Array.isArray(suggestion.aliases) ? suggestion.aliases.slice() : []
    };
  }

  function searchText(value) {
    return String(value || '')
      .replace(/\s*\([A-Z]{3}\)\s*$/i, '')
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function find(value) {
    const query = searchText(value);
    if (!query) return null;
    const match = suggestions.find(suggestion => {
      const aliases = Array.isArray(suggestion.aliases) ? suggestion.aliases.map(searchText) : [];
      return aliases.includes(query);
    });
    return match ? clone(match) : null;
  }

  window.GlobevoyNearbyOriginSuggestions = {
    all: () => suggestions.map(clone),
    find
  };
})(window);
