'use strict';

const foundation = require('../../../data/grouped-city-foundation.json').records;
const records = new Map(foundation.map(record => [record.cityId, record]));
// Historical catalogue breadth corroborates the reviewed role. It cannot establish
// popularity by itself or prove that a room is available on the requested dates.
const inventory = foundation.map(record => record.providerSupport.hotel.hotelCount).filter(n => n > 0).sort((a, b) => a - b);
const medianInventory = inventory[Math.floor(inventory.length / 2)];
const upperInventory = inventory[Math.floor(inventory.length * .75)];

function destinationProfile(cityId, theme) {
  const record = records.get(cityId);
  if (!record || record.taxonomyReviewRequired || !record.providerSupport.flight.locationFlightable) return null;
  const rooms = record.providerSupport.hotel.hotelCount;
  const scores = record.cityIntelligence.themeScores;
  const strongest = Math.max(...Object.values(scores));
  if (!(rooms > 0 && strongest >= 4)) return null;
  const themeFit = Number(scores[theme] || 0) / 5;
  const breadth = rooms / (rooms + medianInventory);
  const interest = .8 * strongest / 5 + .2 * themeFit;
  if (record.group === 'GROUP_1' && (record.groupSubtype === 'famous-anchor' || rooms >= medianInventory)) {
    return { role: 'anchor', strength: interest * (.7 + .3 * breadth) };
  }
  if (record.group === 'GROUP_2' && (rooms < upperInventory || record.groupSubtype === 'hidden-gem-value')) {
    return { role: 'discovery', strength: interest * (.75 + .25 * (1 - breadth)) };
  }
  return null;
}

function mixStrength(profiles) {
  let anchor = 0, discovery = 0;
  for (const profile of profiles) {
    if (profile?.role === 'anchor') anchor = Math.max(anchor, profile.strength);
    if (profile?.role === 'discovery') discovery = Math.max(discovery, profile.strength);
  }
  return Math.min(anchor, discovery);
}

module.exports = { destinationProfile, mixStrength };
