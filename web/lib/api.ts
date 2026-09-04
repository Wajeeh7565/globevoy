import type { BookingRevalidationResponse, SavedTrip, SavedTripResponse, SavedTripsListResponse } from '@/lib/contracts';
import { browserApiBaseUrl } from '@/lib/public-config';

export class GlobevoyApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'GlobevoyApiError';
  }
}

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

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, accessToken: string, payload?: unknown): Promise<T> {
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

export async function getSavedTrip(accessToken: string, tripId: string): Promise<SavedTrip> {
  const id = normalizedTripId(tripId);
  return (await request<SavedTripResponse>('GET', `/api/saved-trips?tripId=${encodeURIComponent(id)}`, accessToken)).trip;
}

export async function deleteSavedTrip(accessToken: string, tripId: string): Promise<void> {
  const id = normalizedTripId(tripId);
  await request<unknown>('DELETE', `/api/saved-trips?tripId=${encodeURIComponent(id)}`, accessToken);
}

export async function revalidateSavedTripForBooking(accessToken: string, tripId: string): Promise<BookingRevalidationResponse> {
  const id = normalizedTripId(tripId);
  return request<BookingRevalidationResponse>('POST', '/api/account/booking-revalidate', accessToken, { tripId: id });
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