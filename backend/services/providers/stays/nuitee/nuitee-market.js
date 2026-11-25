'use strict';

const MAX_MARKET_DISTANCE_KM = 25;
const propertyId = /^[A-Za-z0-9_-]{2,64}$/;
const cityName = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function point(record) {
  const { latitude, longitude } = record || {};
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [latitude * Math.PI / 180, longitude * Math.PI / 180];
}

function matchesMarket(property, destination) {
  const name = cityName(destination.city || destination.displayName);
  const country = String(destination.countryCode || '').toUpperCase();
  const actualCountry = String(property?.country_code ?? property?.country ?? '').trim().toUpperCase();
  if (!name || cityName(property?.city_name ?? property?.city) !== name ||
      !/^[A-Z]{2}$/.test(country) || country !== actualCountry) return false;
  const center = point(destination), location = point(property);
  if (!center || !location) return false;
  const [lat, lon] = center, [hotelLat, hotelLon] = location;
  const h = Math.sin((hotelLat - lat) / 2) ** 2 +
    Math.cos(lat) * Math.cos(hotelLat) * Math.sin((hotelLon - lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h))) <= MAX_MARKET_DISTANCE_KM;
}

function matchesOccupancies(rates, occupancies) {
  if (!Array.isArray(rates) || !Array.isArray(occupancies) || rates.length !== occupancies.length) return false;
  const signature = (adults, ages) => [adults, ...ages.slice().sort((a, b) => a - b)].join(',');
  const actual = [];
  const occupancyNumbers = new Set();
  for (const rate of rates) {
    const ages = rate?.childrenAges ?? [];
    if (!Number.isInteger(rate?.adultCount) || !Number.isInteger(rate?.childCount) ||
        !Array.isArray(ages) || ages.length !== rate.childCount || !ages.every(Number.isInteger)) return false;
    if (rate.occupancyNumber != null) {
      if (!Number.isInteger(rate.occupancyNumber) || occupancyNumbers.has(rate.occupancyNumber)) return false;
      occupancyNumbers.add(rate.occupancyNumber);
    }
    actual.push(signature(rate.adultCount, ages));
  }
  const expected = occupancies.map(room => signature(room.adults, room.children)).sort();
  return actual.sort().every((room, i) => room === expected[i]);
}

function catalogueMarkets(evidence, registry) {
  if (evidence?.schema !== 1 || evidence.source !== 'nuitee-production-data-hotels' ||
      !Array.isArray(evidence.records)) return new Map();
  const cities = new Map(registry.map(city => [city.cityId, city]));
  const markets = new Map();
  // Records are reviewed snapshots from the authenticated catalogue and ship with the backend.
  for (const row of evidence.records) {
    const city = cities.get(row?.cityId);
    if (!city || !Number.isFinite(Date.parse(row.observedAt)) || row.sandbox === true ||
        !Array.isArray(row.hotels)) continue;
    const property = row.hotels.find(h => typeof h?.id === 'string' && propertyId.test(h.id) &&
      typeof h.city === 'string' && matchesMarket(h, city));
    if (property) markets.set(city.cityId, { cityName: property.city });
  }
  return markets;
}

module.exports = { matchesMarket, matchesOccupancies, catalogueMarkets, propertyId };
