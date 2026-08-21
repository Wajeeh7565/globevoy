import type { SavedTrip, SavedTripResponse, SavedTripsListResponse } from '@/lib/contracts';

const API_BASE = (process.env.NEXT_PUBLIC_GLOBEVOY_API_BASE_URL || '').replace(/\/$/, '');

export class GlobevoyApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'GlobevoyApiError';
  }
}

function requireBaseUrl() {
  if (!API_BASE) throw new GlobevoyApiError(503, 'Globevoy API is not configured.');
  return API_BASE;
}

async function request<T>(path: string, accessToken: string): Promise<T> {
  if (!accessToken) throw new GlobevoyApiError(401, 'Sign in required.');
  const response = await fetch(`${requireBaseUrl()}${path}`, {
    method: 'GET',
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

export async function listSavedTrips(accessToken: string): Promise<SavedTrip[]> {
  return (await request<SavedTripsListResponse>('/api/saved-trips', accessToken)).trips || [];
}

export async function getSavedTrip(accessToken: string, tripId: string): Promise<SavedTrip> {
  const id = String(tripId || '').trim();
  if (!id) throw new GlobevoyApiError(400, 'Trip ID required.');
  return (await request<SavedTripResponse>(`/api/saved-trips?tripId=${encodeURIComponent(id)}`, accessToken)).trip;
}
