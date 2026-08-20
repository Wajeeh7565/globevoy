(function () {
  'use strict';

  const PERSONAL_EXPENSE_RESERVE_PERCENT = 0.10;

  function calculate(totalBudget) {
    const safeTotal = Math.max(0, Number(totalBudget) || 0);
    const reserveAmount = safeTotal * PERSONAL_EXPENSE_RESERVE_PERCENT;
    return {
      totalBudget: safeTotal,
      reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
      reserveAmount,
      usableTripBudget: safeTotal - reserveAmount
    };
  }

  window.GlobevoyBudgetModel = Object.freeze({
    reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
    calculate
  });
})();
