import type { JsonObject, PriceEvidence } from '@/lib/contracts';

export const GV_WEB_708A_VERSION = 'GV-WEB-708A';

export type RecommendationKind = 'single' | 'multi';

export interface ResultsSearch {
  rawOrigin: string;
  originCode: string;
  originCity: string;
  budget: number;
  currency: string;
  adults: number;
  children: number;
  passengers: number;
  nights: number;
  tripLength: string;
  interests: string[];
  hotelStyle: string;
  region: string;
  month: string;
}

export interface ResultsCity {
  id?: string;
  city: string;
  country: string;
  code: string;
  lat?: number;
  lng?: number;
}

export interface RecommendationCardModel {
  id: string;
  kind: RecommendationKind;
  label: string;
  featured: boolean;
  title: string;
  route: string;
  nights: number;
  total: number;
  remaining: number;
  reserveAmount: number;
  sourceBudgetTotal: number;
  score: number;
  themes: string[];
  why: string;
  evidence: PriceEvidence;
  image?: string;
  city?: string;
  country?: string;
  code?: string;
  flight?: number;
  stay?: number;
  cities?: ResultsCity[];
  routeId?: string;
  raw: JsonObject;
  selectionPayload: JsonObject;
}

const FX: Record<string, number> = { USD: 1, CAD: 1.36, AUD: 1.52, EUR: 0.92, GBP: 0.79 };

