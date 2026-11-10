import type { TravelProfile } from '@/lib/contracts';

export const GV_WEB_710F_R2_VERSION = 'GV-WEB-710F-R2';

const PRIMARY_INTEREST_OPTIONS = new Set([
  'No preference',
  'Food and culture',
  'Beach and relaxation',
  'Nature and outdoors',
  'Nightlife',
  'Family-friendly'
]);

const SEARCH_HOTEL_STYLES = new Set([
  'Best balance',
  'Best value',
  'Best location',
  'Higher guest rating',
  'Luxury'
]);

function clean(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

export function currencyPrefix(currency: string): string {
  switch (clean(currency).toUpperCase()) {
    case 'USD': return 'US$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'AUD': return 'A$';
    default: return 'C$';
  }
}

export function profilePrimaryInterest(profile: TravelProfile): string {
  const interests = (profile.interests || []).map((value) => clean(value).toLowerCase());
  const has = (...needles: string[]) => interests.some((value) => needles.some((needle) => value.includes(needle)));
  if (has('food', 'history', 'culture')) return 'Food and culture';
  if (has('beach', 'relax')) return 'Beach and relaxation';
  if (has('nature', 'adventure')) return 'Nature and outdoors';
  if (has('night')) return 'Nightlife';
  if (has('family')) return 'Family-friendly';
  return 'No preference';
}

export function profileHotelStyleForSearch(profile: TravelProfile): string | null {
  const value = clean(profile.hotelStyle);
  if (SEARCH_HOTEL_STYLES.has(value)) return value;
  if (value === 'Budget') return 'Best value';
  // Comfort and Boutique do not have an exact legacy search-style equivalent.
  // Keep the search's neutral default rather than claiming a preference match.
  return null;
}

export function profileSummary(profile: TravelProfile): string[] {
  const parts: string[] = [];
  if (profile.homeAirport) parts.push(profile.homeAirport);
  if (profile.residenceCountry) parts.push(`${profile.residenceCountry} profile`);
  if (profile.interests?.length) parts.push(profile.interests.slice(0, 2).join(' + '));
  if (profile.pace) parts.push(`${profile.pace} pace`);
  return parts;
}

export function isPrimaryInterestOption(value: string): boolean {
  return PRIMARY_INTEREST_OPTIONS.has(value);
}
