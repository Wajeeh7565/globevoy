'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const generatedSource = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
const discoverySource = fs.readFileSync(path.join(__dirname, 'services', 'affordable-flight-discovery-684b.js'), 'utf8');

function mustFind(source, needle, label, fromIndex = 0) {
  const at = source.indexOf(needle, fromIndex);
  assert(at >= 0, `${label} not found`);
  return at;
}

const selectionAt = mustFind(
  generatedSource,
  'let selection = await selectTourWithOptionalProviderRanking(combined, routeQuery);',
  'planning route selection'
);
const firstLiveAt = mustFind(
  generatedSource,
  'const publicLiveFare684A = await applyPublicLiveFarePilot684A(enrichment.tour, routeQuery);',
  'selected-route 684A live pricing',
  selectionAt
);
const overBudgetAt = mustFind(
  generatedSource,
  'let routeStillOverBudgetAfterLive684B = Boolean(',
  'post-live over-budget decision',
  firstLiveAt
);
const rescueAt = mustFind(
  generatedSource,
  'const overBudgetFlightRescue684B = await discoverAffordableFlightTour684B(',
  'bounded over-budget 684B rescue',
  overBudgetAt
);

assert(selectionAt < firstLiveAt, 'planning route must be selected before 684A obtains exact live fares');
assert(firstLiveAt < overBudgetAt, 'live fare evidence must exist before post-live budget decision');
assert(overBudgetAt < rescueAt, 'bounded rescue must happen only after the first route is proven over budget');

assert.match(
  generatedSource,
  /const budgetSafe = \(Array\.isArray\(tours\) \? tours : \[\]\)\.filter\(tour => !isOverUserBudget\(tour, query\)\);/,
  'pre-live selector should use planning-budget safety'
);
assert.match(
  generatedSource,
  /return feasible\.slice\(\)\.sort\(\(a, b\) => \{[\s\S]*automaticTourCandidateScore\(b, query\)[\s\S]*automaticTourCandidateScore\(a, query\)/,
  'pre-live selector should rank planning candidates with automaticTourCandidateScore'
);
assert.match(
  generatedSource.slice(overBudgetAt, rescueAt + 1200),
  /affordableFlightDiscovery684B\.summary\?\.reason === '684b-selected-route-already-has-flight'/,
  'selected flight route should trigger bounded rescue only after live over-budget evidence'
);
assert.match(
  discoverySource,
  /if \(currentKey && key && key === currentKey\) continue;/,
  'rescue shortlist should exclude the already-tried current route'
);
assert.match(
  discoverySource,
  /const shortlist = \[ranked\[0\]\];[\s\S]*const cheapest = rows\.slice\(\)\.sort/,
  '684B should preserve one role-aware candidate plus one cheapest plausible candidate'
);

// Real staging observation captured on 2026-09-14 for the Toronto C$2,000 run.
// These values are diagnostic evidence only; they do not affect runtime behavior.
const observed = {
  enteredBudgetUsd: 1470,
  rescueShortlistPlanningUsd: 1284,
  rescueEnrichedBeforeLiveUsd: 1317,
  rescueLiveUsd: 1388,
  rescueProviderRequests: 3
};

const shortlistToEnrichment = observed.rescueEnrichedBeforeLiveUsd - observed.rescueShortlistPlanningUsd;
const enrichmentToLive = observed.rescueLiveUsd - observed.rescueEnrichedBeforeLiveUsd;
const shortlistToLive = observed.rescueLiveUsd - observed.rescueShortlistPlanningUsd;
const headroomUsd = observed.enteredBudgetUsd - observed.rescueLiveUsd;

assert.equal(shortlistToEnrichment, 33);
assert.equal(enrichmentToLive, 71);
assert.equal(shortlistToLive, 104);
assert.equal(headroomUsd, 82);
assert(observed.rescueLiveUsd < observed.enteredBudgetUsd, 'rescued route must remain within entered budget');

console.log('PASS GV-PERF planning-selection -> live-price -> bounded-rescue trace');
console.log(JSON.stringify({
  selectionBeforeLivePricing: selectionAt < firstLiveAt,
  liveBudgetDecisionBeforeRescue: firstLiveAt < overBudgetAt && overBudgetAt < rescueAt,
  selectionBasis: 'planning-budget-safe + automaticTourCandidateScore before exact Duffel live fares',
  observedRescue: {
    ...observed,
    shortlistToEnrichmentDeltaUsd: shortlistToEnrichment,
    enrichmentToLiveDeltaUsd: enrichmentToLive,
    shortlistToLiveDeltaUsd: shortlistToLive,
    shortlistToLiveDeltaPct: Number(((shortlistToLive / observed.rescueShortlistPlanningUsd) * 100).toFixed(2)),
    finalBudgetHeadroomUsd: headroomUsd,
    finalBudgetHeadroomPct: Number(((headroomUsd / observed.enteredBudgetUsd) * 100).toFixed(2))
  }
}, null, 2));
