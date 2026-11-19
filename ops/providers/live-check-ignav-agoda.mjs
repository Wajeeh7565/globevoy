// Live provider spot-check for Ignav (flights) and Agoda hotel-ID search.
//
// Run on YOUR machine (keys stay local, nothing is deployed):
//   ENABLE_IGNAV_FLIGHTS=true IGNAV_API_KEY=... node ops/providers/live-check-ignav-agoda.mjs
//   Optional hotel check: AGODA_SITE_ID=... AGODA_API_KEY=... AGODA_HOTEL_IDS=1001,1002
//
// Cost: one Ignav request per route below (+1 booking-links request per route
// with a fare). Ignav includes 1,000 free requests. Output: a CSV in .cache/.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ignav = require('../../backend/services/providers/flights/ignav/ignav.js');
const agoda = require('../../backend/services/providers/stays/agoda/agoda.js');

function futureDate(daysAhead) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

const ROUTES = [
  ['YYZ', 'LIS', 75], ['LIS', 'BUD', 79], ['BUD', 'YYZ', 83],
  ['YYZ', 'MDE', 90], ['YUL', 'CDG', 60], ['LHR', 'BCN', 45],
  ['JFK', 'MEX', 50], ['YVR', 'NRT', 100]
].map(([origin, destination, days]) => ({ origin, destination, departureDate: futureDate(days) }));

const rows = [['type', 'origin', 'destination', 'date', 'ok', 'reason', 'amount', 'currency', 'stops', 'carrier', 'exact_links', 'top_link_provider', 'top_link_specificity']];

if (!ignav.configured()) {
  console.log('Ignav not configured: set ENABLE_IGNAV_FLIGHTS=true and IGNAV_API_KEY. Skipping flights.');
} else {
  for (const route of ROUTES) {
    const result = await ignav.searchOneWay({ ...route, currency: 'CAD' });
    let links = null;
    if (result.ok && result.cheapest?.ignavId) links = await ignav.getBookingLinks(result.cheapest.ignavId);
    const c = result.cheapest || {};
    rows.push(['flight', route.origin, route.destination, route.departureDate, result.ok, result.reason || '', c.partyTotalAmount ?? '', c.currency ?? '', c.stops ?? '', c.carrier ?? '',
      links?.exactFlightLinkCount ?? '', links?.links?.[0]?.providerName ?? '', links?.links?.[0]?.specificity ?? '']);
    console.log(`${route.origin}->${route.destination} ${route.departureDate}: ${result.ok ? `${c.partyTotalAmount ?? 'no fare'} ${c.currency ?? ''} (${c.stops ?? '?'} stops), exact links: ${links?.exactFlightLinkCount ?? 0}` : `FAILED ${result.reason}`}`);
  }
}

const hotelIds = String(process.env.AGODA_HOTEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (hotelIds.length) {
  const result = await agoda.fetchAgodaHotelListRates({ hotelIds, checkIn: futureDate(76), checkOut: futureDate(79), currency: 'CAD', adults: 1 });
  if (!result.ok) console.log(`Agoda hotel-ID search FAILED: ${result.reason}`);
  for (const h of result.hotels || []) {
    rows.push(['hotel', h.hotelId, h.hotelName, h.requestEvidence.checkIn, true, '', h.stayTotal, h.currency, '', '', '', h.linkType, h.linkHasHotelId ? 'hotel-id-in-link' : 'no-hotel-id']);
    console.log(`Agoda ${h.hotelId} ${h.hotelName}: ${h.stayTotal} ${h.currency} for ${h.nights} nights, link: ${h.linkType}`);
  }
  if (result.unavailableHotelIds?.length) console.log(`No rate returned for: ${result.unavailableHotelIds.join(', ')}`);
}

const out = path.join('.cache', `provider-live-check-${new Date().toISOString().slice(0, 10)}.csv`);
fs.mkdirSync('.cache', { recursive: true });
fs.writeFileSync(out, rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n');
console.log(`\nSaved ${out}`);
