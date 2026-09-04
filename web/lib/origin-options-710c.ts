export type OriginOption = {
  city: string;
  country: string;
  code: string;
  latitude: number;
  longitude: number;
};

// Preserve the useful origin choices already exposed by the legacy Globevoy homepage,
// while keeping the React search request normalized to an IATA code. Coordinates are
// used only in the browser to choose the nearest supported origin after the user
// explicitly asks Globevoy to use their location.
export const ORIGIN_OPTIONS: OriginOption[] = [
  { city: 'Toronto', country: 'Canada', code: 'YYZ', latitude: 43.6777, longitude: -79.6248 },
  { city: 'New York', country: 'United States', code: 'JFK', latitude: 40.6413, longitude: -73.7781 },
  { city: 'Los Angeles', country: 'United States', code: 'LAX', latitude: 33.9416, longitude: -118.4085 },
  { city: 'Dublin', country: 'Ireland', code: 'DUB', latitude: 53.4264, longitude: -6.2499 },
  { city: 'Dubai', country: 'United Arab Emirates', code: 'DXB', latitude: 25.2532, longitude: 55.3657 },
  { city: 'Mexico City', country: 'Mexico', code: 'MEX', latitude: 19.4361, longitude: -99.0719 },
  { city: 'Lahore', country: 'Pakistan', code: 'LHE', latitude: 31.5216, longitude: 74.4036 },
  { city: 'Karachi', country: 'Pakistan', code: 'KHI', latitude: 24.9065, longitude: 67.1608 },
  { city: 'Islamabad', country: 'Pakistan', code: 'ISB', latitude: 33.549, longitude: 72.8257 },
  { city: 'Tehran', country: 'Iran', code: 'THR', latitude: 35.6892, longitude: 51.389 },
  { city: 'Mashad', country: 'Iran', code: 'MHD', latitude: 36.2352, longitude: 59.641 },
  { city: 'Istanbul', country: 'Turkey', code: 'IST', latitude: 41.2753, longitude: 28.7519 },
  { city: 'Delhi', country: 'India', code: 'DEL', latitude: 28.5562, longitude: 77.1 },
  { city: 'Mumbai', country: 'India', code: 'BOM', latitude: 19.0896, longitude: 72.8656 },
  { city: 'San Diego', country: 'United States', code: 'SAN', latitude: 32.7338, longitude: -117.1933 },
  { city: 'Calgary', country: 'Canada', code: 'YYC', latitude: 51.1215, longitude: -114.0076 },
  { city: 'Vancouver', country: 'Canada', code: 'YVR', latitude: 49.1967, longitude: -123.1815 },
  { city: 'Montreal', country: 'Canada', code: 'YUL', latitude: 45.4706, longitude: -73.7408 }
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

function distanceKm(latitude: number, longitude: number, option: OriginOption): number {
  const radius = 6371;
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(option.latitude - latitude);
  const dLng = rad(option.longitude - longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(latitude)) * Math.cos(rad(option.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

export function nearestOrigin(latitude: number, longitude: number): OriginOption {
  return [...ORIGIN_OPTIONS].sort((a, b) => distanceKm(latitude, longitude, a) - distanceKm(latitude, longitude, b))[0];
}
