import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const VERSION = 'GV-DIST-709A-MCP-R1';
const DEFAULT_API_BASE = 'https://mirksnjcjim4iowstuda4lesrm0ghmfw.lambda-url.us-east-2.on.aws';
const DEFAULT_STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';

const API_BASE = String(process.env.GLOBEVOY_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '');
const STAGING_ORIGIN = String(process.env.GLOBEVOY_STAGING_ORIGIN || DEFAULT_STAGING_ORIGIN).replace(/\/$/, '');

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function rows(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as JsonObject[] : [];
}

function clean(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value: unknown): number | null {
  const n = finite(value, 0);
  return n > 0 ? n : null;
}

function numberField(obj: JsonObject, ...keys: string[]): number | null {
  for (const key of keys) {
    const n = positive(obj[key]);
    if (n !== null) return n;
  }
  return null;
}

function stringField(obj: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = clean(obj[key]);
    if (value) return value;
  }
  return '';
}

function evidenceFor(raw: JsonObject) {
  const explicit = record(raw.priceEvidence ?? raw.overallPriceEvidence);
  const evidenceClass = clean(
    explicit.evidenceClass ??
    explicit.class ??
    raw.evidenceClass ??
    raw.pricingStatus
  ).toUpperCase();

  if (evidenceClass === 'LIVE' || evidenceClass.includes('LIVE_PROVIDER')) {
    return {
      state: 'provider_backed',
      label: 'Provider-backed price evidence',
      note: 'Provider evidence is present, but final price and availability are confirmed by the partner.'
    } as const;
  }

  if (evidenceClass === 'CACHED' || evidenceClass.includes('CACHE')) {
    return {
      state: 'cached',
      label: 'Cached price evidence',
      note: 'Provider evidence may have changed. Recheck before booking.'
    } as const;
  }

  if (evidenceClass === 'UNAVAILABLE') {
    return {
      state: 'needs_verification',
      label: 'Price needs verification',
      note: 'Current provider evidence is unavailable.'
    } as const;
  }

  return {
    state: 'estimate',
    label: 'Planning estimate',
    note: 'This is planning evidence, not a guaranteed quote. Recheck before booking.'
  } as const;
}

function price(amount: number | null, currency: string, basis: string) {
  return amount && amount > 0 ? { amount, currency, basis } : null;
}

function adaptSingle(raw: JsonObject, input: SearchInput) {
  const city = stringField(raw, 'city');
  if (!city) return null;

  const country = stringField(raw, 'country');
  const code = stringField(raw, 'code', 'airportCode').toUpperCase();
  const displayBudget = record(raw.displayBudget);

  // Trust boundary: MCP only exposes totals already normalized by Globevoy into
  // the user's requested display currency. It never silently relabels raw USD
  // fallback fields as CAD/EUR/etc.
  const total = numberField(displayBudget, 'tripEstimate');
  if (!total) return null;

  const flight = numberField(displayBudget, 'flightEstimate');
  const stay = numberField(displayBudget, 'accommodationEstimate');
  const evidence = evidenceFor(raw);
  const nights = Math.max(2, Math.round(finite(raw.nights, input.nights)));

  return {
    tripId: `single-${clean(raw.id || code || city).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    kind: 'single_city' as const,
    title: [city, country].filter(Boolean).join(', '),
    route: `${input.origin} → ${city}`,
    destinationCodes: code ? [code] : [],
    nights,
    pricing: {
      total: price(total, input.currency, 'total_trip'),
      flightEstimate: price(flight, input.currency, 'route_total_estimate'),
      hotelEstimate: price(stay, input.currency, 'total_stay_estimate'),
      evidence
    },
    budget: {
      requested: { amount: input.budgetAmount, currency: input.currency, basis: 'total_trip_budget' },
      withinRequestedBudget: total <= input.budgetAmount
    },
    why: stringField(raw, 'displayWhyItFits', 'whyItFits', 'explanation') || null,
    booking: {
      mode: 'external_handoff' as const,
      reservationCreated: false,
      paymentTaken: false
    }
  };
}

function adaptMulti(raw: JsonObject, input: SearchInput) {
  const sourceCities = rows(raw.stops).length ? rows(raw.stops) : rows(raw.cities);
  const cities = sourceCities.map((row) => ({
    city: stringField(row, 'city'),
    country: stringField(row, 'country'),
    code: stringField(row, 'airportCode', 'code').toUpperCase()
  })).filter((row) => row.city);
  if (!cities.length) return null;

  const displayBudget = record(raw.displayBudget);
  const total = numberField(displayBudget, 'tripEstimate');
  if (!total) return null;

  const evidence = evidenceFor(raw);
  const origin = record(raw.origin);
  const originCity = stringField(origin, 'city') || input.origin;
  const title = stringField(raw, 'title') || cities.map((city) => city.city).join(' + ');
  const route = [originCity, ...cities.map((city) => city.city), originCity].join(' → ');

  return {
    tripId: `multi-${clean(raw.tourId || raw.routeId || title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    kind: 'multi_city' as const,
    title,
    route,
    destinationCodes: cities.map((city) => city.code).filter(Boolean),
    nights: Math.max(1, Math.round(finite(raw.totalNights, input.nights))),
    pricing: {
      total: price(total, input.currency, 'total_trip'),
      flightEstimate: null,
      hotelEstimate: null,
      evidence
    },
    budget: {
      requested: { amount: input.budgetAmount, currency: input.currency, basis: 'total_trip_budget' },
      withinRequestedBudget: total <= input.budgetAmount
    },
    why: stringField(raw, 'displayWhyItFits', 'recommendationExplanation', 'whyCitiesWork') || null,
    booking: {
      mode: 'external_handoff' as const,
      reservationCreated: false,
      paymentTaken: false
    }
  };
}

async function publicGet(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Origin: STAGING_ORIGIN
      },
      signal: controller.signal
    });

    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }

    if (!response.ok || (body && typeof body === 'object' && (body as JsonObject).ok === false)) {
      const row = record(body);
      const message = stringField(row, 'error', 'message', 'reason') || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

const SearchInputSchema = z.object({
  origin: z.string().min(2).max(80).describe('Origin city or airport code, for example Toronto or YYZ.'),
  budgetAmount: z.number().positive().max(100000).describe('Total trip budget.'),
  currency: z.enum(['CAD', 'USD', 'EUR', 'GBP', 'AUD']).default('CAD').describe('Currency of the requested total trip budget.'),
  nights: z.number().int().min(2).max(21).default(5).describe('Desired trip length in nights.'),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('Optional preferred month in YYYY-MM format.'),
  interests: z.array(z.string().min(1).max(50)).max(6).optional().describe('Optional travel interests, for example food, nature, beaches.'),
  region: z.string().min(2).max(80).optional().describe('Optional region preference.'),
  maxResults: z.number().int().min(1).max(6).default(3).describe('Maximum recommendations to return.')
});

type SearchInput = z.infer<typeof SearchInputSchema>;

const PriceSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  basis: z.string()
}).nullable();

