'use strict';

let cachedFoundation = null;
let cachedById = null;

function loadGroupedCityFoundation() {
  if (!cachedFoundation) cachedFoundation = require('./grouped-city-foundation.json');
  return cachedFoundation;
}

function buildIndex() {
  if (!cachedById) {
    cachedById = new Map();
    for (const record of loadGroupedCityFoundation().records || []) {
      cachedById.set(String(record.cityId || '').toLowerCase(), record);
    }
  }
  return cachedById;
}

function getGroupedCityById(cityId) {
  return buildIndex().get(String(cityId || '').trim().toLowerCase()) || null;
}

function getCitiesByGroup(group, options = {}) {
  const wanted = String(group || '').trim().toUpperCase();
  const initialOnly = options.initialOnly === true;
  const tiers = Array.isArray(options.activationTiers)
    ? new Set(options.activationTiers.map(value => String(value).toUpperCase()))
    : null;

  return (loadGroupedCityFoundation().records || []).filter(record => {
    if (record.group !== wanted) return false;
    if (initialOnly && record.initialLaunchSet !== true) return false;
    if (tiers && !tiers.has(String(record.multiCitySuitability?.activationTier || '').toUpperCase())) return false;
    return true;
  });
}

function getGroup1Cities(options = {}) {
  return getCitiesByGroup('GROUP_1', options);
}

function getGroup2Cities(options = {}) {
  return getCitiesByGroup('GROUP_2', options);
}

function getInitialLaunchSets() {
  return loadGroupedCityFoundation().initialLaunchSets;
}

function getGroupedCityFoundationSummary() {
  return loadGroupedCityFoundation().summary;
}

module.exports = {
  loadGroupedCityFoundation,
  getGroupedCityById,
  getCitiesByGroup,
  getGroup1Cities,
  getGroup2Cities,
  getInitialLaunchSets,
  getGroupedCityFoundationSummary
};
