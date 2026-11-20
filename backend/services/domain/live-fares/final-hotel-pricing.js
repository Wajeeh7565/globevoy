'use strict';
// Final hotel pass shared by both search engines: price the trip that will be shown
// with live Nuitee rates, keep them only when the trip still fits the budget (or the
// live hotels cost no more than the estimates), and rebuild the page total from them.
// Moved out of tours/generated-tour.js without behaviour changes.
const { applyNuiteeLiveStays, status: nuiteeLiveStaysStatus } = require('./nuitee-live-stays');
const { attachTourPresentation } = require('../pricing/budget-presentation');

// Nuitee step. Price the FINAL returned tour here, once, and keep the live
// rates only when the trip still fits the user's budget (otherwise keep the
// estimate + Agoda link, unchanged).
function hasNuiteeRates(tour) {
  return Boolean((tour?.stops || []).some(stop => stop?.hotel?.nuiteeLiveRate));
}


// The visualizer/booking pages read tour.cities / stays / legs, which on the
// final (already assembled) tour are separate copies of each stop's hotel.
function syncNuiteeHotelsIntoViews(tour) {
  const stops = Array.isArray(tour?.stops) ? tour.stops : [];
  stops.forEach((stop, index) => {
    const hotel = stop?.hotel;
    if (!hotel?.nuiteeLiveRate) return;
    for (const key of ['cities', 'stays']) {
      const row = Array.isArray(tour[key]) ? tour[key][index] : null;
      if (row && typeof row === 'object') row.hotel = hotel;
    }
    for (const key of ['legs', 'backendLegs']) {
      const legs = Array.isArray(tour[key]) ? tour[key] : [];
      if (legs[index]?.to && typeof legs[index].to === 'object') legs[index].to.hotel = hotel;
      if (legs[index + 1]?.from && typeof legs[index + 1].from === 'object') legs[index + 1].from.hotel = hotel;
    }
  });
  return tour;
}

async function priceFinalTourWithNuitee(result, query = {}, options = {}, deps = {}) {
  if (!result || result.ok !== true || !result.tour || !nuiteeLiveStaysStatus(options.env).enabled) return result;
  if (hasNuiteeRates(result.tour)) return result;
  let live;
  try { live = await (options.applyNuiteeLiveStays || applyNuiteeLiveStays)(result.tour, query, options); }
  catch (_) { live = { tour: result.tour, summary: { ...nuiteeLiveStaysStatus(options.env), attempted: true, applied: false, reason: 'nuitee-unexpected-error' } }; }
  const summary = { ...(live?.summary || {}), finalTourPass: true };
  const diagnostics = { ...(result.diagnostics || {}) };
  if (!summary.applied || !live.tour) {
    diagnostics.nuiteeLiveStays = summary;
    return { ...result, diagnostics };
  }
  // Keep live rates when the trip still fits the budget, or when the live
  // hotels are no more expensive than the estimates they replace (the trip's
  // budget status then doesn't get worse, and real prices beat guesses).
  const hotelUsd = tour => (tour?.stops || []).reduce((sum, stop) => sum + (Number(stop?.hotel?.estimatedStayUsd ?? stop?.hotel?.totalStayUsd) || 0), 0);
  const liveHotelsNotPricier = hotelUsd(live.tour) <= hotelUsd(result.tour) + 1;
  if ((deps.isOverBudget ? deps.isOverBudget(live.tour, query) : false) && !liveHotelsNotPricier) {
    diagnostics.nuiteeLiveStays = { ...summary, applied: false, appliedCount: 0, reason: 'nuitee-final-tour-over-budget-kept-estimate' };
    return { ...result, diagnostics };
  }
  diagnostics.nuiteeLiveStays = summary;
  syncNuiteeHotelsIntoViews(live.tour);
  // The page's total (displayBudget) was built from the hotel estimates; rebuild it
  // from the live rates so the trip page matches the booking page's line items.
  const repriced = live.tour.displayBudget ? attachTourPresentation(live.tour, query) : live.tour;
  const original = result.tour;
  const tours = Array.isArray(result.tours) ? result.tours.map(t => (t === original ? repriced : t)) : result.tours;
  return { ...result, tour: repriced, tours, diagnostics };
}

module.exports = { priceFinalTourWithNuitee, hasNuiteeRates, syncNuiteeHotelsIntoViews };
