export type PriceEvidenceState = 'provider' | 'cached' | 'estimate' | 'unavailable';
export type JsonObject = Record<string, unknown>;

export interface PriceEvidence {
  state: PriceEvidenceState;
  label: string;
  note?: string;
  observedAt?: string | null;
}

export interface PriceSnapshot {
  currency: string;
  totalBudget?: number;
  reserve?: number;
  flightEstimate?: number;
  stayEstimate?: number;
  tripEstimate?: number;
  remaining?: number;
  capturedAt?: string;
}

export interface SavedTripCity {
  id?: string;
  city: string;
  country?: string;
  code?: string;
  nights?: number;
}

export interface SavedTripSnapshot {
  schemaVersion: number;
  kind: 'single' | 'multi';
  clientSaveKey: string;
  sourceUrl?: string;
  origin?: string;
  city?: string;
  country?: string;
  code?: string;
  nights?: number;
  travellers?: number;
  currency?: string;
  label?: string;
  cities?: SavedTripCity[];
  offer?: JsonObject;
  tour?: JsonObject;
  snapshotId?: string | null;
  routeId?: string | null;
  snapshotMode?: string;
  savedByVersion?: string;
}

export interface SavedTrip {
  tripId: string;
  name: string;
  status: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  tripSnapshot: SavedTripSnapshot;
  priceSnapshot?: PriceSnapshot;
}

export interface SavedTripsListResponse {
  trips: SavedTrip[];
}

export interface SavedTripResponse {
  trip: SavedTrip;
}

export interface AuthUser {
  sub: string;
  username?: string | null;
  email?: string | null;
  emailVerified?: boolean;
}

export interface AuthSession {
  version: 'GV-ACCOUNT-705B-R3';
  accessToken: string;
  expiresAt: number;
  verifiedAt: number;
  user: AuthUser;
  scopes: string[];
}
