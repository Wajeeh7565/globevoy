import type { BookingRevalidationFlight, BookingRevalidationHotel, BookingRevalidationResponse } from './contracts';

export function formatReviewMoney(value: unknown, currency = 'CAD'): string {
  // In particular, Number(null) is zero. Missing evidence is never a price.
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString('en-CA')}`;
  }
}

export function isSandboxHotel(hotel: BookingRevalidationHotel): boolean {
  return hotel.sandbox === true || hotel.environment === 'sandbox';
}

export function reviewPricing(result: BookingRevalidationResponse | null, now = Date.now()) {
  const ledger = result?.currentPricing;
  const knownLedger = ledger?.version === 'GV-LIVE-712';
  const expiry = Date.parse(ledger?.expiresAt || '');
  const fresh = knownLedger && Number.isFinite(expiry) && expiry > now;
  const sandboxCount = result?.hotels.filter(isSandboxHotel).length || 0;
  const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const complete = Boolean(fresh && ledger?.status === 'live' && positive(ledger.currentTotal)
    && ledger.requiredFlights > 0 && ledger.liveFlights === ledger.requiredFlights
    && ledger.requiredHotels > 0 && ledger.liveHotels === ledger.requiredHotels && sandboxCount === 0);
  const partial = Boolean(fresh && ledger && (ledger.liveFlights > 0 || ledger.liveHotels > 0));
  return {
    complete,
    sandboxCount,
    label: complete ? 'Live' : partial ? 'Partially live' : 'Needs verification',
    currentTotal: complete ? ledger!.currentTotal : null,
    // Do not add saved estimates or sandbox rates to this subtotal.
    flightsTotal: fresh && ledger && ledger.requiredFlights > 0 && ledger.liveFlights === ledger.requiredFlights && positive(ledger.flightsTotal) ? ledger.flightsTotal : null,
    withinBudget: complete ? ledger!.withinBudget : null,
    currency: knownLedger ? ledger!.currency : result?.snapshot.currency || 'CAD',
    expired: Boolean(knownLedger && Number.isFinite(expiry) && expiry <= now)
  };
}

export function flightComparisonLabel(url?: string | null): string {
  try {
    const hostname = new URL(url || '').hostname.toLowerCase();
    if (hostname === 'aviasales.com' || hostname.endsWith('.aviasales.com') || hostname === 'aviasales.ru' || hostname.endsWith('.aviasales.ru')) {
      return 'Compare flights on Aviasales';
    }
  } catch { /* The backend remains responsible for handoff URL validation. */ }
  return 'Compare with flight partner';
}

// Independent comparison only: there is no verified Duffel exact-offer checkout.
export function flightReferral(flight: BookingRevalidationFlight, now = Date.now()): string | null {
  if (flight.sourceType !== 'LIVE' || flight.productionEligible !== true || !flight.handoffEnabled
    || !(Date.parse(flight.expiresAt || '') > now) || !(Number(flight.freshAmount) > 0) || !/^[A-Z]{3}$/.test(flight.currency)) return null;
  try {
    const u = new URL(flight.handoffUrl || '');
    const origin = flight.resolvedOrigin || flight.origin, destination = flight.resolvedDestination || flight.destination;
    const date = flight.departureDate, parsed = Date.parse(date + 'T00:00:00Z');
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || !Number.isFinite(parsed)
      || new Date(parsed).toISOString().slice(0, 10) !== date) return null;
    const prefix = `/search/${origin}${date.slice(8,10)}${date.slice(5,7)}${destination}`;
    return u.protocol === 'https:' && u.hostname === 'www.aviasales.com' && !u.username && !u.password && !u.port
      && u.pathname.startsWith(prefix) && /^[1-9][0-9]{0,2}$/.test(u.pathname.slice(prefix.length)) ? u.href : null;
  } catch { return null; }
}

export function hotelReferral(hotel: BookingRevalidationHotel): { url: string; label: string } | null {
  if (isSandboxHotel(hotel)) return null;
  try {
    const u = new URL(hotel.handoffUrl || '');
    if (u.protocol !== 'https:' || (u.hostname !== 'agoda.com' && !u.hostname.endsWith('.agoda.com')) || u.username || u.password || u.port) return null;
    const ids = [...u.searchParams].filter(([k]) => ['hid','hotelid','hotel_id'].includes(k.toLowerCase())).map(([,v]) => v);
    if (ids.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) || new Set(ids.map(Number)).size > 1) return null;
    const agoda = hotel.provider === 'Agoda';
    if (agoda && hotel.hotelId && ids.some(id => id !== String(hotel.hotelId))) return null;
    for (const [key, value] of u.searchParams) {
      if ((key.toLowerCase() === 'checkin' && hotel.checkin && value !== hotel.checkin)
        || (key.toLowerCase() === 'checkout' && hotel.checkout && value !== hotel.checkout)) return null;
    }
    const exact = agoda && hotel.handoffPropertyVerified === true && Boolean(hotel.hotelId)
      && /\/hotel\/.*\.html$/i.test(u.pathname) && !u.pathname.toLowerCase().includes('partnersearch');
    return { url: u.href, label: exact ? 'Check this property on Agoda' : 'Compare stays on Agoda' };
  } catch { return null; }
}
