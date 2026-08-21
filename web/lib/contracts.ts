export type PriceEvidenceState = 'provider' | 'cached' | 'estimate' | 'unavailable';

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
  cities?: SavedTripCity[];
  tour?: unknown;
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
