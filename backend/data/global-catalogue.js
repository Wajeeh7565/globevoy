'use strict';

let cachedCatalogue = null;
let cachedByCode = null;
let cachedByTrustedId = null;

function isGlobalDiscoveryEnabled() {
  return String(process.env.ENABLE_GLOBAL_DISCOVERY || '').toLowerCase() === 'true';
}

function loadGlobalCatalogue() {
  if (!isGlobalDiscoveryEnabled()) return null;
  if (!cachedCatalogue) {
    cachedCatalogue = require('./global-destination-catalogue.json');
  }
  return cachedCatalogue;
}

function buildIndexes() {
  const catalogue = loadGlobalCatalogue();
  if (!catalogue) return null;
  if (!cachedByCode || !cachedByTrustedId) {
    cachedByCode = new Map();
    cachedByTrustedId = new Map();
    for (const destination of catalogue.destinations || []) {
      if (destination.cityCode && !cachedByCode.has(destination.cityCode)) {
        cachedByCode.set(destination.cityCode, destination);
      }
      for (const trustedId of destination.trustedDestinationIds || []) {
        if (!cachedByTrustedId.has(trustedId)) cachedByTrustedId.set(trustedId, destination);
      }
    }
  }
  return { byCode: cachedByCode, byTrustedId: cachedByTrustedId };
}

function getGlobalDestinationCount() {
  const catalogue = loadGlobalCatalogue();
  return catalogue ? catalogue.destinations.length : 0;
}

function getGlobalDestinationByCode(code) {
  const indexes = buildIndexes();
  if (!indexes) return null;
  return indexes.byCode.get(String(code || '').trim().toUpperCase()) || null;
}

function getGlobalDestinationByTrustedId(trustedId) {
  const indexes = buildIndexes();
  if (!indexes) return null;
  return indexes.byTrustedId.get(String(trustedId || '').trim()) || null;
}

function getGlobalCatalogueSummary() {
  const catalogue = loadGlobalCatalogue();
  return catalogue ? catalogue.summary : null;
}

module.exports = {
  isGlobalDiscoveryEnabled,
  loadGlobalCatalogue,
  getGlobalDestinationCount,
  getGlobalDestinationByCode,
  getGlobalDestinationByTrustedId,
  getGlobalCatalogueSummary
};
