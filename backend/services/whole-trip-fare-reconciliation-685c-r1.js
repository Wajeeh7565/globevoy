'use strict';

// GV-FLIGHT-685C-R1 — pure, bounded reconciliation of already-returned and
// already-normalized Duffel alternatives. It performs no provider or FX calls.

const { currencyToUsdRate, normalizeCurrency } = require('../budget-presentation');

const VERSION_685C_R1 = 'GV-FLIGHT-685C-R1';
const MAX_FLIGHT_LEGS_685C_R1 = 3;
const MAX_COMBINATIONS_685C_R1 = 2 ** MAX_FLIGHT_LEGS_685C_R1;

function money(value) {
  const out = Number(value);
  return Number.isFinite(out) ? Number(out.toFixed(2)) : null;
}

function providerReference(row = {}) {
  return String(row?.observation?.providerReference || '').trim();
}

function alternativeScore(row = {}) {
  const score = Number(row?.score ?? row?.observation?.fareSelection685C?.selectedScore);
  return Number.isFinite(score) ? score : Number.POSITIVE_INFINITY;
}

function strictBudgetFit685CR1(totalUsd, tour = {}, query = {}) {
  const safeTotalUsd = Math.max(0, Number(totalUsd || 0));
  const currency = normalizeCurrency(query.currency || 'USD');
  const rateToUsd = currencyToUsdRate(currency);
  const rawEnteredBudget = Number(query.budget ?? query.totalBudget ?? 0);
  if (Number.isFinite(rawEnteredBudget) && rawEnteredBudget > 0) {
    const totalDisplay = Math.round(safeTotalUsd / Math.max(0.000001, rateToUsd));
    const budgetDisplay = Math.round(rawEnteredBudget);
    return {
      version: 'GV-REC-684B-R3',
      reconciliationVersion: VERSION_685C_R1,
      source: 'entered-display-budget',
      currency,
      totalUsd: safeTotalUsd,
      budgetUsd: rawEnteredBudget * rateToUsd,
      totalDisplay,
      budgetDisplay,
      overBudget: totalDisplay > budgetDisplay
    };
  }
  const explicitBudgetUsd = Number(query.budgetUsd || 0);
  const tourBudgetUsd = Number(tour?.totalBudgetUsd || 0);
  const budgetUsd = Number.isFinite(explicitBudgetUsd) && explicitBudgetUsd > 0
    ? explicitBudgetUsd
    : (Number.isFinite(tourBudgetUsd) && tourBudgetUsd > 0 ? tourBudgetUsd : Infinity);
  return {
    version: 'GV-REC-684B-R3',
    reconciliationVersion: VERSION_685C_R1,
    source: Number.isFinite(explicitBudgetUsd) && explicitBudgetUsd > 0 ? 'explicit-budget-usd' : 'tour-budget-usd',
    currency: 'USD',
    totalUsd: safeTotalUsd,
    budgetUsd,
    totalDisplay: Math.round(safeTotalUsd),
    budgetDisplay: Number.isFinite(budgetUsd) ? Math.round(budgetUsd) : null,
    overBudget: Number.isFinite(budgetUsd) ? safeTotalUsd > budgetUsd : false
  };
}

function combinations685CR1(rows = []) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_FLIGHT_LEGS_685C_R1) return [];
  let combinations = [{ choices: [] }];
  for (const row of rows) {
    const cheapest = row?.alternatives?.cheapest || null;
    const bestBalance = row?.alternatives?.bestBalance || null;
    if (!cheapest) return [];
    const alternatives = [{ ...cheapest, role: 'cheapest' }];
    if (bestBalance) alternatives.push({ ...bestBalance, role: 'best-balance' });
    combinations = combinations.flatMap(combination => alternatives.map(alternative => ({
      choices: [...combination.choices, alternative]
    })));
  }
  return combinations.slice(0, MAX_COMBINATIONS_685C_R1);
}

function assessCombination685CR1(combination = {}, nonFlightTotalUsd = 0, tour = {}, query = {}) {
  const choices = Array.isArray(combination.choices) ? combination.choices : [];
  const liveFlightTotalUsd = choices.reduce((sum, choice) => sum + Number(choice?.observation?.rankingPriceUsd || 0), 0);
  const aggregateScore = choices.reduce((sum, choice) => sum + alternativeScore(choice), 0);
  const completeTotalUsd = Math.max(0, Number(nonFlightTotalUsd || 0)) + liveFlightTotalUsd;
  const budgetFit = strictBudgetFit685CR1(completeTotalUsd, tour, query);
  const references = choices.map(providerReference);
  const roles = choices.map(choice => choice.role);
  return {
    ...combination,
    roles,
    references,
    stableReferenceKey: references.join('|'),
    aggregateScore,
    liveFlightTotalUsd: money(liveFlightTotalUsd),
    nonFlightTotalUsd: money(nonFlightTotalUsd),
    completeTotalUsd: money(completeTotalUsd),
    budgetFit,
    fitsBudget: budgetFit.overBudget !== true,
    allCheapest: roles.every(role => role === 'cheapest'),
    allBestBalance: roles.every(role => role === 'best-balance')
  };
}

