function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, value));
}

function dailyRatiosFor(destination = {}) {
  const theme = String(destination.theme || '').toLowerCase();
  const localCost = String(destination.localCost || '').toLowerCase();
  const walkability = String(destination.walkability || '').toLowerCase();

  let food = 0.60;
  let localTransport = 0.25;

  if (localCost.includes('high')) {
    food = 0.62;
    localTransport = 0.23;
  }

  if (theme.includes('coast') || theme.includes('nature')) {
    localTransport += 0.03;
    food -= 0.02;
  }

  if (walkability.includes('high')) {
    localTransport -= 0.03;
    food += 0.02;
  }

  food = clampRatio(food);
  localTransport = clampRatio(localTransport);
  const everydayBuffer = clampRatio(1 - food - localTransport);

  return { food, localTransport, everydayBuffer };
}

function splitDailySpend(destination = {}) {
  const dailyTotal = Math.round(number(destination.dailySpendUsd, 0));
  const ratios = dailyRatiosFor(destination);
  const food = Math.round(dailyTotal * ratios.food);
  const localTransport = Math.round(dailyTotal * ratios.localTransport);
  const everydayBuffer = Math.max(0, dailyTotal - food - localTransport);

  return {
    food,
    localTransport,
    everydayBuffer,
    total: dailyTotal
  };
}

function buildDailyBudget(destination = {}, tripDays = 1) {
  const days = Math.max(1, Math.round(number(tripDays, 1)));
  const perDay = splitDailySpend(destination);
  const basicActivities = Math.round(number(destination.activitiesLocalUsd, 0));

  return {
    source: destination.dailySpendSource || 'manual MVP estimate - needs verification',
    method: 'MVP manual daily-spend estimate split into food, local transport, and everyday buffer; needs source verification.',
    confidence: 'mvp-estimate',
    perDay,
    trip: {
      food: perDay.food * days,
      localTransport: perDay.localTransport * days,
      everydayBuffer: perDay.everydayBuffer * days,
      basicActivities,
      total: perDay.total * days + basicActivities
    }
  };
}

module.exports = {
  buildDailyBudget,
  splitDailySpend
};