const RecommendationSchema = z.object({
  tripId: z.string(),
  kind: z.enum(['single_city', 'multi_city']),
  title: z.string(),
  route: z.string(),
  destinationCodes: z.array(z.string()),
  nights: z.number(),
  pricing: z.object({
    total: PriceSchema,
    flightEstimate: PriceSchema,
    hotelEstimate: PriceSchema,
    evidence: z.object({
      state: z.enum(['provider_backed', 'cached', 'estimate', 'needs_verification']),
      label: z.string(),
      note: z.string()
    })
  }),
  budget: z.object({
    requested: z.object({ amount: z.number(), currency: z.string(), basis: z.string() }),
    withinRequestedBudget: z.boolean()
  }),
  why: z.string().nullable(),
  booking: z.object({
    mode: z.literal('external_handoff'),
    reservationCreated: z.literal(false),
    paymentTaken: z.literal(false)
  })
});

const SearchOutputSchema = z.object({
  version: z.literal(VERSION),
  query: z.object({
    origin: z.string(),
    budget: z.object({ amount: z.number(), currency: z.string(), basis: z.literal('total_trip_budget') }),
    nights: z.number(),
    month: z.string().nullable(),
    assumedDates: z.boolean()
  }),
  recommendationCount: z.number(),
  recommendations: z.array(RecommendationSchema),
  trust: z.object({
    bookingBoundary: z.literal('external_handoff_only'),
    reminder: z.string()
  })
});

function createServer() {
  const server = new McpServer({
    name: 'globevoy',
    version: VERSION
  });

  server.registerTool(
    'search_trips',
    {
      title: 'Search Globevoy trips',
      description: 'Search Globevoy for a small budget-first set of single-city and multi-city trip recommendations. Prices include explicit basis and evidence labels. This tool never books, pays, reserves, or modifies an account.',
      inputSchema: SearchInputSchema,
      outputSchema: SearchOutputSchema,
      annotations: {
        title: 'Search Globevoy trips',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => {
      try {
        const common = {
          origin: input.origin,
          budget: input.budgetAmount,
          currency: input.currency,
          month: input.month,
          nights: input.nights
        };

        const [singlePayload, multiPayload] = await Promise.all([
          publicGet('/api/recommendations', {
            ...common,
            interests: input.interests?.join(','),
            region: input.region,
            limit: 500
          }),
          publicGet('/api/multicity-tours', {
            origin: input.origin,
            budget: input.budgetAmount,
            currency: input.currency,
            month: input.month,
            adaptiveDuration: 'true',
            maxStops: 3
          }).catch(() => ({ supported: false, tours: [] }))
        ]);

        const singles = rows(record(singlePayload).recommendations)
          .map((row) => adaptSingle(row, input))
          .filter(Boolean);
        const multis = rows(record(multiPayload).tours)
          .map((row) => adaptMulti(row, input))
          .filter(Boolean);

        const combined = [...singles, ...multis]
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .filter((item) => (item.pricing.total?.amount ?? Infinity) <= input.budgetAmount * 1.08)
          .sort((a, b) => {
            const aFits = a.budget.withinRequestedBudget ? 0 : 1;
            const bFits = b.budget.withinRequestedBudget ? 0 : 1;
            if (aFits !== bFits) return aFits - bFits;
            return (a.pricing.total?.amount ?? Infinity) - (b.pricing.total?.amount ?? Infinity);
          })
          .slice(0, input.maxResults);

        const output = {
          version: VERSION,
          query: {
            origin: input.origin,
            budget: { amount: input.budgetAmount, currency: input.currency, basis: 'total_trip_budget' as const },
            nights: input.nights,
            month: input.month ?? null,
            assumedDates: !input.month
          },
          recommendationCount: combined.length,
          recommendations: combined,
          trust: {
            bookingBoundary: 'external_handoff_only' as const,
            reminder: 'Globevoy recommendations may combine provider evidence and planning estimates. Final price and availability must be rechecked before booking.'
          }
        };

        return {
          content: [{
            type: 'text',
            text: `Globevoy returned ${combined.length} recommendation${combined.length === 1 ? '' : 's'}. Each price states its basis and evidence status. No booking, payment, or reservation was created.`
          }],
          structuredContent: output
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Trip search failed.';
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Globevoy search could not be completed: ${message}. No booking, payment, reservation, or account change occurred.`
          }]
        };
      }
    }
  );

  return server;
}

serveStdio(createServer);
