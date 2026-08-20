(function attachGlobevoyBudgetContract(global) {
  'use strict';

  function integer(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : (fallback || 0);
  }

  function getDisplayBudget(item) {
    if (!item || !item.displayBudget) {
      throw new Error('GV-MIXED-610C requires item.displayBudget from the backend.');
    }
    var budget = item.displayBudget;
    var required = [
      'currency',
      'symbol',
      'totalBudget',
      'reserveAmount',
      'usableTripBudget',
      'tripEstimate',
      'amountLeft'
    ];
    required.forEach(function requireField(field) {
      if (budget[field] === undefined || budget[field] === null) {
        throw new Error('Missing displayBudget.' + field);
      }
    });
    return budget;
  }

  function formatMoney(value, budgetOrCurrency) {
    var symbol = '$';
    if (budgetOrCurrency && typeof budgetOrCurrency === 'object') symbol = budgetOrCurrency.symbol || symbol;
    else if (budgetOrCurrency === 'CAD') symbol = 'C$';
    else if (budgetOrCurrency === 'AUD') symbol = 'A$';
    else if (budgetOrCurrency === 'EUR') symbol = '€';
    else if (budgetOrCurrency === 'GBP') symbol = '£';
    return symbol + integer(value).toLocaleString('en-US');
  }

  function cardViewModel(item) {
    var budget = getDisplayBudget(item);
    return {
      currency: budget.currency,
      estimatedTrip: formatMoney(budget.tripEstimate, budget),
      estimatedAmountLeft: formatMoney(budget.amountLeft, budget),
      protectedReserve: formatMoney(budget.reserveAmount, budget),
      flightEstimate: formatMoney(budget.flightEstimate, budget),
      accommodationEstimate: formatMoney(budget.accommodationEstimate, budget),
      usableTripBudget: formatMoney(budget.usableTripBudget, budget),
      equationConsistent: Boolean(budget.equation && budget.equation.consistent),
      explanation: item.displayWhyItFits || null
    };
  }

  function assertConsistent(item) {
    var budget = getDisplayBudget(item);
    var expected = integer(budget.totalBudget) - integer(budget.reserveAmount) - integer(budget.tripEstimate);
    if (expected !== integer(budget.amountLeft)) {
      throw new Error('Mixed result budget equation is inconsistent.');
    }
    if (integer(budget.flightEstimate) + integer(budget.accommodationEstimate) !== integer(budget.tripEstimate)) {
      throw new Error('Displayed flight and accommodation do not equal displayed trip estimate.');
    }
    return true;
  }

  global.GlobevoyBudgetContract = {
    version: 'GV-MIXED-610C-1',
    getDisplayBudget: getDisplayBudget,
    formatMoney: formatMoney,
    cardViewModel: cardViewModel,
    assertConsistent: assertConsistent
  };
})(typeof window !== 'undefined' ? window : globalThis);
