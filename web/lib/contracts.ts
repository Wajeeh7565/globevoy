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

export type BookingRevalidationState = 'verified' | 'changed' | 'unavailable';

export interface BookingRevalidationFlight {
  index: number;
  origin: string;
  destination: string;
  resolvedOrigin?: string;
  resolvedDestination?: string;
  departureDate: string;
  savedAmount?: number;
  freshAmount?: number;
  currency: string;
  providerReference?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  airportMode?: string;
  sourceType?: string;
  productionEligible?: boolean;
  handoffEnabled: boolean;
  handoffLabel?: string | null;
  handoffUrl?: string | null;
  finalPriceRequiresPartnerConfirmation: true;
}

export interface BookingRevalidationHotel {
  index: number;
  city: string;
  country?: string;
  nights: number;
  savedEstimate: number;
  currency: string;
  state: 'estimate' | 'provider' | 'verified';
  providerState?: 'unavailable' | 'provider' | 'verified';
  provider?: 'Nuitee' | null;
  providerReason?: string | null;
  availabilityVerified: boolean;
  hotelName?: string | null;
  address?: string | null;
  rating?: number | null;
  photoUrl?: string | null;
  roomName?: string | null;
  boardName?: string | null;
  freshAmount?: number | null;
  checkin?: string | null;
  checkout?: string | null;
  dateBasis?: string | null;
  refundableTag?: string | null;
  cancellationDetailsPresent?: boolean;
  taxesAndFeesPresent?: boolean;
  excludedFeesPresent?: boolean;
  evidence?: string | null;
  observedAt?: string | null;
  handoffLabel?: string | null;
  handoffUrl?: string | null;
  finalPriceRequiresPartnerConfirmation: true;
}

export interface BookingHotelRevalidationSummary {
  version: 'GV-HOTEL-708C';
  enabled: boolean;
  attempted: boolean;
  provider: 'Nuitee';
  reason?: string | null;
  totalCount: number;
  providerBackedCount: number;
  verifiedCount: number;
  allVerified: boolean;
  providerRequests: number;
  savedHotelEstimate: number;
  freshHotelTotal?: number | null;
  hotelDelta?: number | null;
  hotelAdjustedTripEstimate?: number | null;
  observedAt?: string | null;
  bookingCapability: false;
  paymentCapability: false;
  reservationCapability: false;
}

export interface BookingRevalidationResponse {
  ok: true;
  version: 'GV-WEB-707B';
  trip: {
    tripId: string;
    name: string;
    kind: 'single' | 'multi' | null;
    updatedAt?: string | null;
  };
  snapshot: {
    capturedAt?: string | null;
    currency: string;
    savedFlightTotal?: number;
    savedTripTotal?: number;
  };
  revalidation: {
    state: BookingRevalidationState;
    attempted: boolean;
    applied: boolean;
    reason?: string | null;
    provider: 'Duffel';
    allFlightLegsLive: boolean;
    requiredFlightLegCount?: number;
    liveFlightLegCount?: number;
    freshFlightTotal?: number;
    flightDelta?: number;
    freshTripEstimate?: number;
    overBudget?: boolean;
    observedAt?: string | null;
    handoffEnabled: boolean;
    providerRequests?: number;
    exactRequests?: number;
    metroRequests?: number;
    orderCapability: false;
    paymentCapability: false;
    bookingCapability: false;
    ticketingCapability: false;
  };
  hotelRevalidation?: BookingHotelRevalidationSummary;
  flights: BookingRevalidationFlight[];
  hotels: BookingRevalidationHotel[];
  trust: {
    savedPricesAreSnapshots: true;
    flightEvidenceFreshlyChecked?: boolean;
    hotelEvidenceFreshlyChecked?: boolean;
    hotelAvailabilityVerified: boolean;
    hotelEvidenceProvider?: 'Nuitee';
    hotelEvidenceVersion?: 'GV-HOTEL-708C';
    bookingRevalidationCalculationVersion?: string;
    partnerHandoffIsComparisonOnly?: boolean;
    finalPartnerConfirmationRequired: true;
  };
  bookingBoundary?: {
    noBooking: true;
    noPayment: true;
    noOrderCreation: true;
    noReservation: true;
  };
}
