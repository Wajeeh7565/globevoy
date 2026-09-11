import type { BookingRevalidationHotel, BookingRevalidationResponse } from './contracts';

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
      return 'Compare on Aviasales';
    }
  } catch { /* The backend remains responsible for handoff URL validation. */ }
  return 'Compare with flight partner';
}
