(function(root,factory){const data=factory();if(typeof module==='object'&&module.exports)module.exports=data;else root.GLOBEVOY_MEHDI_DEMO_DATA=data;})(typeof globalThis!=='undefined'?globalThis:this,function(){return {
  "artifact": "globevoy-mehdi-multicity-demo-data",
  "status": "isolated-internal-demo-not-production",
  "generatedAt": "2026-06-19T14:00:00-04:00",
  "warning": "Prices and dates are deterministic planning fixtures or sanitized replays, not live booking quotes.",
  "sourceFiles": {
    "reviewedDestinations": "prototype/multicity/reviewed-destinations.json",
    "flexibleDateFixtures": "prototype/multicity/flexible-date-fixtures.json",
    "registry": "release/globevoy_multicity_registry_500.json",
    "providerReplay": "prototype/multicity/provider-adapter/provider-replay-data.json"
  },
  "sourceHashes": {
    "prototype/multicity/reviewed-destinations.json": "68b455819731f92d0ff737353dc4dc651b4d1bd8b12b2d440ba827d949db653f",
    "prototype/multicity/flexible-date-fixtures.json": "7f9d5ea6744e80f7f62bad8a0faf6002a4eab65f8eb81d442223665b5adb3afd",
    "release/globevoy_multicity_registry_500.json": "95614ebb615ca17300b0e57897a0a8442e28588d4cdd828a2a60180a87bd0188",
    "prototype/multicity/provider-adapter/provider-replay-data.json": "9cb97eeb3840f48f282d3e4a8a61088aa9b9adee9fd5521ac5ab08ad60bfaa93"
  },
  "origins": [
    {
      "city": "Toronto",
      "code": "YYZ",
      "label": "Toronto / YYZ"
    },
    {
      "city": "New York",
      "code": "NYC",
      "label": "New York / NYC area"
    }
  ],
  "supportedCurrencies": [
    "CAD",
    "USD",
    "EUR",
    "GBP",
    "AUD"
  ],
  "displayCurrencyPerUsd": {
    "CAD": 1.36,
    "USD": 1,
    "EUR": 0.92,
    "GBP": 0.79,
    "AUD": 1.52
  },
  "affiliateConfig": {
    "status": "existing-public-affiliate-configuration",
    "aviasales": {
      "campaignId": "100",
      "marker": "725649",
      "partnerId": "4114",
      "source": "526085"
    },
    "agoda": {
      "cid": "1963873"
    }
  },
  "records": [
    {
      "id": "lisbon-pt",
      "city": "Lisbon",
      "country": "Portugal",
      "canonicalRegion": "Europe",
      "latitude": 38.77,
      "longitude": -9.13,
      "airportCodes": [
        "LIS"
      ],
      "primaryAirportCode": "LIS",
      "nearestMajorAirport": "LIS",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 4,
      "popularityScore": 4,
      "hiddenGemScore": 2,
      "recommendedMinNights": 4,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "rail",
        "regional flight",
        "road"
      ],
      "suitableTripStyles": [
        "coast",
        "culture",
        "food",
        "hub",
        "multi-city hub",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence European gateway with strong provider coverage and clear rail links to both a familiar complement and a discovery corridor.",
      "prototypeWarnings": [],
      "sourceRegistryId": "lisbon-pt",
      "agodaCityId": 16364,
      "travelpayoutsCityCode": "LIS"
    },
    {
      "id": "paris-fr",
      "city": "Paris",
      "country": "France",
      "canonicalRegion": "Europe",
      "latitude": 48.86,
      "longitude": 2.35,
      "airportCodes": [
        "PAR"
      ],
      "primaryAirportCode": "PAR",
      "nearestMajorAirport": "PAR",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 5,
      "popularityScore": 5,
      "hiddenGemScore": 1,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "short flight"
      ],
      "suitableTripStyles": [
        "hub city",
        "multi-city hub"
      ],
      "flightProviderStatus": "partial",
      "hotelProviderStatus": "strong",
      "providerConfidence": "medium",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "Recognizable high-confidence anchor with broad rail connectivity and enough demand to benchmark familiar versus less-obvious options.",
      "prototypeWarnings": [],
      "sourceRegistryId": "paris-fr",
      "agodaCityId": 15470,
      "travelpayoutsCityCode": "PAR"
    },
    {
      "id": "rome-it",
      "city": "Rome",
      "country": "Italy",
      "canonicalRegion": "Europe",
      "latitude": 41.9,
      "longitude": 12.5,
      "airportCodes": [
        "ROM"
      ],
      "primaryAirportCode": "ROM",
      "nearestMajorAirport": "ROM",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 4,
      "popularityScore": 5,
      "hiddenGemScore": 1,
      "recommendedMinNights": 4,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "short flight"
      ],
      "suitableTripStyles": [
        "historic",
        "multi-city hub"
      ],
      "flightProviderStatus": "partial",
      "hotelProviderStatus": "strong",
      "providerConfidence": "medium",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence anchor with strong recognition and practical onward rail or short-flight choices.",
      "prototypeWarnings": [],
      "sourceRegistryId": "rome-it",
      "agodaCityId": 16594,
      "travelpayoutsCityCode": "ROM"
    },
    {
      "id": "barcelona-es",
      "city": "Barcelona",
      "country": "Spain",
      "canonicalRegion": "Europe",
      "latitude": 41.39,
      "longitude": 2.17,
      "airportCodes": [
        "BCN"
      ],
      "primaryAirportCode": "BCN",
      "nearestMajorAirport": "BCN",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 4,
      "popularityScore": 5,
      "hiddenGemScore": 1,
      "recommendedMinNights": 4,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "short flight",
        "regional flight"
      ],
      "suitableTripStyles": [
        "culture",
        "multi-city hub"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence anchor with strong provider coverage and two understandable rail-oriented complements.",
      "prototypeWarnings": [],
      "sourceRegistryId": "barcelona-es",
      "agodaCityId": 2002,
      "travelpayoutsCityCode": "BCN"
    },
    {
      "id": "mexico-city-mx",
      "city": "Mexico City",
      "country": "Mexico",
      "canonicalRegion": "Latin America & Caribbean",
      "latitude": 19.44,
      "longitude": -99.07,
      "airportCodes": [
        "MEX"
      ],
      "primaryAirportCode": "MEX",
      "nearestMajorAirport": "MEX",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 4,
      "popularityScore": 4,
      "hiddenGemScore": 2,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "road",
        "regional flight",
        "short flight"
      ],
      "suitableTripStyles": [
        "culture",
        "food",
        "multi-city hub",
        "short",
        "value",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence Latin American anchor with strong provider coverage and several realistic road or domestic-flight complements.",
      "prototypeWarnings": [],
      "sourceRegistryId": "mexico-city-mx",
      "agodaCityId": 2086,
      "travelpayoutsCityCode": "MEX"
    },
    {
      "id": "bogota-co",
      "city": "Bogota",
      "country": "Colombia",
      "canonicalRegion": "Latin America & Caribbean",
      "latitude": 4.698602,
      "longitude": -74.143135,
      "airportCodes": [
        "BOG"
      ],
      "primaryAirportCode": "BOG",
      "nearestMajorAirport": "BOG",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 4,
      "popularityScore": 4,
      "hiddenGemScore": 2,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "short flight",
        "road",
        "regional flight"
      ],
      "suitableTripStyles": [
        "coast",
        "culture",
        "culture, coast, and value travel",
        "food",
        "multi-city hub",
        "value"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "medium",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence anchor with strong provider coverage and practical links to Caribbean complements.",
      "prototypeWarnings": [],
      "sourceRegistryId": "bogota-co",
      "agodaCityId": 4926,
      "travelpayoutsCityCode": "BOG"
    },
    {
      "id": "montreal-ca",
      "city": "Montreal",
      "country": "Canada",
      "canonicalRegion": "North America",
      "latitude": 45.5,
      "longitude": -73.57,
      "airportCodes": [
        "YUL"
      ],
      "primaryAirportCode": "YUL",
      "nearestMajorAirport": "YUL",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 4,
      "popularityScore": 4,
      "hiddenGemScore": 2,
      "recommendedMinNights": 2,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "short flight",
        "regional flight"
      ],
      "suitableTripStyles": [
        "culture",
        "multi-city hub"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "partial",
      "providerConfidence": "medium",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence North American anchor with a simple rail/road relationship to Québec City.",
      "prototypeWarnings": [],
      "sourceRegistryId": "montreal-ca",
      "agodaCityId": 9933,
      "travelpayoutsCityCode": "YUL"
    },
    {
      "id": "osaka-jp",
      "city": "Osaka",
      "country": "Japan",
      "canonicalRegion": "Asia",
      "latitude": 34.43,
      "longitude": 135.24,
      "airportCodes": [
        "KIX"
      ],
      "primaryAirportCode": "KIX",
      "nearestMajorAirport": "KIX",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 4,
      "popularityScore": 4,
      "hiddenGemScore": 2,
      "recommendedMinNights": 5,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "short flight",
        "regional flight"
      ],
      "suitableTripStyles": [
        "culture",
        "food",
        "food city",
        "hub",
        "long-haul",
        "multi-city hub",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider Asian anchor selected for the extremely understandable Osaka–Kyoto rail pattern.",
      "prototypeWarnings": [],
      "sourceRegistryId": "osaka-jp",
      "agodaCityId": 9590,
      "travelpayoutsCityCode": "OSA"
    },
    {
      "id": "bangkok-th",
      "city": "Bangkok",
      "country": "Thailand",
      "canonicalRegion": "Asia",
      "latitude": 13.69,
      "longitude": 100.75,
      "airportCodes": [
        "BKK"
      ],
      "primaryAirportCode": "BKK",
      "nearestMajorAirport": "BKK",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 5,
      "popularityScore": 5,
      "hiddenGemScore": 1,
      "recommendedMinNights": 6,
      "recommendedMaxNights": 11,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "short flight",
        "ferry"
      ],
      "suitableTripStyles": [
        "culture",
        "food",
        "long-haul",
        "multi-city hub",
        "value"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider anchor with rail, road and short-flight complements suited to variable trip lengths.",
      "prototypeWarnings": [],
      "sourceRegistryId": "bangkok-th",
      "agodaCityId": 9395,
      "travelpayoutsCityCode": "BKK"
    },
    {
      "id": "istanbul-tr",
      "city": "Istanbul",
      "country": "Turkey",
      "canonicalRegion": "Middle East & North Africa",
      "latitude": 41.28,
      "longitude": 28.75,
      "airportCodes": [
        "IST"
      ],
      "primaryAirportCode": "IST",
      "nearestMajorAirport": "IST",
      "productionStatus": "live",
      "primaryGroup": "group1",
      "canActAsAnchor": true,
      "hubScore": 5,
      "popularityScore": 5,
      "hiddenGemScore": 1,
      "recommendedMinNights": 4,
      "recommendedMaxNights": 7,
      "suggestedTransportTypes": [
        "ferry",
        "road",
        "short flight",
        "rail",
        "regional flight"
      ],
      "suitableTripStyles": [
        "culture",
        "food",
        "historic",
        "historic hub",
        "hub",
        "multi-city hub",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Major international or regional destination with practical airport/rail connectivity, hotel depth and enough recognition to begin or end a multi-city itinerary.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider MENA anchor with practical short-flight, ferry and road complements.",
      "prototypeWarnings": [],
      "sourceRegistryId": "istanbul-tr",
      "agodaCityId": 14932,
      "travelpayoutsCityCode": "IST"
    },
    {
      "id": "porto-pt",
      "city": "Porto",
      "country": "Portugal",
      "canonicalRegion": "Europe",
      "latitude": 41.16,
      "longitude": -8.63,
      "airportCodes": [
        "OPO"
      ],
      "primaryAirportCode": "OPO",
      "nearestMajorAirport": "OPO",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 3,
      "recommendedMinNights": 4,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "rail",
        "short flight"
      ],
      "suitableTripStyles": [
        "coast",
        "food",
        "multi-city complement",
        "value",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider complement that makes Lisbon–Porto an easy trust-building rail tour.",
      "prototypeWarnings": [],
      "sourceRegistryId": "porto-pt",
      "agodaCityId": 8738,
      "travelpayoutsCityCode": "OPO"
    },
    {
      "id": "coimbra-pt",
      "city": "Coimbra",
      "country": "Portugal",
      "canonicalRegion": "Europe",
      "latitude": 40.203,
      "longitude": -8.41,
      "airportCodes": [],
      "primaryAirportCode": null,
      "nearestMajorAirport": "OPO",
      "productionStatus": "candidate",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 2,
      "popularityScore": 3,
      "hiddenGemScore": 4,
      "recommendedMinNights": 2,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "short flight"
      ],
      "suitableTripStyles": [
        "culture",
        "hidden gem",
        "historic city",
        "multi-city complement",
        "rail-friendly"
      ],
      "flightProviderStatus": "candidate-nearest-major-airport-only-needs-validation",
      "hotelProviderStatus": "candidate-unverified-no-agoda-id",
      "providerConfidence": "low",
      "classificationConfidence": "medium",
      "classificationReason": "Land-access or gateway-dependent destination best used as a short complementary stop from a nearby anchor; transport and provider details require manual review.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "Medium-confidence university and heritage stop that enables one carefully limited three-city Lisbon–Coimbra–Porto rail prototype.",
      "prototypeWarnings": [
        "Provider confidence is below medium; keep fixture-only and require provider review before any live experiment."
      ],
      "sourceRegistryId": "coimbra-pt",
      "agodaCityId": null,
      "travelpayoutsCityCode": null
    },
    {
      "id": "lyon-fr",
      "city": "Lyon",
      "country": "France",
      "canonicalRegion": "Europe",
      "latitude": 45.76,
      "longitude": 4.84,
      "airportCodes": [
        "LYS"
      ],
      "primaryAirportCode": "LYS",
      "nearestMajorAirport": "LYS",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 3,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 5,
      "suggestedTransportTypes": [
        "rail",
        "short flight"
      ],
      "suitableTripStyles": [
        "culture",
        "food",
        "food city",
        "hub",
        "multi-city complement",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "partial",
      "providerConfidence": "medium",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence live complement with a clear Paris rail relationship and strong food/culture value.",
      "prototypeWarnings": [],
      "sourceRegistryId": "lyon-fr",
      "agodaCityId": 11361,
      "travelpayoutsCityCode": "LYS"
    },
    {
      "id": "strasbourg-fr",
      "city": "Strasbourg",
      "country": "France",
      "canonicalRegion": "Europe",
      "latitude": 48.583148,
      "longitude": 7.747882,
      "airportCodes": [
        "SXB"
      ],
      "primaryAirportCode": "SXB",
      "nearestMajorAirport": "SXB",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "short flight"
      ],
      "suitableTripStyles": [
        "city",
        "culture",
        "culture and walkable city break",
        "history",
        "multi-city complement",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence live complement with strong provider coverage and a practical medium-confidence connection from Paris.",
      "prototypeWarnings": [],
      "sourceRegistryId": "strasbourg-fr",
      "agodaCityId": 7254,
      "travelpayoutsCityCode": "SXB"
    },
    {
      "id": "florence-it",
      "city": "Florence",
      "country": "Italy",
      "canonicalRegion": "Europe",
      "latitude": 43.7687324,
      "longitude": 11.2569013,
      "airportCodes": [
        "FLR"
      ],
      "primaryAirportCode": "FLR",
      "nearestMajorAirport": "FLR",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 3,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "rail",
        "road"
      ],
      "suitableTripStyles": [
        "art",
        "art and food city break",
        "food",
        "history",
        "multi-city complement",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "medium",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "Classic high-confidence complement for a familiar Rome–Florence rail option used as a trust baseline.",
      "prototypeWarnings": [],
      "sourceRegistryId": "florence-it",
      "agodaCityId": 16573,
      "travelpayoutsCityCode": "FLR"
    },
    {
      "id": "bari-it",
      "city": "Bari",
      "country": "Italy",
      "canonicalRegion": "Europe",
      "latitude": 41.1259998,
      "longitude": 16.8683784,
      "airportCodes": [
        "BRI"
      ],
      "primaryAirportCode": "BRI",
      "nearestMajorAirport": "BRI",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "road",
        "short flight"
      ],
      "suitableTripStyles": [
        "city",
        "culture",
        "culture and walkable city break",
        "history",
        "multi-city complement",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider southern Italy complement that adds a less-obvious but realistic option from Rome.",
      "prototypeWarnings": [],
      "sourceRegistryId": "bari-it",
      "agodaCityId": 4094,
      "travelpayoutsCityCode": "BRI"
    },
    {
      "id": "valencia-es",
      "city": "Valencia",
      "country": "Spain",
      "canonicalRegion": "Europe",
      "latitude": 39.49,
      "longitude": -0.48,
      "airportCodes": [
        "VLC"
      ],
      "primaryAirportCode": "VLC",
      "nearestMajorAirport": "VLC",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 3,
      "recommendedMinNights": 4,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "rail",
        "road"
      ],
      "suitableTripStyles": [
        "coast",
        "coast city",
        "culture",
        "food",
        "multi-city complement",
        "value",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "partial",
      "providerConfidence": "medium",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence live complement with a clear Barcelona rail pairing and strong coast/culture variety.",
      "prototypeWarnings": [],
      "sourceRegistryId": "valencia-es",
      "agodaCityId": 1623,
      "travelpayoutsCityCode": "VLC"
    },
    {
      "id": "girona-es",
      "city": "Girona",
      "country": "Spain",
      "canonicalRegion": "Europe",
      "latitude": 41.979,
      "longitude": 2.821,
      "airportCodes": [
        "GRO"
      ],
      "primaryAirportCode": "GRO",
      "nearestMajorAirport": "BCN",
      "productionStatus": "candidate",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 3,
      "hiddenGemScore": 4,
      "recommendedMinNights": 2,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "rail",
        "road"
      ],
      "suitableTripStyles": [
        "culture",
        "hidden gem",
        "historic city",
        "multi-city complement",
        "rail-friendly"
      ],
      "flightProviderStatus": "candidate-airport-code-present-needs-provider-validation",
      "hotelProviderStatus": "candidate-unverified-no-agoda-id",
      "providerConfidence": "low",
      "classificationConfidence": "medium",
      "classificationReason": "Secondary cultural, coastal, regional or nature destination with access through its own airport but stronger product value when paired with an established anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "Medium-confidence discovery complement with a high-confidence short rail pairing; retained despite lower provider confidence for product-learning value.",
      "prototypeWarnings": [
        "Provider confidence is below medium; keep fixture-only and require provider review before any live experiment."
      ],
      "sourceRegistryId": "girona-es",
      "agodaCityId": null,
      "travelpayoutsCityCode": "GRO"
    },
    {
      "id": "puebla-mx",
      "city": "Puebla",
      "country": "Mexico",
      "canonicalRegion": "Latin America & Caribbean",
      "latitude": 19.135,
      "longitude": -98.3675,
      "airportCodes": [
        "PBC"
      ],
      "primaryAirportCode": "PBC",
      "nearestMajorAirport": "PBC",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "road"
      ],
      "suitableTripStyles": [
        "coast",
        "culture",
        "culture, coast, and value travel",
        "food",
        "multi-city complement",
        "value"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence live complement and the simplest familiar road pairing from Mexico City.",
      "prototypeWarnings": [],
      "sourceRegistryId": "puebla-mx",
      "agodaCityId": 78569,
      "travelpayoutsCityCode": "PBC"
    },
    {
      "id": "oaxaca-mx",
      "city": "Oaxaca",
      "country": "Mexico",
      "canonicalRegion": "Latin America & Caribbean",
      "latitude": 17.000883,
      "longitude": -96.721634,
      "airportCodes": [
        "OAX"
      ],
      "primaryAirportCode": "OAX",
      "nearestMajorAirport": "OAX",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "short flight"
      ],
      "suitableTripStyles": [
        "coast",
        "culture",
        "culture, coast, and value travel",
        "food",
        "multi-city complement",
        "value"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider cultural complement that offers a more surprising domestic route.",
      "prototypeWarnings": [],
      "sourceRegistryId": "oaxaca-mx",
      "agodaCityId": 79553,
      "travelpayoutsCityCode": "OAX"
    },
    {
      "id": "merida-mx",
      "city": "Merida",
      "country": "Mexico",
      "canonicalRegion": "Latin America & Caribbean",
      "latitude": 20.933823,
      "longitude": -89.66375,
      "airportCodes": [
        "MID"
      ],
      "primaryAirportCode": "MID",
      "nearestMajorAirport": "MID",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "road",
        "regional flight"
      ],
      "suitableTripStyles": [
        "coast",
        "culture",
        "culture, coast, and value travel",
        "food",
        "multi-city complement",
        "value"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider complement that adds a distinct Yucatán option while remaining a valid regional-flight pairing.",
      "prototypeWarnings": [],
      "sourceRegistryId": "merida-mx",
      "agodaCityId": 15697,
      "travelpayoutsCityCode": "MID"
    },
    {
      "id": "cartagena-co",
      "city": "Cartagena",
      "country": "Colombia",
      "canonicalRegion": "Latin America & Caribbean",
      "latitude": 10.44,
      "longitude": -75.51,
      "airportCodes": [
        "CTG"
      ],
      "primaryAirportCode": "CTG",
      "nearestMajorAirport": "CTG",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 3,
      "hiddenGemScore": 4,
      "recommendedMinNights": 4,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "short flight"
      ],
      "suitableTripStyles": [
        "coast",
        "coast culture",
        "culture",
        "food",
        "multi-city complement",
        "value",
        "walkable"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider complement that provides a recognizable Colombia two-city option.",
      "prototypeWarnings": [],
      "sourceRegistryId": "cartagena-co",
      "agodaCityId": 10838,
      "travelpayoutsCityCode": "CTG"
    },
    {
      "id": "santa-marta-co",
      "city": "Santa Marta",
      "country": "Colombia",
      "canonicalRegion": "Latin America & Caribbean",
      "latitude": 11.117132,
      "longitude": -74.232704,
      "airportCodes": [
        "SMR"
      ],
      "primaryAirportCode": "SMR",
      "nearestMajorAirport": "SMR",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "short flight",
        "regional flight"
      ],
      "suitableTripStyles": [
        "coast",
        "culture",
        "culture, coast, and value travel",
        "food",
        "multi-city complement",
        "value"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider complement that offers a less-obvious coast/nature alternative to Cartagena.",
      "prototypeWarnings": [],
      "sourceRegistryId": "santa-marta-co",
      "agodaCityId": 7678,
      "travelpayoutsCityCode": "SMR"
    },
    {
      "id": "quebec-city-ca",
      "city": "Quebec City",
      "country": "Canada",
      "canonicalRegion": "North America",
      "latitude": 46.81,
      "longitude": -71.21,
      "airportCodes": [
        "YQB"
      ],
      "primaryAirportCode": "YQB",
      "nearestMajorAirport": "YQB",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 2,
      "popularityScore": 4,
      "hiddenGemScore": 3,
      "recommendedMinNights": 2,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "short flight"
      ],
      "suitableTripStyles": [
        "historic",
        "multi-city complement"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "partial",
      "providerConfidence": "medium",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence complement with medium provider confidence and a straightforward Montreal pairing.",
      "prototypeWarnings": [],
      "sourceRegistryId": "quebec-city-ca",
      "agodaCityId": 16644,
      "travelpayoutsCityCode": "YQB"
    },
    {
      "id": "kyoto-jp",
      "city": "Kyoto",
      "country": "Japan",
      "canonicalRegion": "Asia",
      "latitude": 35.012,
      "longitude": 135.768,
      "airportCodes": [],
      "primaryAirportCode": null,
      "nearestMajorAirport": "KIX",
      "productionStatus": "candidate",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 2,
      "popularityScore": 3,
      "hiddenGemScore": 4,
      "recommendedMinNights": 2,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "rail",
        "road"
      ],
      "suitableTripStyles": [
        "culture",
        "hidden gem",
        "historic city",
        "multi-city complement",
        "rail-friendly"
      ],
      "flightProviderStatus": "candidate-nearest-major-airport-only-needs-validation",
      "hotelProviderStatus": "candidate-unverified-no-agoda-id",
      "providerConfidence": "low",
      "classificationConfidence": "medium",
      "classificationReason": "Land-access or gateway-dependent destination best used as a short complementary stop from a nearby anchor; transport and provider details require manual review.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "Medium-confidence complement with a high-confidence rail pairing; lower provider confidence is clearly retained as a review flag.",
      "prototypeWarnings": [
        "Provider confidence is below medium; keep fixture-only and require provider review before any live experiment."
      ],
      "sourceRegistryId": "kyoto-jp",
      "agodaCityId": null,
      "travelpayoutsCityCode": null
    },
    {
      "id": "chiang-mai-th",
      "city": "Chiang Mai",
      "country": "Thailand",
      "canonicalRegion": "Asia",
      "latitude": 18.769573,
      "longitude": 98.96841,
      "airportCodes": [
        "CNX"
      ],
      "primaryAirportCode": "CNX",
      "nearestMajorAirport": "CNX",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 5,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "short flight",
        "rail",
        "regional flight"
      ],
      "suitableTripStyles": [
        "culture",
        "food",
        "food, culture, and long-haul discovery",
        "long-haul",
        "multi-city complement",
        "value"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider complement and a familiar domestic Thailand pairing.",
      "prototypeWarnings": [],
      "sourceRegistryId": "chiang-mai-th",
      "agodaCityId": 7401,
      "travelpayoutsCityCode": "CNX"
    },
    {
      "id": "krabi-th",
      "city": "Krabi",
      "country": "Thailand",
      "canonicalRegion": "Asia",
      "latitude": 8.097281,
      "longitude": 98.98062,
      "airportCodes": [
        "KBV"
      ],
      "primaryAirportCode": "KBV",
      "nearestMajorAirport": "KBV",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 5,
      "recommendedMaxNights": 6,
      "suggestedTransportTypes": [
        "short flight"
      ],
      "suitableTripStyles": [
        "culture",
        "food",
        "food, culture, and long-haul discovery",
        "long-haul",
        "multi-city complement",
        "value"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider coastal complement that creates a realistic discovery alternative to Chiang Mai.",
      "prototypeWarnings": [],
      "sourceRegistryId": "krabi-th",
      "agodaCityId": 14865,
      "travelpayoutsCityCode": "KBV"
    },
    {
      "id": "ayutthaya-th",
      "city": "Ayutthaya",
      "country": "Thailand",
      "canonicalRegion": "Asia",
      "latitude": 14.353,
      "longitude": 100.568,
      "airportCodes": [],
      "primaryAirportCode": null,
      "nearestMajorAirport": "BKK",
      "productionStatus": "candidate",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 2,
      "popularityScore": 3,
      "hiddenGemScore": 4,
      "recommendedMinNights": 2,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "rail",
        "road",
        "regional flight"
      ],
      "suitableTripStyles": [
        "culture",
        "hidden gem",
        "historic city",
        "multi-city complement",
        "rail-friendly"
      ],
      "flightProviderStatus": "candidate-nearest-major-airport-only-needs-validation",
      "hotelProviderStatus": "candidate-unverified-no-agoda-id",
      "providerConfidence": "low",
      "classificationConfidence": "medium",
      "classificationReason": "Land-access or gateway-dependent destination best used as a short complementary stop from a nearby anchor; transport and provider details require manual review.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "Medium-confidence heritage complement with a high-confidence rail/road pairing and strong short-trip discovery value.",
      "prototypeWarnings": [
        "Provider confidence is below medium; keep fixture-only and require provider review before any live experiment."
      ],
      "sourceRegistryId": "ayutthaya-th",
      "agodaCityId": null,
      "travelpayoutsCityCode": null
    },
    {
      "id": "goreme-tr",
      "city": "Goreme",
      "country": "Turkey",
      "canonicalRegion": "Middle East & North Africa",
      "latitude": 38.644,
      "longitude": 34.829,
      "airportCodes": [
        "NAV",
        "ASR"
      ],
      "primaryAirportCode": "NAV",
      "nearestMajorAirport": "IST",
      "productionStatus": "candidate",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 3,
      "hiddenGemScore": 4,
      "recommendedMinNights": 2,
      "recommendedMaxNights": 5,
      "suggestedTransportTypes": [
        "short flight",
        "road"
      ],
      "suitableTripStyles": [
        "coast or landscape",
        "hidden gem",
        "multi-city complement",
        "nature",
        "slow travel"
      ],
      "flightProviderStatus": "candidate-airport-code-present-needs-provider-validation",
      "hotelProviderStatus": "candidate-unverified-no-agoda-id",
      "providerConfidence": "low",
      "classificationConfidence": "medium",
      "classificationReason": "Secondary cultural, coastal, regional or nature destination with access through its own airport but stronger product value when paired with an established anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "Medium-confidence Cappadocia-area complement with a high-confidence Istanbul pairing; lower provider confidence remains visibly flagged.",
      "prototypeWarnings": [
        "Provider confidence is below medium; keep fixture-only and require provider review before any live experiment."
      ],
      "sourceRegistryId": "goreme-tr",
      "agodaCityId": null,
      "travelpayoutsCityCode": "NAV"
    },
    {
      "id": "izmir-tr",
      "city": "Izmir",
      "country": "Turkey",
      "canonicalRegion": "Middle East & North Africa",
      "latitude": 38.29,
      "longitude": 27.16,
      "airportCodes": [
        "ADB"
      ],
      "primaryAirportCode": "ADB",
      "nearestMajorAirport": "ADB",
      "productionStatus": "live",
      "primaryGroup": "group2",
      "canActAsAnchor": false,
      "hubScore": 3,
      "popularityScore": 4,
      "hiddenGemScore": 4,
      "recommendedMinNights": 3,
      "recommendedMaxNights": 4,
      "suggestedTransportTypes": [
        "short flight"
      ],
      "suitableTripStyles": [
        "culture",
        "food",
        "historic culture and warm-weather escape",
        "history",
        "multi-city complement",
        "warm-weather"
      ],
      "flightProviderStatus": "strong",
      "hotelProviderStatus": "strong",
      "providerConfidence": "high",
      "classificationConfidence": "high",
      "classificationReason": "Strong standalone appeal, but more useful in Globevoy as a secondary cultural, coastal, resort, nature or regional stop paired with a stronger arrival/departure anchor.",
      "productReviewStatus": "selected-for-offline-prototype-review",
      "prototypeSelectionReason": "High-confidence, high-provider complement providing a stronger-provider alternative to Göreme.",
      "prototypeWarnings": [],
      "sourceRegistryId": "izmir-tr",
      "agodaCityId": 13183,
      "travelpayoutsCityCode": "IZM"
    }
  ],
  "routes": [
    {
      "routeId": "lisbon-porto",
      "canonicalRegion": "Europe",
      "anchorId": "lisbon-pt",
      "complementIds": [
        "porto-pt"
      ],
      "citySequence": [
        "lisbon-pt",
        "porto-pt"
      ],
      "intercityLegs": [
        {
          "fromId": "lisbon-pt",
          "toId": "porto-pt",
          "transportType": "rail",
          "estimateUsd": 65
        },
        {
          "fromId": "porto-pt",
          "toId": "lisbon-pt",
          "transportType": "rail",
          "estimateUsd": 65
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "lisbon-pt",
          "complementId": "porto-pt",
          "pairingConfidence": "high",
          "transportTypes": [
            "rail"
          ]
        }
      ],
      "familiarityTier": "balanced",
      "routeStyles": [
        "culture",
        "food",
        "classic"
      ],
      "surpriseScore": 3,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "A simple rail route with strong provider confidence and clear city contrast.",
      "accommodationNightlyEstimatesUsd": {
        "lisbon-pt": 105,
        "porto-pt": 90
      },
      "windows": [
        {
          "fixtureId": "lisbon-porto--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 409,
          "returnFlightEstimateUsd": 444,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-porto--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 378,
          "returnFlightEstimateUsd": 409,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-porto--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 394,
          "returnFlightEstimateUsd": 426,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-porto--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 300,
          "returnFlightEstimateUsd": 324,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-porto--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 276,
          "returnFlightEstimateUsd": 300,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-porto--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 288,
          "returnFlightEstimateUsd": 312,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "lisbon-coimbra-porto",
      "canonicalRegion": "Europe",
      "anchorId": "lisbon-pt",
      "complementIds": [
        "coimbra-pt",
        "porto-pt"
      ],
      "citySequence": [
        "lisbon-pt",
        "coimbra-pt",
        "porto-pt"
      ],
      "intercityLegs": [
        {
          "fromId": "lisbon-pt",
          "toId": "coimbra-pt",
          "transportType": "rail",
          "estimateUsd": 40
        },
        {
          "fromId": "coimbra-pt",
          "toId": "porto-pt",
          "transportType": "rail",
          "estimateUsd": 45
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "lisbon-pt",
          "complementId": "coimbra-pt",
          "pairingConfidence": "medium",
          "transportTypes": [
            "rail",
            "road"
          ]
        },
        {
          "anchorId": "lisbon-pt",
          "complementId": "porto-pt",
          "pairingConfidence": "high",
          "transportTypes": [
            "rail"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "culture",
        "discovery",
        "history"
      ],
      "surpriseScore": 5,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "The one controlled three-city prototype: a logical northbound Portuguese rail corridor.",
      "accommodationNightlyEstimatesUsd": {
        "lisbon-pt": 105,
        "coimbra-pt": 75,
        "porto-pt": 90
      },
      "windows": [
        {
          "fixtureId": "lisbon-coimbra-porto--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 420,
          "returnFlightEstimateUsd": 454,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-coimbra-porto--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 387,
          "returnFlightEstimateUsd": 419,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-coimbra-porto--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 403,
          "returnFlightEstimateUsd": 437,
          "intercityTransportEstimateUsd": 90,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-coimbra-porto--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 310,
          "returnFlightEstimateUsd": 335,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-coimbra-porto--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 286,
          "returnFlightEstimateUsd": 309,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "lisbon-coimbra-porto--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 298,
          "returnFlightEstimateUsd": 322,
          "intercityTransportEstimateUsd": 90,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "paris-lyon",
      "canonicalRegion": "Europe",
      "anchorId": "paris-fr",
      "complementIds": [
        "lyon-fr"
      ],
      "citySequence": [
        "paris-fr",
        "lyon-fr"
      ],
      "intercityLegs": [
        {
          "fromId": "paris-fr",
          "toId": "lyon-fr",
          "transportType": "rail",
          "estimateUsd": 85
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "paris-fr",
          "complementId": "lyon-fr",
          "pairingConfidence": "high",
          "transportTypes": [
            "rail"
          ]
        }
      ],
      "familiarityTier": "familiar",
      "routeStyles": [
        "culture",
        "food",
        "classic"
      ],
      "surpriseScore": 2,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "A familiar high-trust rail pairing used to calibrate the scoring system.",
      "accommodationNightlyEstimatesUsd": {
        "paris-fr": 160,
        "lyon-fr": 110
      },
      "windows": [
        {
          "fixtureId": "paris-lyon--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 424,
          "returnFlightEstimateUsd": 460,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-lyon--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 392,
          "returnFlightEstimateUsd": 424,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-lyon--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 408,
          "returnFlightEstimateUsd": 442,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-lyon--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 324,
          "returnFlightEstimateUsd": 352,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-lyon--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 300,
          "returnFlightEstimateUsd": 324,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-lyon--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 312,
          "returnFlightEstimateUsd": 338,
          "intercityTransportEstimateUsd": 85,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "paris-strasbourg",
      "canonicalRegion": "Europe",
      "anchorId": "paris-fr",
      "complementIds": [
        "strasbourg-fr"
      ],
      "citySequence": [
        "paris-fr",
        "strasbourg-fr"
      ],
      "intercityLegs": [
        {
          "fromId": "paris-fr",
          "toId": "strasbourg-fr",
          "transportType": "rail",
          "estimateUsd": 95
        },
        {
          "fromId": "strasbourg-fr",
          "toId": "paris-fr",
          "transportType": "rail",
          "estimateUsd": 95
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "paris-fr",
          "complementId": "strasbourg-fr",
          "pairingConfidence": "medium",
          "transportTypes": [
            "short flight"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "culture",
        "food",
        "discovery"
      ],
      "surpriseScore": 4,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "A strong-provider alternative to the most obvious France itinerary.",
      "accommodationNightlyEstimatesUsd": {
        "paris-fr": 160,
        "strasbourg-fr": 115
      },
      "windows": [
        {
          "fixtureId": "paris-strasbourg--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 432,
          "returnFlightEstimateUsd": 468,
          "intercityTransportEstimateUsd": 190,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-strasbourg--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 398,
          "returnFlightEstimateUsd": 432,
          "intercityTransportEstimateUsd": 190,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-strasbourg--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 415,
          "returnFlightEstimateUsd": 450,
          "intercityTransportEstimateUsd": 190,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-strasbourg--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 332,
          "returnFlightEstimateUsd": 360,
          "intercityTransportEstimateUsd": 190,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-strasbourg--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 306,
          "returnFlightEstimateUsd": 332,
          "intercityTransportEstimateUsd": 190,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "paris-strasbourg--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 319,
          "returnFlightEstimateUsd": 346,
          "intercityTransportEstimateUsd": 190,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "rome-florence",
      "canonicalRegion": "Europe",
      "anchorId": "rome-it",
      "complementIds": [
        "florence-it"
      ],
      "citySequence": [
        "rome-it",
        "florence-it"
      ],
      "intercityLegs": [
        {
          "fromId": "rome-it",
          "toId": "florence-it",
          "transportType": "rail",
          "estimateUsd": 70
        },
        {
          "fromId": "florence-it",
          "toId": "rome-it",
          "transportType": "rail",
          "estimateUsd": 70
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "rome-it",
          "complementId": "florence-it",
          "pairingConfidence": "high",
          "transportTypes": [
            "rail"
          ]
        }
      ],
      "familiarityTier": "familiar",
      "routeStyles": [
        "culture",
        "history",
        "classic"
      ],
      "surpriseScore": 2,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "A highly understandable rail pairing that provides a familiar trust option.",
      "accommodationNightlyEstimatesUsd": {
        "rome-it": 145,
        "florence-it": 130
      },
      "windows": [
        {
          "fixtureId": "rome-florence--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 439,
          "returnFlightEstimateUsd": 476,
          "intercityTransportEstimateUsd": 140,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-florence--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 406,
          "returnFlightEstimateUsd": 439,
          "intercityTransportEstimateUsd": 140,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-florence--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 422,
          "returnFlightEstimateUsd": 458,
          "intercityTransportEstimateUsd": 140,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-florence--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 360,
          "returnFlightEstimateUsd": 389,
          "intercityTransportEstimateUsd": 140,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-florence--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 332,
          "returnFlightEstimateUsd": 359,
          "intercityTransportEstimateUsd": 140,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-florence--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 346,
          "returnFlightEstimateUsd": 374,
          "intercityTransportEstimateUsd": 140,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "rome-bari",
      "canonicalRegion": "Europe",
      "anchorId": "rome-it",
      "complementIds": [
        "bari-it"
      ],
      "citySequence": [
        "rome-it",
        "bari-it"
      ],
      "intercityLegs": [
        {
          "fromId": "rome-it",
          "toId": "bari-it",
          "transportType": "short flight",
          "estimateUsd": 130
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "rome-it",
          "complementId": "bari-it",
          "pairingConfidence": "medium",
          "transportTypes": [
            "short flight"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "culture",
        "coast",
        "food",
        "discovery"
      ],
      "surpriseScore": 5,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A less-obvious southern Italy extension with strong destination/provider confidence.",
      "accommodationNightlyEstimatesUsd": {
        "rome-it": 145,
        "bari-it": 90
      },
      "windows": [
        {
          "fixtureId": "rome-bari--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 449,
          "returnFlightEstimateUsd": 487,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-bari--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 415,
          "returnFlightEstimateUsd": 449,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-bari--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 432,
          "returnFlightEstimateUsd": 468,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-bari--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 370,
          "returnFlightEstimateUsd": 400,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-bari--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 341,
          "returnFlightEstimateUsd": 369,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "rome-bari--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 355,
          "returnFlightEstimateUsd": 385,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "barcelona-valencia",
      "canonicalRegion": "Europe",
      "anchorId": "barcelona-es",
      "complementIds": [
        "valencia-es"
      ],
      "citySequence": [
        "barcelona-es",
        "valencia-es"
      ],
      "intercityLegs": [
        {
          "fromId": "barcelona-es",
          "toId": "valencia-es",
          "transportType": "rail",
          "estimateUsd": 70
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "barcelona-es",
          "complementId": "valencia-es",
          "pairingConfidence": "high",
          "transportTypes": [
            "rail"
          ]
        }
      ],
      "familiarityTier": "balanced",
      "routeStyles": [
        "culture",
        "coast",
        "food"
      ],
      "surpriseScore": 3,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "A practical Mediterranean rail pairing with strong city contrast.",
      "accommodationNightlyEstimatesUsd": {
        "barcelona-es": 140,
        "valencia-es": 95
      },
      "windows": [
        {
          "fixtureId": "barcelona-valencia--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 414,
          "returnFlightEstimateUsd": 449,
          "intercityTransportEstimateUsd": 70,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-valencia--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 383,
          "returnFlightEstimateUsd": 414,
          "intercityTransportEstimateUsd": 70,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-valencia--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 398,
          "returnFlightEstimateUsd": 432,
          "intercityTransportEstimateUsd": 70,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-valencia--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 339,
          "returnFlightEstimateUsd": 368,
          "intercityTransportEstimateUsd": 70,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-valencia--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 313,
          "returnFlightEstimateUsd": 340,
          "intercityTransportEstimateUsd": 70,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-valencia--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 326,
          "returnFlightEstimateUsd": 354,
          "intercityTransportEstimateUsd": 70,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "barcelona-girona",
      "canonicalRegion": "Europe",
      "anchorId": "barcelona-es",
      "complementIds": [
        "girona-es"
      ],
      "citySequence": [
        "barcelona-es",
        "girona-es"
      ],
      "intercityLegs": [
        {
          "fromId": "barcelona-es",
          "toId": "girona-es",
          "transportType": "rail",
          "estimateUsd": 35
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "barcelona-es",
          "complementId": "girona-es",
          "pairingConfidence": "high",
          "transportTypes": [
            "rail"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "culture",
        "history",
        "discovery"
      ],
      "surpriseScore": 4,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "A short, coherent discovery route that tests whether a smaller complement improves the product.",
      "accommodationNightlyEstimatesUsd": {
        "barcelona-es": 140,
        "girona-es": 100
      },
      "windows": [
        {
          "fixtureId": "barcelona-girona--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 409,
          "returnFlightEstimateUsd": 444,
          "intercityTransportEstimateUsd": 35,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-girona--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 378,
          "returnFlightEstimateUsd": 409,
          "intercityTransportEstimateUsd": 35,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-girona--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 394,
          "returnFlightEstimateUsd": 426,
          "intercityTransportEstimateUsd": 35,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-girona--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 335,
          "returnFlightEstimateUsd": 362,
          "intercityTransportEstimateUsd": 35,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-girona--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 309,
          "returnFlightEstimateUsd": 334,
          "intercityTransportEstimateUsd": 35,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "barcelona-girona--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 322,
          "returnFlightEstimateUsd": 348,
          "intercityTransportEstimateUsd": 35,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "mexico-city-puebla",
      "canonicalRegion": "Latin America & Caribbean",
      "anchorId": "mexico-city-mx",
      "complementIds": [
        "puebla-mx"
      ],
      "citySequence": [
        "mexico-city-mx",
        "puebla-mx"
      ],
      "intercityLegs": [
        {
          "fromId": "mexico-city-mx",
          "toId": "puebla-mx",
          "transportType": "road",
          "estimateUsd": 40
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "mexico-city-mx",
          "complementId": "puebla-mx",
          "pairingConfidence": "high",
          "transportTypes": [
            "road"
          ]
        }
      ],
      "familiarityTier": "familiar",
      "routeStyles": [
        "culture",
        "food",
        "classic"
      ],
      "surpriseScore": 2,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "The clearest road-based Mexico pairing and a trust-building Latin option.",
      "accommodationNightlyEstimatesUsd": {
        "mexico-city-mx": 105,
        "puebla-mx": 70
      },
      "windows": [
        {
          "fixtureId": "mexico-city-puebla--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 324,
          "returnFlightEstimateUsd": 352,
          "intercityTransportEstimateUsd": 40,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-puebla--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 300,
          "returnFlightEstimateUsd": 324,
          "intercityTransportEstimateUsd": 40,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-puebla--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 312,
          "returnFlightEstimateUsd": 338,
          "intercityTransportEstimateUsd": 40,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-puebla--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 260,
          "returnFlightEstimateUsd": 281,
          "intercityTransportEstimateUsd": 40,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-puebla--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 240,
          "returnFlightEstimateUsd": 259,
          "intercityTransportEstimateUsd": 40,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-puebla--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 250,
          "returnFlightEstimateUsd": 270,
          "intercityTransportEstimateUsd": 40,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "mexico-city-oaxaca",
      "canonicalRegion": "Latin America & Caribbean",
      "anchorId": "mexico-city-mx",
      "complementIds": [
        "oaxaca-mx"
      ],
      "citySequence": [
        "mexico-city-mx",
        "oaxaca-mx"
      ],
      "intercityLegs": [
        {
          "fromId": "mexico-city-mx",
          "toId": "oaxaca-mx",
          "transportType": "short flight",
          "estimateUsd": 110
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "mexico-city-mx",
          "complementId": "oaxaca-mx",
          "pairingConfidence": "medium",
          "transportTypes": [
            "short flight"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "culture",
        "food",
        "discovery"
      ],
      "surpriseScore": 5,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A strong-provider cultural route with more discovery value than the obvious option.",
      "accommodationNightlyEstimatesUsd": {
        "mexico-city-mx": 105,
        "oaxaca-mx": 80
      },
      "windows": [
        {
          "fixtureId": "mexico-city-oaxaca--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 337,
          "returnFlightEstimateUsd": 365,
          "intercityTransportEstimateUsd": 110,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-oaxaca--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 311,
          "returnFlightEstimateUsd": 337,
          "intercityTransportEstimateUsd": 110,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-oaxaca--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 324,
          "returnFlightEstimateUsd": 351,
          "intercityTransportEstimateUsd": 110,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-oaxaca--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 272,
          "returnFlightEstimateUsd": 295,
          "intercityTransportEstimateUsd": 110,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-oaxaca--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 251,
          "returnFlightEstimateUsd": 272,
          "intercityTransportEstimateUsd": 110,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-oaxaca--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 262,
          "returnFlightEstimateUsd": 283,
          "intercityTransportEstimateUsd": 110,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "mexico-city-merida",
      "canonicalRegion": "Latin America & Caribbean",
      "anchorId": "mexico-city-mx",
      "complementIds": [
        "merida-mx"
      ],
      "citySequence": [
        "mexico-city-mx",
        "merida-mx"
      ],
      "intercityLegs": [
        {
          "fromId": "mexico-city-mx",
          "toId": "merida-mx",
          "transportType": "regional flight",
          "estimateUsd": 170
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "mexico-city-mx",
          "complementId": "merida-mx",
          "pairingConfidence": "medium",
          "transportTypes": [
            "regional flight"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "culture",
        "food",
        "discovery"
      ],
      "surpriseScore": 5,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A regionally coherent Yucatán extension that creates a clearly different Mexico tour.",
      "accommodationNightlyEstimatesUsd": {
        "mexico-city-mx": 105,
        "merida-mx": 75
      },
      "windows": [
        {
          "fixtureId": "mexico-city-merida--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 347,
          "returnFlightEstimateUsd": 376,
          "intercityTransportEstimateUsd": 170,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-merida--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 320,
          "returnFlightEstimateUsd": 347,
          "intercityTransportEstimateUsd": 170,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-merida--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 334,
          "returnFlightEstimateUsd": 361,
          "intercityTransportEstimateUsd": 170,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-merida--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 282,
          "returnFlightEstimateUsd": 306,
          "intercityTransportEstimateUsd": 170,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-merida--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 260,
          "returnFlightEstimateUsd": 282,
          "intercityTransportEstimateUsd": 170,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "mexico-city-merida--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 271,
          "returnFlightEstimateUsd": 294,
          "intercityTransportEstimateUsd": 170,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "bogota-cartagena",
      "canonicalRegion": "Latin America & Caribbean",
      "anchorId": "bogota-co",
      "complementIds": [
        "cartagena-co"
      ],
      "citySequence": [
        "bogota-co",
        "cartagena-co"
      ],
      "intercityLegs": [
        {
          "fromId": "bogota-co",
          "toId": "cartagena-co",
          "transportType": "short flight",
          "estimateUsd": 130
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "bogota-co",
          "complementId": "cartagena-co",
          "pairingConfidence": "medium",
          "transportTypes": [
            "short flight"
          ]
        }
      ],
      "familiarityTier": "balanced",
      "routeStyles": [
        "culture",
        "coast",
        "classic"
      ],
      "surpriseScore": 3,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A recognizable Colombia pairing with strong provider confidence at both ends.",
      "accommodationNightlyEstimatesUsd": {
        "bogota-co": 85,
        "cartagena-co": 110
      },
      "windows": [
        {
          "fixtureId": "bogota-cartagena--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 389,
          "returnFlightEstimateUsd": 422,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-cartagena--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 360,
          "returnFlightEstimateUsd": 389,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-cartagena--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 374,
          "returnFlightEstimateUsd": 406,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-cartagena--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 300,
          "returnFlightEstimateUsd": 324,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-cartagena--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 276,
          "returnFlightEstimateUsd": 300,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-cartagena--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 288,
          "returnFlightEstimateUsd": 312,
          "intercityTransportEstimateUsd": 130,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "bogota-santa-marta",
      "canonicalRegion": "Latin America & Caribbean",
      "anchorId": "bogota-co",
      "complementIds": [
        "santa-marta-co"
      ],
      "citySequence": [
        "bogota-co",
        "santa-marta-co"
      ],
      "intercityLegs": [
        {
          "fromId": "bogota-co",
          "toId": "santa-marta-co",
          "transportType": "regional flight",
          "estimateUsd": 150
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "bogota-co",
          "complementId": "santa-marta-co",
          "pairingConfidence": "medium",
          "transportTypes": [
            "regional flight"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "coast",
        "nature",
        "discovery"
      ],
      "surpriseScore": 5,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A less-obvious Colombia coast/nature option with strong provider coverage.",
      "accommodationNightlyEstimatesUsd": {
        "bogota-co": 85,
        "santa-marta-co": 90
      },
      "windows": [
        {
          "fixtureId": "bogota-santa-marta--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 399,
          "returnFlightEstimateUsd": 433,
          "intercityTransportEstimateUsd": 150,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-santa-marta--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 369,
          "returnFlightEstimateUsd": 399,
          "intercityTransportEstimateUsd": 150,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-santa-marta--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 384,
          "returnFlightEstimateUsd": 416,
          "intercityTransportEstimateUsd": 150,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-santa-marta--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 310,
          "returnFlightEstimateUsd": 335,
          "intercityTransportEstimateUsd": 150,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-santa-marta--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 286,
          "returnFlightEstimateUsd": 309,
          "intercityTransportEstimateUsd": 150,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bogota-santa-marta--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 298,
          "returnFlightEstimateUsd": 322,
          "intercityTransportEstimateUsd": 150,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "montreal-quebec-city",
      "canonicalRegion": "North America",
      "anchorId": "montreal-ca",
      "complementIds": [
        "quebec-city-ca"
      ],
      "citySequence": [
        "montreal-ca",
        "quebec-city-ca"
      ],
      "intercityLegs": [
        {
          "fromId": "montreal-ca",
          "toId": "quebec-city-ca",
          "transportType": "rail",
          "estimateUsd": 80
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "montreal-ca",
          "complementId": "quebec-city-ca",
          "pairingConfidence": "high",
          "transportTypes": [
            "rail",
            "road"
          ]
        }
      ],
      "familiarityTier": "familiar",
      "routeStyles": [
        "culture",
        "food",
        "classic"
      ],
      "surpriseScore": 2,
      "routeCoherenceScore": 5,
      "whyRouteWasIncluded": "A simple North American rail corridor that is easy to explain and validate.",
      "accommodationNightlyEstimatesUsd": {
        "montreal-ca": 140,
        "quebec-city-ca": 125
      },
      "windows": [
        {
          "fixtureId": "montreal-quebec-city--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 150,
          "returnFlightEstimateUsd": 162,
          "intercityTransportEstimateUsd": 80,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "montreal-quebec-city--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 138,
          "returnFlightEstimateUsd": 150,
          "intercityTransportEstimateUsd": 80,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "montreal-quebec-city--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 144,
          "returnFlightEstimateUsd": 156,
          "intercityTransportEstimateUsd": 80,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "montreal-quebec-city--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 140,
          "returnFlightEstimateUsd": 151,
          "intercityTransportEstimateUsd": 80,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "montreal-quebec-city--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 129,
          "returnFlightEstimateUsd": 140,
          "intercityTransportEstimateUsd": 80,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "montreal-quebec-city--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 134,
          "returnFlightEstimateUsd": 146,
          "intercityTransportEstimateUsd": 80,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "bangkok-chiang-mai",
      "canonicalRegion": "Asia",
      "anchorId": "bangkok-th",
      "complementIds": [
        "chiang-mai-th"
      ],
      "citySequence": [
        "bangkok-th",
        "chiang-mai-th"
      ],
      "intercityLegs": [
        {
          "fromId": "bangkok-th",
          "toId": "chiang-mai-th",
          "transportType": "short flight",
          "estimateUsd": 95
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "bangkok-th",
          "complementId": "chiang-mai-th",
          "pairingConfidence": "high",
          "transportTypes": [
            "short flight",
            "rail"
          ]
        }
      ],
      "familiarityTier": "familiar",
      "routeStyles": [
        "culture",
        "food",
        "classic"
      ],
      "surpriseScore": 3,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A recognizable Thailand pairing with strong provider confidence.",
      "accommodationNightlyEstimatesUsd": {
        "bangkok-th": 85,
        "chiang-mai-th": 60
      },
      "windows": [
        {
          "fixtureId": "bangkok-chiang-mai--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 749,
          "returnFlightEstimateUsd": 811,
          "intercityTransportEstimateUsd": 95,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-chiang-mai--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 691,
          "returnFlightEstimateUsd": 749,
          "intercityTransportEstimateUsd": 95,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-chiang-mai--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 720,
          "returnFlightEstimateUsd": 780,
          "intercityTransportEstimateUsd": 95,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-chiang-mai--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 674,
          "returnFlightEstimateUsd": 730,
          "intercityTransportEstimateUsd": 95,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-chiang-mai--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 622,
          "returnFlightEstimateUsd": 674,
          "intercityTransportEstimateUsd": 95,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-chiang-mai--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 648,
          "returnFlightEstimateUsd": 702,
          "intercityTransportEstimateUsd": 95,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "bangkok-krabi",
      "canonicalRegion": "Asia",
      "anchorId": "bangkok-th",
      "complementIds": [
        "krabi-th"
      ],
      "citySequence": [
        "bangkok-th",
        "krabi-th"
      ],
      "intercityLegs": [
        {
          "fromId": "bangkok-th",
          "toId": "krabi-th",
          "transportType": "short flight",
          "estimateUsd": 120
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "bangkok-th",
          "complementId": "krabi-th",
          "pairingConfidence": "medium",
          "transportTypes": [
            "short flight"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "coast",
        "nature",
        "discovery"
      ],
      "surpriseScore": 5,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A coast-focused discovery option that differs clearly from northern Thailand.",
      "accommodationNightlyEstimatesUsd": {
        "bangkok-th": 85,
        "krabi-th": 90
      },
      "windows": [
        {
          "fixtureId": "bangkok-krabi--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 761,
          "returnFlightEstimateUsd": 825,
          "intercityTransportEstimateUsd": 120,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-krabi--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 703,
          "returnFlightEstimateUsd": 761,
          "intercityTransportEstimateUsd": 120,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-krabi--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 732,
          "returnFlightEstimateUsd": 793,
          "intercityTransportEstimateUsd": 120,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-krabi--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-03",
          "returnDate": "2026-11-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 686,
          "returnFlightEstimateUsd": 744,
          "intercityTransportEstimateUsd": 120,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-krabi--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-12",
          "returnDate": "2026-11-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 634,
          "returnFlightEstimateUsd": 686,
          "intercityTransportEstimateUsd": 120,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "bangkok-krabi--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-11",
          "departureDate": "2026-11-20",
          "returnDate": "2026-12-01",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 660,
          "returnFlightEstimateUsd": 715,
          "intercityTransportEstimateUsd": 120,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "istanbul-goreme",
      "canonicalRegion": "Middle East & North Africa",
      "anchorId": "istanbul-tr",
      "complementIds": [
        "goreme-tr"
      ],
      "citySequence": [
        "istanbul-tr",
        "goreme-tr"
      ],
      "intercityLegs": [
        {
          "fromId": "istanbul-tr",
          "toId": "goreme-tr",
          "transportType": "short flight",
          "estimateUsd": 115
        }
      ],
      "pairingConfidence": "high",
      "sourcePairings": [
        {
          "anchorId": "istanbul-tr",
          "complementId": "goreme-tr",
          "pairingConfidence": "high",
          "transportTypes": [
            "short flight",
            "road"
          ]
        }
      ],
      "familiarityTier": "balanced",
      "routeStyles": [
        "culture",
        "history",
        "discovery"
      ],
      "surpriseScore": 5,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A high-confidence Cappadocia-area pattern with clear product appeal and explicit provider caution.",
      "accommodationNightlyEstimatesUsd": {
        "istanbul-tr": 95,
        "goreme-tr": 75
      },
      "windows": [
        {
          "fixtureId": "istanbul-goreme--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 559,
          "returnFlightEstimateUsd": 606,
          "intercityTransportEstimateUsd": 115,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-goreme--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 516,
          "returnFlightEstimateUsd": 559,
          "intercityTransportEstimateUsd": 115,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-goreme--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 538,
          "returnFlightEstimateUsd": 582,
          "intercityTransportEstimateUsd": 115,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-goreme--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 459,
          "returnFlightEstimateUsd": 498,
          "intercityTransportEstimateUsd": 115,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-goreme--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 424,
          "returnFlightEstimateUsd": 459,
          "intercityTransportEstimateUsd": 115,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-goreme--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 442,
          "returnFlightEstimateUsd": 478,
          "intercityTransportEstimateUsd": 115,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    },
    {
      "routeId": "istanbul-izmir",
      "canonicalRegion": "Middle East & North Africa",
      "anchorId": "istanbul-tr",
      "complementIds": [
        "izmir-tr"
      ],
      "citySequence": [
        "istanbul-tr",
        "izmir-tr"
      ],
      "intercityLegs": [
        {
          "fromId": "istanbul-tr",
          "toId": "izmir-tr",
          "transportType": "short flight",
          "estimateUsd": 100
        }
      ],
      "pairingConfidence": "medium",
      "sourcePairings": [
        {
          "anchorId": "istanbul-tr",
          "complementId": "izmir-tr",
          "pairingConfidence": "medium",
          "transportTypes": [
            "short flight"
          ]
        }
      ],
      "familiarityTier": "discovery",
      "routeStyles": [
        "culture",
        "coast",
        "food"
      ],
      "surpriseScore": 4,
      "routeCoherenceScore": 4,
      "whyRouteWasIncluded": "A stronger-provider Aegean alternative that broadens the MENA prototype.",
      "accommodationNightlyEstimatesUsd": {
        "istanbul-tr": 95,
        "izmir-tr": 85
      },
      "windows": [
        {
          "fixtureId": "istanbul-izmir--toronto--7n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 549,
          "returnFlightEstimateUsd": 595,
          "intercityTransportEstimateUsd": 100,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-izmir--toronto--9n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 507,
          "returnFlightEstimateUsd": 549,
          "intercityTransportEstimateUsd": 100,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-izmir--toronto--11n",
          "origin": "Toronto",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 528,
          "returnFlightEstimateUsd": 572,
          "intercityTransportEstimateUsd": 100,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-izmir--new-york--7n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-03",
          "returnDate": "2026-10-10",
          "totalNights": 7,
          "outboundFlightEstimateUsd": 449,
          "returnFlightEstimateUsd": 487,
          "intercityTransportEstimateUsd": 100,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-izmir--new-york--9n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-12",
          "returnDate": "2026-10-21",
          "totalNights": 9,
          "outboundFlightEstimateUsd": 415,
          "returnFlightEstimateUsd": 449,
          "intercityTransportEstimateUsd": 100,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        },
        {
          "fixtureId": "istanbul-izmir--new-york--11n",
          "origin": "New York",
          "preferredMonth": "2026-10",
          "departureDate": "2026-10-20",
          "returnDate": "2026-10-31",
          "totalNights": 11,
          "outboundFlightEstimateUsd": 432,
          "returnFlightEstimateUsd": 468,
          "intercityTransportEstimateUsd": 100,
          "fixtureLabel": "offline deterministic planning fixture; not a live fare or provider quote"
        }
      ]
    }
  ],
  "replayIndex": {
    "lisbon-porto|7|flight": {
      "replayId": "lisbon-porto--7n--flight",
      "routeId": "lisbon-porto",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "LIS",
        "returnOriginCode": "OPO",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-03",
        "returnDate": "2026-10-10",
        "totalNights": 7,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "LIS",
              "departure_at": "2026-10-03T09:00:00Z",
              "value": 567.59,
              "currency": "CAD",
              "trip_duration": 480,
              "ticket_link": "/sanitized/lisbon-porto/7/outbound"
            },
            {
              "direction": "return",
              "origin": "OPO",
              "destination": "YYZ",
              "departure_at": "2026-10-10T10:00:00Z",
              "value": 625.22,
              "currency": "CAD",
              "trip_duration": 500,
              "ticket_link": "/sanitized/lisbon-porto/7/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "lisbon-porto|9|flight": {
      "replayId": "lisbon-porto--9n--flight",
      "routeId": "lisbon-porto",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "LIS",
        "returnOriginCode": "OPO",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-12",
        "returnDate": "2026-10-21",
        "totalNights": 9,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "LIS",
              "departure_at": "2026-10-12T09:00:00Z",
              "value": 504,
              "currency": "CAD",
              "trip_duration": 480,
              "ticket_link": "/sanitized/lisbon-porto/9/outbound"
            },
            {
              "direction": "return",
              "origin": "OPO",
              "destination": "YYZ",
              "departure_at": "2026-10-21T10:00:00Z",
              "value": 553.68,
              "currency": "CAD",
              "trip_duration": 500,
              "ticket_link": "/sanitized/lisbon-porto/9/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "lisbon-porto|11|flight": {
      "replayId": "lisbon-porto--11n--flight",
      "routeId": "lisbon-porto",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "LIS",
        "returnOriginCode": "OPO",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-20",
        "returnDate": "2026-10-31",
        "totalNights": 11,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "LIS",
              "departure_at": "2026-10-20T09:00:00Z",
              "value": 562.86,
              "currency": "CAD",
              "trip_duration": 480,
              "ticket_link": "/sanitized/lisbon-porto/11/outbound"
            },
            {
              "direction": "return",
              "origin": "OPO",
              "destination": "YYZ",
              "departure_at": "2026-10-31T10:00:00Z",
              "value": 617.27,
              "currency": "CAD",
              "trip_duration": 500,
              "ticket_link": "/sanitized/lisbon-porto/11/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "rome-florence|7|flight": {
      "replayId": "rome-florence--7n--flight",
      "routeId": "rome-florence",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "ROM",
        "returnOriginCode": "FLR",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-03",
        "returnDate": "2026-10-10",
        "totalNights": 7,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "ROM",
              "departure_at": "2026-10-03T09:00:00Z",
              "value": 645.06,
              "currency": "CAD",
              "trip_duration": 515,
              "ticket_link": "/sanitized/rome-florence/7/outbound"
            },
            {
              "direction": "return",
              "origin": "FLR",
              "destination": "YYZ",
              "departure_at": "2026-10-10T10:00:00Z",
              "value": 709.14,
              "currency": "CAD",
              "trip_duration": 530,
              "ticket_link": "/sanitized/rome-florence/7/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "rome-florence|9|flight": {
      "replayId": "rome-florence--9n--flight",
      "routeId": "rome-florence",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "ROM",
        "returnOriginCode": "FLR",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-12",
        "returnDate": "2026-10-21",
        "totalNights": 9,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "ROM",
              "departure_at": "2026-10-12T09:00:00Z",
              "value": 568.95,
              "currency": "CAD",
              "trip_duration": 515,
              "ticket_link": "/sanitized/rome-florence/9/outbound"
            },
            {
              "direction": "return",
              "origin": "FLR",
              "destination": "YYZ",
              "departure_at": "2026-10-21T10:00:00Z",
              "value": 624.16,
              "currency": "CAD",
              "trip_duration": 530,
              "ticket_link": "/sanitized/rome-florence/9/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "rome-florence|11|flight": {
      "replayId": "rome-florence--11n--flight",
      "routeId": "rome-florence",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "ROM",
        "returnOriginCode": "FLR",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-20",
        "returnDate": "2026-10-31",
        "totalNights": 11,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "ROM",
              "departure_at": "2026-10-20T09:00:00Z",
              "value": 574.15,
              "currency": "CAD",
              "trip_duration": 515,
              "ticket_link": "/sanitized/rome-florence/11/outbound"
            },
            {
              "direction": "return",
              "origin": "FLR",
              "destination": "YYZ",
              "departure_at": "2026-10-31T10:00:00Z",
              "value": 632.48,
              "currency": "CAD",
              "trip_duration": 530,
              "ticket_link": "/sanitized/rome-florence/11/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "mexico-city-puebla|7|flight": {
      "replayId": "mexico-city-puebla--7n--flight",
      "routeId": "mexico-city-puebla",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "MEX",
        "returnOriginCode": "PBC",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-03",
        "returnDate": "2026-11-10",
        "totalNights": 7,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "MEX",
              "departure_at": "2026-11-03T09:00:00Z",
              "value": 414.37,
              "currency": "CAD",
              "trip_duration": 550,
              "ticket_link": "/sanitized/mexico-city-puebla/7/outbound"
            },
            {
              "direction": "return",
              "origin": "PBC",
              "destination": "YYZ",
              "departure_at": "2026-11-10T10:00:00Z",
              "value": 457.36,
              "currency": "CAD",
              "trip_duration": 560,
              "ticket_link": "/sanitized/mexico-city-puebla/7/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "mexico-city-puebla|9|flight": {
      "replayId": "mexico-city-puebla--9n--flight",
      "routeId": "mexico-city-puebla",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "MEX",
        "returnOriginCode": "PBC",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-12",
        "returnDate": "2026-11-21",
        "totalNights": 9,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "MEX",
              "departure_at": "2026-11-12T09:00:00Z",
              "value": 408.16,
              "currency": "CAD",
              "trip_duration": 550,
              "ticket_link": "/sanitized/mexico-city-puebla/9/outbound"
            },
            {
              "direction": "return",
              "origin": "PBC",
              "destination": "YYZ",
              "departure_at": "2026-11-21T10:00:00Z",
              "value": 447.43,
              "currency": "CAD",
              "trip_duration": 560,
              "ticket_link": "/sanitized/mexico-city-puebla/9/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "mexico-city-puebla|11|flight": {
      "replayId": "mexico-city-puebla--11n--flight",
      "routeId": "mexico-city-puebla",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "MEX",
        "returnOriginCode": "PBC",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-20",
        "returnDate": "2026-12-01",
        "totalNights": 11,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "MEX",
              "departure_at": "2026-11-20T09:00:00Z",
              "value": 411.76,
              "currency": "CAD",
              "trip_duration": 550,
              "ticket_link": "/sanitized/mexico-city-puebla/11/outbound"
            },
            {
              "direction": "return",
              "origin": "PBC",
              "destination": "YYZ",
              "departure_at": "2026-12-01T10:00:00Z",
              "value": 452.97,
              "currency": "CAD",
              "trip_duration": 560,
              "ticket_link": "/sanitized/mexico-city-puebla/11/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "bogota-santa-marta|7|flight": {
      "replayId": "bogota-santa-marta--7n--flight",
      "routeId": "bogota-santa-marta",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "BOG",
        "returnOriginCode": "SMR",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-03",
        "returnDate": "2026-11-10",
        "totalNights": 7,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "BOG",
              "departure_at": "2026-11-03T09:00:00Z",
              "value": 559.14,
              "currency": "CAD",
              "trip_duration": 585,
              "ticket_link": "/sanitized/bogota-santa-marta/7/outbound"
            },
            {
              "direction": "return",
              "origin": "SMR",
              "destination": "YYZ",
              "departure_at": "2026-11-10T10:00:00Z",
              "value": 615.63,
              "currency": "CAD",
              "trip_duration": 590,
              "ticket_link": "/sanitized/bogota-santa-marta/7/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "bogota-santa-marta|9|flight": {
      "replayId": "bogota-santa-marta--9n--flight",
      "routeId": "bogota-santa-marta",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "BOG",
        "returnOriginCode": "SMR",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-12",
        "returnDate": "2026-11-21",
        "totalNights": 9,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "BOG",
              "departure_at": "2026-11-12T09:00:00Z",
              "value": 481.96,
              "currency": "CAD",
              "trip_duration": 585,
              "ticket_link": "/sanitized/bogota-santa-marta/9/outbound"
            },
            {
              "direction": "return",
              "origin": "SMR",
              "destination": "YYZ",
              "departure_at": "2026-11-21T10:00:00Z",
              "value": 529.29,
              "currency": "CAD",
              "trip_duration": 590,
              "ticket_link": "/sanitized/bogota-santa-marta/9/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "bogota-santa-marta|11|flight": {
      "replayId": "bogota-santa-marta--11n--flight",
      "routeId": "bogota-santa-marta",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "BOG",
        "returnOriginCode": "SMR",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-20",
        "returnDate": "2026-12-01",
        "totalNights": 11,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "BOG",
              "departure_at": "2026-11-20T09:00:00Z",
              "value": 532.9,
              "currency": "CAD",
              "trip_duration": 585,
              "ticket_link": "/sanitized/bogota-santa-marta/11/outbound"
            },
            {
              "direction": "return",
              "origin": "SMR",
              "destination": "YYZ",
              "departure_at": "2026-12-01T10:00:00Z",
              "value": 585.8,
              "currency": "CAD",
              "trip_duration": 590,
              "ticket_link": "/sanitized/bogota-santa-marta/11/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "bangkok-chiang-mai|7|flight": {
      "replayId": "bangkok-chiang-mai--7n--flight",
      "routeId": "bangkok-chiang-mai",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "BKK",
        "returnOriginCode": "CNX",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-03",
        "returnDate": "2026-11-10",
        "totalNights": 7,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "BKK",
              "departure_at": "2026-11-03T09:00:00Z",
              "value": 1008.86,
              "currency": "CAD",
              "trip_duration": 620,
              "ticket_link": "/sanitized/bangkok-chiang-mai/7/outbound"
            },
            {
              "direction": "return",
              "origin": "CNX",
              "destination": "YYZ",
              "departure_at": "2026-11-10T10:00:00Z",
              "value": 1108.92,
              "currency": "CAD",
              "trip_duration": 620,
              "ticket_link": "/sanitized/bangkok-chiang-mai/7/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "bangkok-chiang-mai|9|flight": {
      "replayId": "bangkok-chiang-mai--9n--flight",
      "routeId": "bangkok-chiang-mai",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "BKK",
        "returnOriginCode": "CNX",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-12",
        "returnDate": "2026-11-21",
        "totalNights": 9,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "BKK",
              "departure_at": "2026-11-12T09:00:00Z",
              "value": 987.14,
              "currency": "CAD",
              "trip_duration": 620,
              "ticket_link": "/sanitized/bangkok-chiang-mai/9/outbound"
            },
            {
              "direction": "return",
              "origin": "CNX",
              "destination": "YYZ",
              "departure_at": "2026-11-21T10:00:00Z",
              "value": 1085.29,
              "currency": "CAD",
              "trip_duration": 620,
              "ticket_link": "/sanitized/bangkok-chiang-mai/9/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "bangkok-chiang-mai|11|flight": {
      "replayId": "bangkok-chiang-mai--11n--flight",
      "routeId": "bangkok-chiang-mai",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "BKK",
        "returnOriginCode": "CNX",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-11-20",
        "returnDate": "2026-12-01",
        "totalNights": 11,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "BKK",
              "departure_at": "2026-11-20T09:00:00Z",
              "value": 940.41,
              "currency": "CAD",
              "trip_duration": 620,
              "ticket_link": "/sanitized/bangkok-chiang-mai/11/outbound"
            },
            {
              "direction": "return",
              "origin": "CNX",
              "destination": "YYZ",
              "departure_at": "2026-12-01T10:00:00Z",
              "value": 1034.69,
              "currency": "CAD",
              "trip_duration": 620,
              "ticket_link": "/sanitized/bangkok-chiang-mai/11/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "istanbul-izmir|7|flight": {
      "replayId": "istanbul-izmir--7n--flight",
      "routeId": "istanbul-izmir",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "IST",
        "returnOriginCode": "ADB",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-03",
        "returnDate": "2026-10-10",
        "totalNights": 7,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "IST",
              "departure_at": "2026-10-03T09:00:00Z",
              "value": 709.59,
              "currency": "CAD",
              "trip_duration": 655,
              "ticket_link": "/sanitized/istanbul-izmir/7/outbound"
            },
            {
              "direction": "return",
              "origin": "ADB",
              "destination": "YYZ",
              "departure_at": "2026-10-10T10:00:00Z",
              "value": 781.19,
              "currency": "CAD",
              "trip_duration": 650,
              "ticket_link": "/sanitized/istanbul-izmir/7/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "istanbul-izmir|9|flight": {
      "replayId": "istanbul-izmir--9n--flight",
      "routeId": "istanbul-izmir",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "IST",
        "returnOriginCode": "ADB",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-12",
        "returnDate": "2026-10-21",
        "totalNights": 9,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "IST",
              "departure_at": "2026-10-12T09:00:00Z",
              "value": 696.69,
              "currency": "CAD",
              "trip_duration": 655,
              "ticket_link": "/sanitized/istanbul-izmir/9/outbound"
            },
            {
              "direction": "return",
              "origin": "ADB",
              "destination": "YYZ",
              "departure_at": "2026-10-21T10:00:00Z",
              "value": 765.61,
              "currency": "CAD",
              "trip_duration": 650,
              "ticket_link": "/sanitized/istanbul-izmir/9/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "istanbul-izmir|11|flight": {
      "replayId": "istanbul-izmir--11n--flight",
      "routeId": "istanbul-izmir",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "travelpayouts-prices-one-way-composed-open-jaw",
      "request": {
        "originCode": "YYZ",
        "anchorDestinationCode": "IST",
        "returnOriginCode": "ADB",
        "returnDestinationCode": "YYZ",
        "departureDate": "2026-10-20",
        "returnDate": "2026-10-31",
        "totalNights": 11,
        "currency": "CAD"
      },
      "response": {
        "data": {
          "prices_one_way": [
            {
              "direction": "outbound",
              "origin": "YYZ",
              "destination": "IST",
              "departure_at": "2026-10-20T09:00:00Z",
              "value": 704,
              "currency": "CAD",
              "trip_duration": 655,
              "ticket_link": "/sanitized/istanbul-izmir/11/outbound"
            },
            {
              "direction": "return",
              "origin": "ADB",
              "destination": "YYZ",
              "departure_at": "2026-10-31T10:00:00Z",
              "value": 774.34,
              "currency": "CAD",
              "trip_duration": 650,
              "ticket_link": "/sanitized/istanbul-izmir/11/return"
            }
          ]
        }
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksReplaced": true
      },
      "limitations": [
        "Sanitized provider-shaped replay sample; not a current fare.",
        "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates."
      ]
    },
    "lisbon-porto|undefined|hotel|lisbon-pt": {
      "replayId": "lisbon-porto--11n--lisbon-pt--hotel",
      "routeId": "lisbon-porto",
      "cityId": "lisbon-pt",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-10-20",
        "checkOut": "2026-10-26",
        "nights": 6,
        "currency": "EUR"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Lisbon Hotel Sample 1",
            "dailyRate": 95.04,
            "currency": "EUR",
            "reviewScore": 8,
            "reviewCount": 180,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-LISBON-PT-1"
          },
          {
            "hotelName": "Sanitized Lisbon Hotel Sample 2",
            "dailyRate": 101.11,
            "currency": "EUR",
            "reviewScore": 8.2,
            "reviewCount": 235,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-LISBON-PT-2"
          },
          {
            "hotelName": "Sanitized Lisbon Hotel Sample 3",
            "dailyRate": 107.18,
            "currency": "EUR",
            "reviewScore": 8.5,
            "reviewCount": 290,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-LISBON-PT-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "lisbon-porto|undefined|hotel|porto-pt": {
      "replayId": "lisbon-porto--11n--porto-pt--hotel",
      "routeId": "lisbon-porto",
      "cityId": "porto-pt",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-10-26",
        "checkOut": "2026-10-31",
        "nights": 5,
        "currency": "EUR"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Porto Hotel Sample 1",
            "dailyRate": 83.1,
            "currency": "EUR",
            "reviewScore": 8,
            "reviewCount": 180,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-PORTO-PT-1"
          },
          {
            "hotelName": "Sanitized Porto Hotel Sample 2",
            "dailyRate": 88.4,
            "currency": "EUR",
            "reviewScore": 8.2,
            "reviewCount": 235,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-PORTO-PT-2"
          },
          {
            "hotelName": "Sanitized Porto Hotel Sample 3",
            "dailyRate": 93.7,
            "currency": "EUR",
            "reviewScore": 8.5,
            "reviewCount": 290,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-PORTO-PT-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "rome-florence|undefined|hotel|rome-it": {
      "replayId": "rome-florence--11n--rome-it--hotel",
      "routeId": "rome-florence",
      "cityId": "rome-it",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-10-20",
        "checkOut": "2026-10-27",
        "nights": 7,
        "currency": "EUR"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Rome Hotel Sample 1",
            "dailyRate": 133.77,
            "currency": "EUR",
            "reviewScore": 8,
            "reviewCount": 200,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-ROME-IT-1"
          },
          {
            "hotelName": "Sanitized Rome Hotel Sample 2",
            "dailyRate": 142.31,
            "currency": "EUR",
            "reviewScore": 8.2,
            "reviewCount": 255,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-ROME-IT-2"
          },
          {
            "hotelName": "Sanitized Rome Hotel Sample 3",
            "dailyRate": 150.85,
            "currency": "EUR",
            "reviewScore": 8.5,
            "reviewCount": 310,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-ROME-IT-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "rome-florence|undefined|hotel|florence-it": {
      "replayId": "rome-florence--11n--florence-it--hotel",
      "routeId": "rome-florence",
      "cityId": "florence-it",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-10-27",
        "checkOut": "2026-10-31",
        "nights": 4,
        "currency": "EUR"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Florence Hotel Sample 1",
            "dailyRate": 122.33,
            "currency": "EUR",
            "reviewScore": 8,
            "reviewCount": 200,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-FLORENCE-IT-1"
          },
          {
            "hotelName": "Sanitized Florence Hotel Sample 2",
            "dailyRate": 130.14,
            "currency": "EUR",
            "reviewScore": 8.2,
            "reviewCount": 255,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-FLORENCE-IT-2"
          },
          {
            "hotelName": "Sanitized Florence Hotel Sample 3",
            "dailyRate": 137.95,
            "currency": "EUR",
            "reviewScore": 8.5,
            "reviewCount": 310,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-FLORENCE-IT-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "mexico-city-puebla|undefined|hotel|mexico-city-mx": {
      "replayId": "mexico-city-puebla--11n--mexico-city-mx--hotel",
      "routeId": "mexico-city-puebla",
      "cityId": "mexico-city-mx",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-11-20",
        "checkOut": "2026-11-27",
        "nights": 7,
        "currency": "MXN"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Mexico City Hotel Sample 1",
            "dailyRate": 1667.69,
            "currency": "MXN",
            "reviewScore": 8,
            "reviewCount": 220,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-MEXICO-CITY-MX-1"
          },
          {
            "hotelName": "Sanitized Mexico City Hotel Sample 2",
            "dailyRate": 1774.14,
            "currency": "MXN",
            "reviewScore": 8.2,
            "reviewCount": 275,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-MEXICO-CITY-MX-2"
          },
          {
            "hotelName": "Sanitized Mexico City Hotel Sample 3",
            "dailyRate": 1880.59,
            "currency": "MXN",
            "reviewScore": 8.5,
            "reviewCount": 330,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-MEXICO-CITY-MX-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "mexico-city-puebla|undefined|hotel|puebla-mx": {
      "replayId": "mexico-city-puebla--11n--puebla-mx--hotel",
      "routeId": "mexico-city-puebla",
      "cityId": "puebla-mx",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-11-27",
        "checkOut": "2026-12-01",
        "nights": 4,
        "currency": "MXN"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Puebla Hotel Sample 1",
            "dailyRate": 1134.03,
            "currency": "MXN",
            "reviewScore": 8,
            "reviewCount": 220,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-PUEBLA-MX-1"
          },
          {
            "hotelName": "Sanitized Puebla Hotel Sample 2",
            "dailyRate": 1206.41,
            "currency": "MXN",
            "reviewScore": 8.2,
            "reviewCount": 275,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-PUEBLA-MX-2"
          },
          {
            "hotelName": "Sanitized Puebla Hotel Sample 3",
            "dailyRate": 1278.79,
            "currency": "MXN",
            "reviewScore": 8.5,
            "reviewCount": 330,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-PUEBLA-MX-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "bogota-santa-marta|undefined|hotel|bogota-co": {
      "replayId": "bogota-santa-marta--11n--bogota-co--hotel",
      "routeId": "bogota-santa-marta",
      "cityId": "bogota-co",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-11-20",
        "checkOut": "2026-11-26",
        "nights": 6,
        "currency": "COP"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Bogota Hotel Sample 1",
            "dailyRate": 319600,
            "currency": "COP",
            "reviewScore": 8,
            "reviewCount": 240,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-BOGOTA-CO-1"
          },
          {
            "hotelName": "Sanitized Bogota Hotel Sample 2",
            "dailyRate": 340000,
            "currency": "COP",
            "reviewScore": 8.2,
            "reviewCount": 295,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-BOGOTA-CO-2"
          },
          {
            "hotelName": "Sanitized Bogota Hotel Sample 3",
            "dailyRate": 360400,
            "currency": "COP",
            "reviewScore": 8.5,
            "reviewCount": 350,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-BOGOTA-CO-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "bogota-santa-marta|undefined|hotel|santa-marta-co": {
      "replayId": "bogota-santa-marta--11n--santa-marta-co--hotel",
      "routeId": "bogota-santa-marta",
      "cityId": "santa-marta-co",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-11-26",
        "checkOut": "2026-12-01",
        "nights": 5,
        "currency": "COP"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Santa Marta Hotel Sample 1",
            "dailyRate": 345168,
            "currency": "COP",
            "reviewScore": 8,
            "reviewCount": 240,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-SANTA-MARTA-CO-1"
          },
          {
            "hotelName": "Sanitized Santa Marta Hotel Sample 2",
            "dailyRate": 367200,
            "currency": "COP",
            "reviewScore": 8.2,
            "reviewCount": 295,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-SANTA-MARTA-CO-2"
          },
          {
            "hotelName": "Sanitized Santa Marta Hotel Sample 3",
            "dailyRate": 389232,
            "currency": "COP",
            "reviewScore": 8.5,
            "reviewCount": 350,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-SANTA-MARTA-CO-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "bangkok-chiang-mai|undefined|hotel|bangkok-th": {
      "replayId": "bangkok-chiang-mai--11n--bangkok-th--hotel",
      "routeId": "bangkok-chiang-mai",
      "cityId": "bangkok-th",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-11-20",
        "checkOut": "2026-11-26",
        "nights": 6,
        "currency": "THB"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Bangkok Hotel Sample 1",
            "dailyRate": 2710.89,
            "currency": "THB",
            "reviewScore": 8,
            "reviewCount": 260,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-BANGKOK-TH-1"
          },
          {
            "hotelName": "Sanitized Bangkok Hotel Sample 2",
            "dailyRate": 2883.93,
            "currency": "THB",
            "reviewScore": 8.2,
            "reviewCount": 315,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-BANGKOK-TH-2"
          },
          {
            "hotelName": "Sanitized Bangkok Hotel Sample 3",
            "dailyRate": 3056.97,
            "currency": "THB",
            "reviewScore": 8.5,
            "reviewCount": 370,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-BANGKOK-TH-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "bangkok-chiang-mai|undefined|hotel|chiang-mai-th": {
      "replayId": "bangkok-chiang-mai--11n--chiang-mai-th--hotel",
      "routeId": "bangkok-chiang-mai",
      "cityId": "chiang-mai-th",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-11-26",
        "checkOut": "2026-12-01",
        "nights": 5,
        "currency": "THB"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Chiang Mai Hotel Sample 1",
            "dailyRate": 1951.84,
            "currency": "THB",
            "reviewScore": 8,
            "reviewCount": 260,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-CHIANG-MAI-TH-1"
          },
          {
            "hotelName": "Sanitized Chiang Mai Hotel Sample 2",
            "dailyRate": 2076.43,
            "currency": "THB",
            "reviewScore": 8.2,
            "reviewCount": 315,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-CHIANG-MAI-TH-2"
          },
          {
            "hotelName": "Sanitized Chiang Mai Hotel Sample 3",
            "dailyRate": 2201.02,
            "currency": "THB",
            "reviewScore": 8.5,
            "reviewCount": 370,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-CHIANG-MAI-TH-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "istanbul-izmir|undefined|hotel|istanbul-tr": {
      "replayId": "istanbul-izmir--11n--istanbul-tr--hotel",
      "routeId": "istanbul-izmir",
      "cityId": "istanbul-tr",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-10-20",
        "checkOut": "2026-10-27",
        "nights": 7,
        "currency": "TRY"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Istanbul Hotel Sample 1",
            "dailyRate": 2880.65,
            "currency": "TRY",
            "reviewScore": 8,
            "reviewCount": 280,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-ISTANBUL-TR-1"
          },
          {
            "hotelName": "Sanitized Istanbul Hotel Sample 2",
            "dailyRate": 3064.52,
            "currency": "TRY",
            "reviewScore": 8.2,
            "reviewCount": 335,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-ISTANBUL-TR-2"
          },
          {
            "hotelName": "Sanitized Istanbul Hotel Sample 3",
            "dailyRate": 3248.39,
            "currency": "TRY",
            "reviewScore": 8.5,
            "reviewCount": 390,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-ISTANBUL-TR-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "istanbul-izmir|undefined|hotel|izmir-tr": {
      "replayId": "istanbul-izmir--11n--izmir-tr--hotel",
      "routeId": "istanbul-izmir",
      "cityId": "izmir-tr",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "agoda-affiliate-lite-hotel-array",
      "request": {
        "cityId": null,
        "checkIn": "2026-10-27",
        "checkOut": "2026-10-31",
        "nights": 4,
        "currency": "TRY"
      },
      "response": {
        "results": [
          {
            "hotelName": "Sanitized Izmir Hotel Sample 1",
            "dailyRate": 2628.96,
            "currency": "TRY",
            "reviewScore": 8,
            "reviewCount": 280,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-IZMIR-TR-1"
          },
          {
            "hotelName": "Sanitized Izmir Hotel Sample 2",
            "dailyRate": 2796.77,
            "currency": "TRY",
            "reviewScore": 8.2,
            "reviewCount": 335,
            "starRating": 4,
            "landingURL": null,
            "providerHotelId": "REDACTED-IZMIR-TR-2"
          },
          {
            "hotelName": "Sanitized Izmir Hotel Sample 3",
            "dailyRate": 2964.58,
            "currency": "TRY",
            "reviewScore": 8.5,
            "reviewCount": 390,
            "starRating": 3,
            "landingURL": null,
            "providerHotelId": "REDACTED-IZMIR-TR-3"
          }
        ]
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true,
        "bookingLinksRemoved": true
      },
      "limitations": [
        "Sanitized Agoda-shaped replay sample; not current availability or a booking quote.",
        "Hotel names and identifiers are placeholders created only to exercise normalization."
      ]
    },
    "lisbon-porto|undefined|intercity": {
      "replayId": "lisbon-porto--11n--intercity",
      "routeId": "lisbon-porto",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "provider-neutral-intercity-replay",
      "request": {
        "fromCityId": "lisbon-pt",
        "toCityId": "porto-pt",
        "transportType": "rail",
        "departureDate": "2026-10-26",
        "currency": "EUR"
      },
      "response": {
        "estimate": 49.68,
        "currency": "EUR",
        "serviceReference": "REDACTED-LISBON-PORTO-11N"
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true
      },
      "limitations": [
        "Offline transport replay; no live schedule or seat availability was checked."
      ]
    },
    "rome-florence|undefined|intercity": {
      "replayId": "rome-florence--11n--intercity",
      "routeId": "rome-florence",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "provider-neutral-intercity-replay",
      "request": {
        "fromCityId": "rome-it",
        "toCityId": "florence-it",
        "transportType": "rail",
        "departureDate": "2026-10-27",
        "currency": "EUR"
      },
      "response": {
        "estimate": 62.64,
        "currency": "EUR",
        "serviceReference": "REDACTED-ROME-FLORENCE-11N"
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true
      },
      "limitations": [
        "Offline transport replay; no live schedule or seat availability was checked."
      ]
    },
    "mexico-city-puebla|undefined|intercity": {
      "replayId": "mexico-city-puebla--11n--intercity",
      "routeId": "mexico-city-puebla",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "provider-neutral-intercity-replay",
      "request": {
        "fromCityId": "mexico-city-mx",
        "toCityId": "puebla-mx",
        "transportType": "road",
        "departureDate": "2026-11-27",
        "currency": "MXN"
      },
      "response": {
        "estimate": 777.6,
        "currency": "MXN",
        "serviceReference": "REDACTED-MEXICO-CITY-PUEBLA-11N"
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true
      },
      "limitations": [
        "Offline transport replay; no live schedule or seat availability was checked."
      ]
    },
    "bogota-santa-marta|undefined|intercity": {
      "replayId": "bogota-santa-marta--11n--intercity",
      "routeId": "bogota-santa-marta",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "provider-neutral-intercity-replay",
      "request": {
        "fromCityId": "bogota-co",
        "toCityId": "santa-marta-co",
        "transportType": "regional flight",
        "departureDate": "2026-11-26",
        "currency": "COP"
      },
      "response": {
        "estimate": 561600,
        "currency": "COP",
        "serviceReference": "REDACTED-BOGOTA-SANTA-MARTA-11N"
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true
      },
      "limitations": [
        "Offline transport replay; no live schedule or seat availability was checked."
      ]
    },
    "bangkok-chiang-mai|undefined|intercity": {
      "replayId": "bangkok-chiang-mai--11n--intercity",
      "routeId": "bangkok-chiang-mai",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "provider-neutral-intercity-replay",
      "request": {
        "fromCityId": "bangkok-th",
        "toCityId": "chiang-mai-th",
        "transportType": "short flight",
        "departureDate": "2026-11-26",
        "currency": "THB"
      },
      "response": {
        "estimate": 3564,
        "currency": "THB",
        "serviceReference": "REDACTED-BANGKOK-CHIANG-MAI-11N"
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true
      },
      "limitations": [
        "Offline transport replay; no live schedule or seat availability was checked."
      ]
    },
    "istanbul-izmir|undefined|intercity": {
      "replayId": "istanbul-izmir--11n--intercity",
      "routeId": "istanbul-izmir",
      "retrievedAt": "2026-06-19T12:00:00-04:00",
      "providerShape": "provider-neutral-intercity-replay",
      "request": {
        "fromCityId": "istanbul-tr",
        "toCityId": "izmir-tr",
        "transportType": "short flight",
        "departureDate": "2026-10-27",
        "currency": "TRY"
      },
      "response": {
        "estimate": 4212,
        "currency": "TRY",
        "serviceReference": "REDACTED-ISTANBUL-IZMIR-11N"
      },
      "sanitization": {
        "tokensRemoved": true,
        "personalInformationRemoved": true
      },
      "limitations": [
        "Offline transport replay; no live schedule or seat availability was checked."
      ]
    }
  }
};});
