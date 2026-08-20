'use strict';

// Rollover-safe parity validation for the 681B P2/P2-R2 path.
// The original 681B fixtures are pinned to Aug 27/28 2026 and now cross the
// +14-day automatic lead-time floor. This validator preserves their intent using
// dates derived from the current floor so it remains valid over time.

Object.assign(process.env, {
  ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B: 'true',
  ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A: 'true',
  ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B: 'true',
  ENABLE_SMART_FLIGHT_DATE_SELECTION_677B: 'true',
  ENABLE_ITINERARY_DATE_INTEGRITY_677B_R1: 'true',
  ENABLE_WHOLE_TRIP_DATE_OPTIMIZER_681B_P2: 'true',
  ENABLE_PASSENGER_ROOM_PRICING_666A: 'true',
  TRAVELPAYOUTS_TOKEN: 'fixture-token'
});

const assert = require('node:assert/strict');
const generated = require('./generated-tour');
const { automaticDateFloor } = require('./services/price-evidence-integrity');
const cheap = require('./services/cheap-one-way-flights');

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function month(date) { return date.slice(0, 7); }

const startA = automaticDateFloor({ minimumLeadDays: 14 });
const startB = addDays(startA, 1);
const scheduleA = [startA, addDays(startA, 3), addDays(startA, 5)];
const scheduleB = [startB, addDays(startB, 3), addDays(startB, 5)];

const legs = [
  { mode:'flight', transportType:'flight', from:{city:'Dublin',airportCode:'DUB'}, to:{city:'Tangier',airportCode:'TNG'}, estimatedTransportUsd:170 },
  { mode:'flight', transportType:'flight', from:{city:'Tangier',airportCode:'TNG'}, to:{city:'Porto',airportCode:'OPO'}, estimatedTransportUsd:120 },
  { mode:'flight', transportType:'flight', from:{city:'Porto',airportCode:'OPO'}, to:{city:'Dublin',airportCode:'DUB'}, estimatedTransportUsd:150 }
];
const stops = [
  { city:'Tangier', nights:3, hotel:{estimatedNightlyUsd:50,estimatedStayUsd:150} },
  { city:'Porto', nights:2, hotel:{estimatedNightlyUsd:70,estimatedStayUsd:140} }
];

function makeFixtureMap({ secondComplete = true } = {}) {
  const rows = new Map();
  function put(origin, destination, date, price) {
    const key = `${origin}-${destination}-${month(date)}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push([date, price]);
  }
  put('DUB','TNG',scheduleA[0],101);
  put('DUB','TNG',scheduleB[0],127);
  put('TNG','OPO',scheduleA[1],140);
  put('TNG','OPO',scheduleB[1],70);
  put('OPO','DUB',scheduleA[2],110);
  if (secondComplete) put('OPO','DUB',scheduleB[2],80);
  return rows;
}

async function runScenario({ secondComplete }) {
  cheap._clearCache();
  const fixtures = makeFixtureMap({ secondComplete });
  const realFetch = global.fetch;
  global.fetch = async url => {
    const u = new URL(url);
    const key = `${u.searchParams.get('origin')}-${u.searchParams.get('destination')}-${u.searchParams.get('departure_at')}`;
    const data = (fixtures.get(key) || []).map(([date, price]) => ({ departure_at:`${date}T10:00:00+00:00`, price, duration:240, transfers:0, airline:'ZZ' }));
    return { ok:true, status:200, text:async()=>JSON.stringify({ success:true, data }) };
  };
  try {
    const tour = {
      title:'683D rollover-safe P2 parity fixture',
      origin:{city:'Dublin',airportCode:'DUB',code:'DUB'},
      legs:legs.map(x=>({...x})),
      stops:stops.map(x=>({...x,hotel:{...x.hotel}})),
      totalBudgetUsd:900,
      estimatedTotalUsd:730
    };
    const query = { currency:'EUR', budget:900, pickRole:'lowest-cost', preferredMonth:month(startA), passengers:1, rooms:1 };
    return await generated.enrichTourWithCheapFlights(tour, query);
  } finally {
    global.fetch = realFetch;
  }
}

(async()=>{
  const optimized = await runScenario({ secondComplete:true });
  const a = optimized.summary.wholeTripDateOptimization;
  assert.equal(a.version, 'GV-TRUST-681B-P2');
  assert.equal(a.applied, true);
  assert.ok(a.completeCandidateCount >= 2);
  assert.equal(a.selectedStartDate, startB);
  assert.deepEqual(a.selectedSchedule, scheduleB);
  assert.deepEqual(optimized.tour.legs.map(leg => leg.departureDate), scheduleB);
  assert.ok(optimized.tour.legs.every(leg => leg?.cheapestOneWay?.selectionReason === 'whole-trip-date-optimizer-681b-p2'));
  console.log('PASS rollover-safe P2 complete-schedule optimization parity');

  const fallback = await runScenario({ secondComplete:false });
  const b = fallback.summary.wholeTripDateOptimization;
  assert.equal(b.applied, false);
  assert.equal(b.truthfulnessRepairVersion, 'GV-TRUST-681B-P2-R2');
  assert.equal(b.reason, 'fewer-than-two-complete-provider-backed-flight-schedules');
  assert.ok(b.candidateCount >= 2);
  assert.equal(b.completeCandidateCount, 1);
  assert.ok(b.incompleteCandidateCount >= 1);
  assert.ok(b.missingFlightObservationCount >= 1);
  console.log('PASS rollover-safe P2-R2 insufficient-coverage truthfulness parity');

  console.log('PASS 2/2 - GV-PROVIDER-683D P2 rollover-safe parity');
})().catch(error=>{ console.error(error.stack || error); process.exit(1); });
