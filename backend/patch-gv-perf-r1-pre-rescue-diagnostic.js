'use strict';

const fs = require('fs');
const path = require('path');

function replaceOnce(file, before, after, label) {
  const source = fs.readFileSync(file, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: target snippet not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: target snippet is not unique`);
  const next = source.slice(0, first) + after + source.slice(first + before.length);
  fs.writeFileSync(file, next);
}

const root = __dirname;
const pilot = path.join(root, 'services', 'public-live-fare-pilot-684a.js');
const discovery = path.join(root, 'services', 'affordable-flight-discovery-684b.js');

replaceOnce(
  pilot,
  `  const patched = applyTravellerPricingToTour({ ...tour, legs }, query);\n  const afterTotalUsd = totalUsd684A(patched);\n  const strictBudgetFit = strictBudgetFit685CR1(afterTotalUsd, tour, query);\n  return {`,
  `  const patched = applyTravellerPricingToTour({ ...tour, legs }, query);\n  const afterTotalUsd = totalUsd684A(patched);\n  const strictBudgetFit = strictBudgetFit685CR1(afterTotalUsd, tour, query);\n\n  // GV-PERF-R1 staging diagnostic only: keep the just-priced route on the request\n  // object through a Symbol so it is invisible to normal JSON serialization. The\n  // bounded 684B rescue can snapshot it before pricing a replacement candidate.\n  const preRescueDiagnosticSymbol684A = Symbol.for('globevoy.pre-rescue-live-fare-diagnostic-684a');\n  query[preRescueDiagnosticSymbol684A] = {\n    version: 'GV-PERF-R1',\n    route: (Array.isArray(tour.stops) ? tour.stops : [])\n      .map(stop => String(stop?.cityId || stop?.airportCode || stop?.code || stop?.city || '').trim().toLowerCase())\n      .filter(Boolean)\n      .join('>') || null,\n    beforeLiveUsd: Math.round(beforeTotalUsd),\n    afterLiveUsd: Math.round(afterTotalUsd),\n    livePriceDeltaUsd: Math.round(afterTotalUsd - beforeTotalUsd),\n    overBudget: strictBudgetFit.overBudget === true,\n    providerRequests: Number(state.requests || 0)\n  };\n\n  return {`,
  '684A pre-rescue diagnostic handoff'
);

replaceOnce(
  discovery,
  `  const env = options.env || process.env;\n  const eligibility = eligibility684B(tours, currentTour, query, env, { allowSelectedFlightFallback: options.allowSelectedFlightFallback === true });\n  const baseSummary = {`,
  `  const env = options.env || process.env;\n  const eligibility = eligibility684B(tours, currentTour, query, env, { allowSelectedFlightFallback: options.allowSelectedFlightFallback === true });\n  const preRescueDiagnosticSymbol684A = Symbol.for('globevoy.pre-rescue-live-fare-diagnostic-684a');\n  const preRescueLiveFare684A = query?.[preRescueDiagnosticSymbol684A] || null;\n  const currentTotalUsd684B = typeof options.totalUsd === 'function' ? options.totalUsd : defaultTotalUsd684B;\n  const currentPlanningTotalUsd684B = currentTour ? Number(currentTotalUsd684B(currentTour, query) || 0) : 0;\n  const preLiveSelectionDiagnostic = eligibility.selectedFlightFallback === true && currentTour\n    ? {\n        version: 'GV-PERF-R1',\n        route: routeKey684B(currentTour) || preRescueLiveFare684A?.route || null,\n        planningTotalUsd: currentPlanningTotalUsd684B > 0 ? Math.round(currentPlanningTotalUsd684B) : null,\n        beforeLiveUsd: Number.isFinite(Number(preRescueLiveFare684A?.beforeLiveUsd)) ? Number(preRescueLiveFare684A.beforeLiveUsd) : null,\n        afterLiveUsd: Number.isFinite(Number(preRescueLiveFare684A?.afterLiveUsd)) ? Number(preRescueLiveFare684A.afterLiveUsd) : null,\n        livePriceDeltaUsd: Number.isFinite(Number(preRescueLiveFare684A?.livePriceDeltaUsd)) ? Number(preRescueLiveFare684A.livePriceDeltaUsd) : null,\n        overBudget: preRescueLiveFare684A?.overBudget === true,\n        providerRequests: Number.isFinite(Number(preRescueLiveFare684A?.providerRequests)) ? Number(preRescueLiveFare684A.providerRequests) : null\n      }\n    : null;\n  const baseSummary = {`,
  '684B pre-rescue diagnostic snapshot'
);

replaceOnce(
  discovery,
  `    selectedFlightFallbackMode: eligibility.selectedFlightFallback === true,\n    orderCapability: false,`,
  `    selectedFlightFallbackMode: eligibility.selectedFlightFallback === true,\n    preLiveSelectionDiagnostic,\n    orderCapability: false,`,
  '684B response-only diagnostic field'
);

console.log('PASS GV-PERF-R1 source patch applied');
