'use strict';

const assert = require('node:assert/strict');
process.env.ENABLE_GENERATED_TOUR_651A = 'true';
process.env.ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D = 'true';
const {
  automaticMinimumLeadDays680B,
  initialAutomaticStartDate,
  selectBudgetSafeTour
} = require('./generated-tour');
const { getGeneratedTourControl, _internal: control } = require('./generated-tour-controls');

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function candidate(name, role, stops, total) {
  return {
    name,
    tourRole: role,
    origin: { country: 'United States' },
    stops,
    estimatedTotalUsd: total,
    totalBudgetUsd: 1000,
    totalDistanceKm: stops.length * 2200
  };
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const floor = addDays(today, 14);

  assert.equal(automaticMinimumLeadDays680B({}), 14, 'default automatic lead time');
  assert.ok(initialAutomaticStartDate({ dateMode: 'flexible', preferredMonth: today.slice(0, 7) }) >= floor, 'flexible search does not depart today');
  assert.equal(initialAutomaticStartDate({ dateMode: 'exact', departureDate: today }), today, 'explicit exact date is preserved');
  assert.equal(control.adjustedControlDepartureDate680B({ dateMode: 'flexible', departureDate: today }), floor, 'saved flexible date is moved to lead-time floor');

  const houstonOnly = candidate('Houston only', 'best-balance', [{ city: 'Houston', country: 'United States' }], 760);
  const connected = candidate('Mexico connection', 'best-balance', [
    { city: 'Cancun', country: 'Mexico' },
    { city: 'Mexico City', country: 'Mexico' }
  ], 940);
  const selected = selectBudgetSafeTour([houstonOnly, connected], {
    budget: 1000,
    currency: 'USD',
    routeRole: 'best-balance',
    recommendationScope: 'generated-multicity-tour'
  });
  assert.equal(selected.name, 'Mexico connection', 'best-balance multi-city request prefers a connected route over one domestic stop');

  const restored = await getGeneratedTourControl({
    action: 'restore',
    mode: 'generated-tour',
    recommendationScope: 'generated-multicity-tour',
    origin: 'Los Angeles (LAX)',
    currentStops: 'houston-us',
    savedStops: 'houston-us',
    budget: '1000',
    currency: 'USD',
    adults: '1',
    passengers: '1',
    totalNights: '6',
    dateMode: 'flexible',
    flexible: 'true',
    departureDate: today,
    currentDepartureDate: today,
    preserveDates: 'true',
    minimumLeadDays: '14'
  });
  assert.equal(restored.supported, true, 'one-stop shared route reopens instead of failing');
  assert.equal(restored.routeControl.selectedDepartureDate, floor, 'restored route uses booking lead time');
  assert.equal(restored.routeControl.datesAdjusted, true, 'date adjustment is disclosed');
  assert.match(restored.routeControl.message, /moved forward|over budget/i, 'restoration explains material changes');

  console.log('PASS GV-QUALITY-680B lead time, multi-city selection, and LA saved-route recovery');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
