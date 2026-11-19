// Globevoy browser config
// Place your restricted Google Maps browser key here.
// NEVER put Gemini, Amadeus, SearchAPI, or any private keys here.
window.GLOBEVOY_PUBLIC_ENVIRONMENT = window.GLOBEVOY_ENVIRONMENT_POLICY.resolve(window.location.origin);
window.GLOBEVOY_CONFIG = {
  googleMapsApiKey: "YOUR_RESTRICTED_GOOGLE_MAPS_BROWSER_KEY",
  enableLiveApi: Boolean(window.GLOBEVOY_PUBLIC_ENVIRONMENT.apiBaseUrl),
  apiBaseUrl: window.GLOBEVOY_PUBLIC_ENVIRONMENT.apiBaseUrl,
  worldwideRegistryEnabled: window.GLOBEVOY_PUBLIC_ENVIRONMENT.worldwideRegistryEnabled,
  apiTimeoutMs: 20000,
  generatedTourTimeoutMs: 55000,
  mapFirstThreePicksEnabled: true,
  topSwitchThreePicksEnabled: true,
  selectedTripDetailHandoffEnabled: true,
  neutralOptionLabelsEnabled: true,
  frontendVersion: "GV-HOTEL-679A-R2",
  bookingTrustVersion: "GV-QUALITY-680A",
  routeQualityVersion: "GV-QUALITY-680B-R1"
};
