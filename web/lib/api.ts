import type {
  BookingRevalidationResponse,
  SavedTrip,
  SavedTripResponse,
  SavedTripsListResponse,
  TravelProfile,
  TravelProfileResponse
} from '@/lib/contracts';
import { browserApiBaseUrl, browserEnvironment } from '@/lib/public-config';

export class GlobevoyApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'GlobevoyApiError';
  }
}

export type AutomaticDateLeg = {
  legNumber: number | null;
  from: { city?: string; code?: string } | null;
  to: { city?: string; code?: string } | null;
  departureDate: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  price: number | null;
  currency: string | null;
  airline: string | null;
  flightNumber: string | null;
  transfers: number | null;
  durationMinutes: number | null;
  durationLabel: string | null;
  selectionReason: string | null;
  timingLabel: string | null;
  pricePremiumVsCheapest: number | null;
  targetDate: string | null;
  evidence: unknown;
  evidenceId: string | null;
  sourceType: string;
  availabilityVerified: false;
  bookingCreated: false;
};

export type AutomaticDatesResponse = {
  ok: boolean;
  supported: boolean;
  version?: string;
  routeId?: string;
  complete?: boolean;
  reason?: string | null;
  departureDate?: string | null;
  returnDate?: string | null;
  currency?: string;
  selectedLegs?: AutomaticDateLeg[];
  totalObservedFlightPrice?: number | null;
  sourceType?: string;
  sourceWording?: string;
  currentAvailabilityVerified?: boolean;
};

function requireBaseUrl(): string {
  const base = browserApiBaseUrl();
  if (!base) throw new GlobevoyApiError(503, 'Globevoy API is not configured for this origin.');
  return base;
}

async function parseBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function errorMessage(body: unknown, status: number): string {
  if (typeof body === 'object' && body) {
    const row = body as { error?: unknown; message?: unknown; reason?: unknown };
    if (typeof row.error === 'string' && row.error) return row.error;
    if (row.error && typeof row.error === 'object') {
      const detail = row.error as { message?: unknown; code?: unknown };
      if (detail.message) return String(detail.message);
      if (detail.code) return String(detail.code);
    }
    if (row.message) return String(row.message);
    if (row.reason) return String(row.reason);
  }
  return `HTTP ${status}`;
}

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, accessToken: string, payload?: unknown): Promise<T> {
  if (!browserEnvironment().accountsEnabled) throw new GlobevoyApiError(503, 'Accounts are not available on this website yet.');
  if (!accessToken) throw new GlobevoyApiError(401, 'Sign in required.');
  const response = await fetch(`${requireBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    cache: 'no-store',
    credentials: 'omit'
  });
  const body = await parseBody(response);
  if (!response.ok) throw new GlobevoyApiError(response.status, errorMessage(body, response.status));
  return body as T;
}

async function publicGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${requireBaseUrl()}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'omit'
  });
  const body = await parseBody(response);
  if (!response.ok || (typeof body === 'object' && body && (body as { ok?: unknown }).ok === false)) {
    throw new GlobevoyApiError(response.status, errorMessage(body, response.status));
  }
  return body as T;
}

function normalizedTripId(tripId: string): string {
  const id = String(tripId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new GlobevoyApiError(400, 'Valid trip ID required.');
  return id;
}

export async function listSavedTrips(accessToken: string): Promise<SavedTrip[]> {
  return (await request<SavedTripsListResponse>('GET', '/api/saved-trips', accessToken)).trips || [];
}

export async function createSavedTrip(accessToken: string, payload: Record<string, unknown>): Promise<SavedTrip> {
  return (await request<SavedTripResponse>('POST', '/api/saved-trips', accessToken, payload)).trip;
}

export async function getSavedTrip(accessToken: string, tripId: string): Promise<SavedTrip> {
  const id = normalizedTripId(tripId);
  return (await request<SavedTripResponse>('GET', `/api/saved-trips?tripId=${encodeURIComponent(id)}`, accessToken)).trip;
}

export async function deleteSavedTrip(accessToken: string, tripId: string): Promise<void> {
  const id = normalizedTripId(tripId);
  await request<unknown>('DELETE', `/api/saved-trips?tripId=${encodeURIComponent(id)}`, accessToken);
}

export async function getTravelProfile(accessToken: string): Promise<TravelProfileResponse> {
  return request<TravelProfileResponse>('GET', '/api/account/travel-profile', accessToken);
}

export async function saveTravelProfile(accessToken: string, profile: TravelProfile): Promise<TravelProfileResponse> {
  const { updatedAt: _updatedAt, ...payload } = profile;
  return request<TravelProfileResponse>('PUT', '/api/account/travel-profile', accessToken, payload);
}

export type HotelGuestContext = {
  guestNationality: string;
  occupancies?: Array<{ adults: number; children: number[] }>;
};

export async function revalidateSavedTripForBooking(
  accessToken: string,
  tripId: string,
  hotelGuestContext?: HotelGuestContext
): Promise<BookingRevalidationResponse> {
  const id = normalizedTripId(tripId);
  const payload = hotelGuestContext ? { tripId: id, hotelGuestContext } : { tripId: id };
  return request<BookingRevalidationResponse>('POST', '/api/account/booking-revalidate', accessToken, payload);
}

// GV-WEB-708A — public recommendation adapters reuse the same backend surfaces
// as the proven mixed-results page. No provider credential is exposed to React.
export async function getPublicRecommendations(params: Record<string, string | number | undefined>): Promise<unknown> {
  return publicGet<unknown>('/api/recommendations', params);
}

export async function getPublicMultiCityTours(params: Record<string, string | number | undefined>): Promise<unknown> {
  if (params.disabled === '1') return { supported: false, tours: [] };
  const { disabled: _disabled, ...query } = params;

  // GV-WEB-710C-R4: the legacy route engine defaults an omitted flexible duration
  // to 12 nights. The discovery UI carries a shorter single-trip planning value,
  // so give flexible multi-city discovery the tested seven-night baseline instead
  // of silently falling back to 12. Explicit fixed durations are left untouched.
  if (query.adaptiveDuration === 'true' && query.totalNights === undefined) {
    query.totalNights = 7;
  }

  return publicGet<unknown>('/api/multicity-tours', query);
}

// GV-FLIGHT-710E-R3A — the browser requests the date materialization result only.
// Fare-provider orchestration and credentials remain behind the staging Lambda.
export async function getPublicMultiCityAutomaticDates(
  params: Record<string, string | number | undefined>
): Promise<AutomaticDatesResponse> {
  if (!browserEnvironment().automaticDatesEnabled) return { ok: true, supported: false, complete: false, reason: 'automatic-dates-unavailable' };
  if (!params.routeId) {
    return { ok: true, supported: false, complete: false, reason: 'routeId-required' };
  }
  return publicGet<AutomaticDatesResponse>('/api/staging/multicity-auto-dates', params);
}
