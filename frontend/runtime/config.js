// Globevoy browser config — sanitized source-review copy.
// Keep real provider/server secrets outside Git. Browser keys should still be restricted by domain/API.
window.GLOBEVOY_CONFIG = {
  googleMapsApiKey: "YOUR_RESTRICTED_GOOGLE_MAPS_BROWSER_KEY",
  enableLiveApi: false,
  apiBaseUrl: "http://localhost:8787",
  apiTimeoutMs: 20000,
  mapFirstThreePicksEnabled: true,
  topSwitchThreePicksEnabled: true,
  selectedTripDetailHandoffEnabled: true,
  neutralOptionLabelsEnabled: true,
  frontendVersion: "GV-REC-687B-R1",
  bookingTrustVersion: "GV-TRUST-685B",
  routeQualityVersion: "GV-QUALITY-680B-R1"
};