function clean(value: unknown): string { return String(value == null ? '' : value).trim(); }
function finite(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function record(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function rows(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as JsonObject[] : []; }
function slug(value: unknown): string { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function positive(value: unknown): number | undefined { const n = finite(value, 0); return n > 0 ? n : undefined; }
function numberField(obj: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) { const n = positive(obj[key]); if (n !== undefined) return n; }
  return undefined;
}
function stringField(obj: JsonObject, ...keys: string[]): string {
  for (const key of keys) { const value = clean(obj[key]); if (value) return value; }
  return '';
}
function nestedNumber(obj: JsonObject, path: string[]): number | undefined {
  let value: unknown = obj;
  for (const key of path) value = record(value)[key];
  return positive(value);
}
function point(obj: JsonObject): { lat: number; lng: number } | null {
  const lat = finite(obj.lat ?? obj.latitude, NaN);
  const lng = finite(obj.lng ?? obj.longitude, NaN);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function parseResultsSearch(params: URLSearchParams): ResultsSearch {
  const rawOrigin = clean(params.get('origin'));
  const codeMatch = rawOrigin.toUpperCase().match(/(?:\(|\b)([A-Z]{3})(?:\)|\b)/);
  const originCode = clean(params.get('originCode') || codeMatch?.[1]).toUpperCase();
  const originCity = rawOrigin.replace(/\s*\([A-Z]{3}\)\s*$/i, '').trim() || originCode || 'Origin';
  const adults = Math.max(1, Math.round(finite(params.get('adults'), finite(params.get('passengers'), 1))));
  const children = Math.max(0, Math.round(finite(params.get('children'), 0)));
  return {
    rawOrigin,
    originCode,
    originCity,
    budget: Math.max(300, finite(params.get('budget'), 1000)),
    currency: clean(params.get('currency') || 'CAD').toUpperCase(),
    adults,
    children,
    passengers: Math.max(1, Math.round(finite(params.get('passengers'), adults + children))),
    nights: Math.max(2, Math.min(21, Math.round(finite(params.get('nights'), 5)))),
    tripLength: clean(params.get('tripLength') || 'auto'),
    interests: clean(params.get('interests') || 'No preference').split(',').map((value) => value.trim()).filter(Boolean),
    hotelStyle: clean(params.get('hotelStyle') || params.get('style') || 'Best balance'),
    region: clean(params.get('region') || 'All continents'),
    month: clean(params.get('preferredMonth') || params.get('month'))
  };
}

export function recommendationApiParams(search: ResultsSearch): Record<string, string | number | undefined> {
  return {
    origin: search.originCode || search.rawOrigin,
    budget: search.budget,
    nights: search.nights,
    month: search.month || undefined,
    style: search.hotelStyle,
    hotelStyle: search.hotelStyle,
    interests: search.interests.join(','),
    region: search.region === 'All continents' ? undefined : search.region,
    currency: search.currency,
    limit: 500
  };
}

function themeValue(search: ResultsSearch): string | undefined {
  const value = clean(search.interests[0]).toLowerCase();
  if (value.includes('food')) return 'food';
  if (value.includes('history') || value.includes('culture')) return 'history-and-culture';
  if (value.includes('nature')) return 'nature';
  if (value.includes('beach')) return 'beaches';
  if (value.includes('night')) return 'nightlife';
  if (value.includes('family')) return 'family';
  if (value.includes('relax')) return 'relaxation';
  return undefined;
}

export function multiCityApiParams(search: ResultsSearch): Record<string, string | number | undefined> {
  if (search.tripLength !== 'auto' && search.nights < 4) return { disabled: '1' };
  return {
    origin: search.originCode || search.rawOrigin,
    budget: search.budget,
    currency: search.currency,
    adaptiveDuration: search.tripLength === 'auto' ? 'true' : 'false',
    totalNights: search.tripLength === 'auto' ? undefined : Math.max(4, search.nights),
    maxStops: 3,
    theme: themeValue(search),
    month: search.month || undefined
  };
}

function evidenceFor(raw: JsonObject, kind: RecommendationKind): PriceEvidence {
  const priceEvidence = record(raw.priceEvidence ?? raw.overallPriceEvidence);
  const evidenceClass = clean(priceEvidence.evidenceClass ?? priceEvidence.class ?? raw.evidenceClass ?? raw.pricingStatus).toUpperCase();
  if (evidenceClass === 'LIVE' || evidenceClass.includes('LIVE_PROVIDER')) {
    return { state: 'provider', label: 'Provider-backed price evidence', note: 'Fresh provider evidence is present, but final price and availability are still confirmed by the partner.' };
  }
  if (evidenceClass === 'CACHED' || evidenceClass.includes('CACHE')) {
    return { state: 'cached', label: 'Cached price evidence', note: 'This price uses provider evidence that may have changed. Recheck before booking.' };
  }
  if (evidenceClass === 'UNAVAILABLE') {
    return { state: 'unavailable', label: 'Price needs verification', note: 'Current provider evidence is unavailable.' };
  }
  return {
    state: 'estimate',
    label: kind === 'multi' ? 'Planning estimate — verify route prices' : 'Planning estimate — verify before booking',
    note: 'The recommendation is suitable for planning, not a guaranteed quote. Final prices and availability are confirmed later.'
  };
}

function displayRate(search: ResultsSearch, raw: JsonObject): number {
  const displayBudget = record(raw.displayBudget);
  return positive(displayBudget.exchangeRateFromUsd) || FX[search.currency] || 1;
}

function adaptSingle(raw: JsonObject, search: ResultsSearch): RecommendationCardModel | null {
  const city = stringField(raw, 'city');
  if (!city) return null;
  const country = stringField(raw, 'country');
  const code = stringField(raw, 'code', 'airportCode').toUpperCase();
  const budget = record(raw.displayBudget);
  const rate = displayRate(search, raw);
  const flightUsd = numberField(raw, 'flight', 'flightUsd', 'flightEstimateUsd') || nestedNumber(raw, ['costs', 'flightUsd']) || 0;
  const stayUsd = numberField(raw, 'lodging', 'stay', 'stayUsd', 'stayEstimateUsd') || nestedNumber(raw, ['costs', 'stayUsd']) || 0;
  const totalUsd = numberField(raw, 'estimatedFlightAndStayTotal', 'total') || flightUsd + stayUsd;
  const total = numberField(budget, 'tripEstimate') || totalUsd * rate;
  if (!(total > 0)) return null;
  const flight = numberField(budget, 'flightEstimate') || flightUsd * rate;
  const stay = numberField(budget, 'accommodationEstimate') || stayUsd * rate;
  const reserveAmount = numberField(budget, 'reserveAmount') ?? Math.round(search.budget * 0.1);
  const usableTripBudget = numberField(budget, 'usableTripBudget') ?? (search.budget - reserveAmount);
  const remaining = finite(budget.amountLeft, usableTripBudget - total);
  const sourceBudgetTotal = numberField(budget, 'totalBudget') || search.budget;
  const p = point(raw);
  const why = stringField(raw, 'displayWhyItFits', 'whyItFits', 'explanation') || `${city} fits the selected budget using the available recommendation evidence.`;
  const themes = Array.isArray(raw.themes) ? raw.themes.map(clean).filter(Boolean) : Array.isArray(raw.primaryTravelThemes) ? raw.primaryTravelThemes.map(clean).filter(Boolean) : [];
  const nights = Math.max(2, Math.round(finite(raw.nights, search.nights)));
  const image = stringField(raw, 'img', 'image', 'imageUrl');
  const normalizedRaw: JsonObject = { ...raw, flight, stay, total, remaining, reserveAmount, usableTripBudget, sourceBudgetTotal, why, nights };
  return {
    id: `single-${slug(raw.id || code || city)}`,
    kind: 'single', label: '', featured: false,
    title: [city, country].filter(Boolean).join(', '),
    route: `${search.originCity} → ${city}`,
    nights, total, remaining, reserveAmount, sourceBudgetTotal,
    score: finite(raw.recommendationScore ?? raw.score, 0),
    themes: themes.slice(0, 4), why, evidence: evidenceFor(raw, 'single'), image,
    city, country, code, flight, stay,
    raw: normalizedRaw,
    selectionPayload: { ...normalizedRaw, city, country, code, lat: p?.lat, lng: p?.lng, flight, stay, total, nights, why, themes }
  };
}

function adaptCity(raw: JsonObject): ResultsCity {
  const p = point(raw);
  return {
    id: stringField(raw, 'cityId', 'id') || undefined,
    city: stringField(raw, 'city'),
    country: stringField(raw, 'country'),
    code: stringField(raw, 'airportCode', 'code').toUpperCase(),
    lat: p?.lat,
    lng: p?.lng
  };
}

function adaptMulti(raw: JsonObject, search: ResultsSearch): RecommendationCardModel | null {
  const sourceCities = rows(raw.stops).length ? rows(raw.stops) : rows(raw.cities);
  if (!sourceCities.length) return null;
  const cities = sourceCities.map(adaptCity).filter((city) => city.city);
  if (!cities.length) return null;
  const budget = record(raw.displayBudget);
  const legacyBudget = record(raw.budget);
  const rate = displayRate(search, raw);
  const total = numberField(budget, 'tripEstimate') || nestedNumber(legacyBudget, ['estimatedCoreTotal', 'amount']) || finite(raw.estimatedTotalUsd, 0) * rate;
  if (!(total > 0)) return null;
  const remaining = finite(budget.amountLeft, nestedNumber(legacyBudget, ['remainingCoreRoom', 'amount']) ?? search.budget - total);
  const reserveAmount = numberField(budget, 'reserveAmount') || nestedNumber(legacyBudget, ['personalExpenseReserve', 'amount']) || 0;
  const sourceBudgetTotal = numberField(budget, 'totalBudget') || search.budget;
  const origin = record(raw.origin);
  const originCity = stringField(origin, 'city') || search.originCity;
  const title = stringField(raw, 'title') || cities.map((city) => city.city).join(' + ');
  const why = stringField(raw, 'displayWhyItFits', 'recommendationExplanation', 'whyCitiesWork')
    || (Array.isArray(raw.routeExplanation) ? raw.routeExplanation.map(clean).filter(Boolean).join(' ') : '')
    || 'A connected route selected for budget fit and practical transport.';
  const routeId = stringField(raw, 'tourId', 'routeId') || slug(title);
  const nights = Math.max(1, Math.round(finite(raw.totalNights, search.nights)));
  const route = [originCity, ...cities.map((city) => city.city), originCity].join(' → ');
  return {
    id: `multi-${slug(routeId || title)}`,
    kind: 'multi', label: '', featured: false, title, route, nights, total, remaining, reserveAmount, sourceBudgetTotal,
    score: finite(raw.score ?? raw.automaticScore, 0), themes: cities.slice(0, 4).map((city) => city.city), why,
    evidence: evidenceFor(raw, 'multi'), cities, routeId, raw,
    selectionPayload: raw
  };
}

export function adaptRecommendations(payload: unknown, search: ResultsSearch): RecommendationCardModel[] {
  const root = record(payload);
  return rows(root.recommendations).map((item) => adaptSingle(item, search)).filter(Boolean) as RecommendationCardModel[];
}

export function adaptMultiCityTours(payload: unknown, search: ResultsSearch): RecommendationCardModel[] {
  const root = record(payload);
  return rows(root.tours).map((item) => adaptMulti(item, search)).filter(Boolean) as RecommendationCardModel[];
}

function unique(items: RecommendationCardModel[]): RecommendationCardModel[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.kind === 'single' ? `s:${clean(item.city).toLowerCase()}` : `m:${(item.cities || []).map((city) => city.city.toLowerCase()).join('|')}`;
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function distanceKm(a: { lat?: number; lng?: number } | null, b: { lat?: number; lng?: number } | null): number {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return 0;
  const radius = 6371; const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(Number(b.lat) - Number(a.lat)); const dLng = rad(Number(b.lng) - Number(a.lng));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(a.lat))) * Math.cos(rad(Number(b.lat))) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function itemPoint(item: RecommendationCardModel): { lat?: number; lng?: number } | null {
  if (item.kind === 'single') { const p = point(item.raw); return p || null; }
  return item.cities?.find((city) => Number.isFinite(city.lat) && Number.isFinite(city.lng)) || null;
}

type ScoredCard = RecommendationCardModel & { valueScore?: number };

export function pickPortfolio(singles: RecommendationCardModel[], multis: RecommendationCardModel[], search: ResultsSearch): RecommendationCardModel[] {
  const all: ScoredCard[] = unique([...singles, ...multis]).filter((item) => item.total <= search.budget * 1.08)
    .map((item) => ({ ...item, valueScore: Math.max(0, search.budget - item.total) / Math.max(1, search.budget) }));
  if (!all.length) return [];
  const chosen: ScoredCard[] = [];
  const take = (candidate: ScoredCard | undefined, label: string, featured = false) => {
    if (!candidate || chosen.some((item) => item.id === candidate.id)) return;
    chosen.push({ ...candidate, label, featured });
  };
  const cheapest = [...all].sort((a, b) => a.total - b.total || b.score - a.score)[0];
  take(cheapest, 'Lowest cost');
  const target = search.budget * 0.78;
  let balance: ScoredCard | undefined = [...all].filter((item) => item.id !== cheapest?.id)
    .sort((a, b) => Math.abs(a.total - target) - Math.abs(b.total - target) || b.score - a.score)[0];
  if (multis.length && cheapest?.kind === 'single') {
    const multiBalance: ScoredCard | undefined = [...multis].filter((item) => item.id !== cheapest?.id && item.total <= search.budget * 1.08)
      .sort((a, b) => Math.abs(a.total - target) - Math.abs(b.total - target) || b.score - a.score)[0];
    if (multiBalance && Math.abs(multiBalance.total - target) <= Math.abs((balance?.total || 0) - target) + search.budget * 0.15) balance = multiBalance;
  }
  take(balance, 'Best balance', true);
  const remaining = all.filter((item) => !chosen.some((selected) => selected.id === item.id));
  const originPoint = (() => {
    const firstMulti = multis.find((item) => Object.keys(record(item.raw.origin)).length);
    return firstMulti ? point(record(firstMulti.raw.origin)) : null;
  })();
  const memorable = [...remaining].sort((a, b) => {
    const aBonus = a.kind === 'multi' ? 18 : 0; const bBonus = b.kind === 'multi' ? 18 : 0;
    return (b.score + bBonus + Math.min(18, distanceKm(originPoint, itemPoint(b)) / 600)) - (a.score + aBonus + Math.min(18, distanceKm(originPoint, itemPoint(a)) / 600));
  })[0];
  take(memorable, 'Most memorable');
  const extras = all.filter((item) => !chosen.some((selected) => selected.id === item.id));
  take([...extras].filter((item) => item.kind === 'single').sort((a, b) => (finite(b.valueScore, 0) + b.score / 150) - (finite(a.valueScore, 0) + a.score / 150))[0], 'Hidden-value discovery');
  take([...extras].filter((item) => item.kind === 'multi' && !chosen.some((selected) => selected.id === item.id)).sort((a, b) => b.score - a.score)[0], 'Connected city route');
  take([...extras].filter((item) => !chosen.some((selected) => selected.id === item.id)).sort((a, b) => b.score - a.score || a.total - b.total)[0], 'Familiar favourite');
  return chosen.slice(0, 6).map(({ valueScore: _unused, ...item }) => item);
}

export function normalizeLegacyImage(value?: string): string {
  const image = clean(value);
  if (!image) return '';
  if (/^https?:\/\//i.test(image) || image.startsWith('data:')) return image;
  if (image.startsWith('./')) return `/${image.slice(2)}`;
  if (image.startsWith('/')) return image;
  return `/${image}`;
}
