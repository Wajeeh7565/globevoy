const PERSONAL_EXPENSE_RESERVE_PERCENT = 0.10;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildBudgetReserve(totalBudgetUsd) {
  const totalBudget = Math.max(1, number(totalBudgetUsd, 1));
  const reserveAmount = totalBudget * PERSONAL_EXPENSE_RESERVE_PERCENT;
  const usableTripBudget = totalBudget - reserveAmount;

  return {
    totalBudget,
    reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
    reserveAmount,
    usableTripBudget
  };
}

module.exports = {
  PERSONAL_EXPENSE_RESERVE_PERCENT,
  buildBudgetReserve
};
