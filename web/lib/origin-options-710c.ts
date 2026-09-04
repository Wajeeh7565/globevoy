export type OriginOption = {
  city: string;
  country: string;
  code: string;
};

// Preserve the useful origin choices already exposed by the legacy Globevoy homepage,
// while keeping the React search request normalized to an IATA code.
export const ORIGIN_OPTIONS: OriginOption[] = [
  { city: 'Toronto', country: 'Canada', code: 'YYZ' },
  { city: 'New York', country: 'United States', code: 'JFK' },
  { city: 'Los Angeles', country: 'United States', code: 'LAX' },
  { city: 'Dublin', country: 'Ireland', code: 'DUB' },
  { city: 'Dubai', country: 'United Arab Emirates', code: 'DXB' },
  { city: 'Mexico City', country: 'Mexico', code: 'MEX' },
  { city: 'Lahore', country: 'Pakistan', code: 'LHE' },
  { city: 'Karachi', country: 'Pakistan', code: 'KHI' },
  { city: 'Islamabad', country: 'Pakistan', code: 'ISB' },
  { city: 'Tehran', country: 'Iran', code: 'THR' },
  { city: 'Mashad', country: 'Iran', code: 'MHD' },
  { city: 'Istanbul', country: 'Turkey', code: 'IST' },
  { city: 'Delhi', country: 'India', code: 'DEL' },
  { city: 'Mumbai', country: 'India', code: 'BOM' },
  { city: 'San Diego', country: 'United States', code: 'SAN' },
  { city: 'Calgary', country: 'Canada', code: 'YYC' },
  { city: 'Vancouver', country: 'Canada', code: 'YVR' },
  { city: 'Montreal', country: 'Canada', code: 'YUL' }
];

export function originDisplay(option: OriginOption): string {
  return `${option.city} (${option.code})`;
}

export function resolveOrigin(value: string): OriginOption | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const codeMatch = value.toUpperCase().match(/\b([A-Z]{3})\b/);
  if (codeMatch) {
    const byCode = ORIGIN_OPTIONS.find((option) => option.code === codeMatch[1]);
    if (byCode) return byCode;
  }

  return ORIGIN_OPTIONS.find((option) => {
    return option.code.toLowerCase() === normalized
      || option.city.toLowerCase() === normalized
      || originDisplay(option).toLowerCase() === normalized;
  }) || null;
}

export function filterOrigins(value: string): OriginOption[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return ORIGIN_OPTIONS;

  return ORIGIN_OPTIONS.filter((option) => {
    const haystack = `${option.city} ${option.country} ${option.code}`.toLowerCase();
    return haystack.includes(normalized);
  });
}
