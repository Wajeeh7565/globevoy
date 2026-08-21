import type { SavedTrip, SavedTripResponse, SavedTripsListResponse } from '@/lib/contracts';
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

async function request<T>(method: 'GET' | 'DELETE', path: string, accessToken: string): Promise<T> {
  if (!accessToken) throw new GlobevoyApiError(401, 'Sign in required.');
  const response = await fetch(`${requireBaseUrl()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    credentials: 'omit'
  });
  let body: unknown = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body
      ? String((body as { error?: unknown }).error || `HTTP ${response.status}`)
      : `HTTP ${response.status}`;
    throw new GlobevoyApiError(response.status, message);
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
