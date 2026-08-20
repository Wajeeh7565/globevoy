(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.GlobevoyFlexibleDateWindows=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  return [
  {
    "routeId": "lisbon-porto",
    "origin": "YYZ",
    "month": "2026-10",
    "totalNights": 7,
    "candidateOutboundDate": "2026-10-03",
    "candidateReturnDate": "2026-10-10",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1431.37,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 1192.81,
      "maximum": 1192.81,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "lisbon-porto",
    "origin": "YYZ",
    "month": "2026-10",
    "totalNights": 9,
    "candidateOutboundDate": "2026-10-12",
    "candidateReturnDate": "2026-10-21",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1269.22,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 1057.68,
      "maximum": 1057.68,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "lisbon-porto",
    "origin": "YYZ",
    "month": "2026-10",
    "totalNights": 11,
    "candidateOutboundDate": "2026-10-20",
    "candidateReturnDate": "2026-10-31",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1416.16,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 1180.13,
      "maximum": 1180.13,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "rome-florence",
    "origin": "YYZ",
    "month": "2026-10",
    "totalNights": 7,
    "candidateOutboundDate": "2026-10-03",
    "candidateReturnDate": "2026-10-10",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1625.04,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 1354.2,
      "maximum": 1354.2,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "rome-florence",
    "origin": "YYZ",
    "month": "2026-10",
    "totalNights": 9,
    "candidateOutboundDate": "2026-10-12",
    "candidateReturnDate": "2026-10-21",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1431.73,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 1193.11,
      "maximum": 1193.11,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "rome-florence",
    "origin": "YYZ",
    "month": "2026-10",
    "totalNights": 11,
    "candidateOutboundDate": "2026-10-20",
    "candidateReturnDate": "2026-10-31",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1447.96,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 1206.63,
      "maximum": 1206.63,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "paris-strasbourg",
    "origin": "NYC",
    "month": "2026-10",
    "totalNights": 7,
    "candidateOutboundDate": "2026-10-03",
    "candidateReturnDate": "2026-10-10",
    "currency": "USD",
    "market": "US",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 830.40,
      "currency": "USD"
    },
    "estimatedCombinedRange": {
      "minimum": 692.00,
      "maximum": 692.00,
      "currency": "USD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market US is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "paris-strasbourg",
    "origin": "NYC",
    "month": "2026-10",
    "totalNights": 9,
    "candidateOutboundDate": "2026-10-12",
    "candidateReturnDate": "2026-10-21",
    "currency": "USD",
    "market": "US",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 765.60,
      "currency": "USD"
    },
    "estimatedCombinedRange": {
      "minimum": 638.00,
      "maximum": 638.00,
      "currency": "USD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market US is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "paris-strasbourg",
    "origin": "NYC",
    "month": "2026-10",
    "totalNights": 11,
    "candidateOutboundDate": "2026-10-20",
    "candidateReturnDate": "2026-10-31",
    "currency": "USD",
    "market": "US",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 798.00,
      "currency": "USD"
    },
    "estimatedCombinedRange": {
      "minimum": 665.00,
      "maximum": 665.00,
      "currency": "USD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market US is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "mexico-city-puebla",
    "origin": "YYZ",
    "month": "2026-11",
    "totalNights": 7,
    "candidateOutboundDate": "2026-11-03",
    "candidateReturnDate": "2026-11-10",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1046.08,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 871.73,
      "maximum": 871.73,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "mexico-city-puebla",
    "origin": "YYZ",
    "month": "2026-11",
    "totalNights": 9,
    "candidateOutboundDate": "2026-11-12",
    "candidateReturnDate": "2026-11-21",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1026.71,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 855.59,
      "maximum": 855.59,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  },
  {
    "routeId": "mexico-city-puebla",
    "origin": "YYZ",
    "month": "2026-11",
    "totalNights": 11,
    "candidateOutboundDate": "2026-11-20",
    "candidateReturnDate": "2026-12-01",
    "currency": "CAD",
    "market": "CA",
    "sourceMode": "replay",
    "observedTimestamp": "2026-06-19T12:00:00-04:00",
    "ageHours": 20,
    "confidence": "medium",
    "planningBuffer": {
      "rate": 0.2,
      "percentage": 20,
      "explanation": "Globevoy planning contingency based on source confidence; this is not a provider fee or fare component."
    },
    "bufferedPlanningEstimate": {
      "amount": 1037.68,
      "currency": "CAD"
    },
    "estimatedCombinedRange": {
      "minimum": 864.73,
      "maximum": 864.73,
      "currency": "CAD",
      "basis": "sum-of-bound-one-way-observations"
    },
    "limitations": [
      "Sanitized deterministic replay for testing only; it is not current availability or a bookable fare.",
      "Sanitized provider-shaped replay sample; not a current fare.",
      "Outbound and return rows are deliberately bound to the same route window and must not be recombined with other dates.",
      "Market is the experiment context because the saved replay record did not include a provider market field.",
      "Market CA is request context and was not independently confirmed by the provider row.",
      "Sanitized provider-shaped replay; not a current or bookable fare.",
      "Two one-way observations are paired only for broad planning and do not prove a currently available or protected open-jaw itinerary."
    ],
    "isLive": false,
    "isBookable": false,
    "exactValidationRequired": true,
    "isCurrentAvailabilityProven": false,
    "openJawCoverage": "paired-replay-observations"
  }
];
});