function deterministicCombinationOrder685CR1(a = {}, b = {}) {
  return Number(a.aggregateScore) - Number(b.aggregateScore)
    || Number(a.liveFlightTotalUsd) - Number(b.liveFlightTotalUsd)
    || String(a.stableReferenceKey || '').localeCompare(String(b.stableReferenceKey || ''));
}

function resultMetadata685CR1(selected = {}, assessed = [], requestedRole = 'cheapest', reason = null) {
  const allBest = assessed.find(row => row.allBestBalance) || null;
  const allCheapest = assessed.find(row => row.allCheapest) || null;
  return {
    version: VERSION_685C_R1,
    requestedRole,
    reason,
    combinationCount: assessed.length,
    feasibleCombinationCount: assessed.filter(row => row.fitsBudget).length,
    selectedRoles: selected.roles || [],
    selectedProviderReferences: selected.references || [],
    selectedAggregateScore: Number.isFinite(Number(selected.aggregateScore)) ? Number(selected.aggregateScore) : null,
    selectedLiveFlightTotalUsd: selected.liveFlightTotalUsd ?? null,
    selectedCompleteTotalUsd: selected.completeTotalUsd ?? null,
    nonFlightTotalUsd: selected.nonFlightTotalUsd ?? null,
    allBestBalanceFits: allBest?.fitsBudget === true,
    allCheapestFits: allCheapest?.fitsBudget === true,
    strictBudgetFit: selected.budgetFit || null,
    deterministic: true,
    maxCombinations: MAX_COMBINATIONS_685C_R1,
    providerRequestsAdded: 0
  };
}

function reconcileWholeTripFares685CR1(rows = [], context = {}) {
  const requestedRole = context.requestedRole === 'best-balance' ? 'best-balance' : 'cheapest';
  const combinations = combinations685CR1(rows);
  if (!combinations.length) {
    return { supported: false, reason: '685c-r1-no-complete-normalized-alternative-set', version: VERSION_685C_R1 };
  }
  const assessed = combinations.map(combination => assessCombination685CR1(
    combination,
    context.nonFlightTotalUsd,
    context.tour,
    context.query
  ));
  const allCheapest = assessed.find(row => row.allCheapest);
  if (!allCheapest) return { supported: false, reason: '685c-r1-all-cheapest-unavailable', version: VERSION_685C_R1 };

  let selected;
  let reason;
  if (requestedRole === 'cheapest') {
    selected = allCheapest;
    reason = selected.fitsBudget ? 'lowest-cost-all-cheapest' : 'lowest-cost-all-cheapest-over-budget-preserved';
  } else {
    const allBestBalance = assessed.find(row => row.allBestBalance);
    const feasible = assessed.filter(row => row.fitsBudget).sort(deterministicCombinationOrder685CR1);
    if (allBestBalance?.fitsBudget) {
      selected = allBestBalance;
      reason = 'all-best-balance-fits';
    } else if (feasible.length) {
      selected = feasible[0];
      reason = selected.allCheapest ? 'only-all-cheapest-best-feasible' : 'best-feasible-mixed-combination';
    } else {
      // Preserve 684A/684B-R3 behavior: apply complete canonical cheapest LIVE
      // evidence, report strict over-budget, and let the existing route layer
      // reject/rescue/fail closed exactly as before.
      selected = allCheapest;
      reason = 'all-cheapest-over-budget-preserved-for-existing-strict-fallback';
    }
  }

  return {
    supported: true,
    reason: null,
    version: VERSION_685C_R1,
    selectedChoices: selected.choices,
    selectedCombination: selected,
    combinations: assessed.map(row => ({
      roles: row.roles,
      references: row.references,
      aggregateScore: row.aggregateScore,
      liveFlightTotalUsd: row.liveFlightTotalUsd,
      completeTotalUsd: row.completeTotalUsd,
      fitsBudget: row.fitsBudget
    })),
    metadata: resultMetadata685CR1(selected, assessed, requestedRole, reason)
  };
}

module.exports = {
  VERSION_685C_R1,
  MAX_FLIGHT_LEGS_685C_R1,
  MAX_COMBINATIONS_685C_R1,
  strictBudgetFit685CR1,
  combinations685CR1,
  reconcileWholeTripFares685CR1,
  _internal: { money, providerReference, alternativeScore, assessCombination685CR1, deterministicCombinationOrder685CR1, resultMetadata685CR1 }
};
