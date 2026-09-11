import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(process.cwd(), 'web');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: error?.message?.split('\n')[0] || String(error) }); }
}

const page = read('app/results/page.tsx');
const client = read('components/results/results-client.tsx');
const adapter = read('lib/recommendations-708a.ts');
const selection = read('lib/multi-selection-708a.ts');
const api = read('lib/api.ts');
const previews = read('components/discovery/home-trip-previews.tsx');
const deck = read('components/results/journey-story-deck-710d-r4.tsx');
const map = read('components/results/results-map-710d.tsx');
const openTrip = read('lib/saved-trip-open-707a-r2.ts');
const layout = read('app/layout.tsx');
const css = read('app/results-708a.css');

check('version and static React results route are exact', () => {
  assert.match(adapter, /GV-WEB-708A/);
  assert.match(page, /ResultsClient/);
  assert.match(layout, /results-708a\.css/);
});

check('existing public recommendation contracts are reused', () => {
  assert.match(api, /\/api\/recommendations/);
  assert.match(api, /\/api\/multicity-tours/);
  assert.match(previews, /getPublicRecommendations/);
  assert.match(client, /getPublicMultiCityTours/);
  assert.doesNotMatch(`${api}\n${client}`, /DUFFEL_ACCESS_TOKEN|AWS_SECRET_ACCESS_KEY|client_secret|sk_live_/i);
});

check('legacy portfolio role labels are preserved', () => {
  for (const label of ['Lowest cost', 'Best balance', 'Most memorable', 'Hidden-value discovery', 'Connected city route', 'Familiar favourite']) {
    assert.ok(adapter.includes(label), `missing role ${label}`);
  }
  assert.match(adapter, /featured/);
});

check('price evidence remains explicit and conservative', () => {
  assert.match(adapter, /Provider-backed price evidence/);
  assert.match(adapter, /Cached price evidence/);
  assert.match(adapter, /Planning estimate — verify before booking/);
  assert.match(adapter, /Planning estimate — verify route prices/);
  assert.match(client, /JourneyStoryDeck710DR4/);
  assert.match(deck, /PriceEvidenceBadge evidence=\{item.evidence\}/);
  assert.match(client, /Estimated total/);
  assert.match(deck, /Planning estimate · dates not yet verified/);
});

// 710G moved selection into owner-private Saved Trips; the legacy adapter
// and Open Trip bridge are still retained for existing consumers.
check('saved selection and legacy compatibility contracts are preserved', () => {
  assert.match(client, /createSavedTrip/);
  assert.match(client, /materializedTour/);
  assert.match(client, /\/react\/booking\/\?tripId=/);
  assert.match(selection, /backendLegs/);
  assert.match(selection, /estimatedCoreTotal/);
  assert.match(selection, /legacyMultiSelectionPayload/);
  assert.match(openTrip, /globevoy\.multi\.selected\.v1/);
  assert.match(openTrip, /multicity-visualizer\.html/);
});

check('current Results retains loading, retry, empty-route and route-edit states', () => {
  assert.match(client, /Building connected journeys/);
  assert.match(client, /We could not build a multi-city journey yet/);
  assert.match(client, />Retry</);
  assert.match(client, /No connected multi-city route met/);
  assert.match(client, /onShuffleStop=\{shuffleStop\}/);
  assert.match(client, /onAddDestination=\{addDestination\}/);
});

check('710D map successor stays isolated from Google Maps credentials', () => {
  assert.match(client, /ResultsMap710D/);
  assert.match(map, /LeafletNamespace/);
  assert.match(map, /mapRef\.current/);
  assert.doesNotMatch(`${client}\n${adapter}\n${map}`, /google\.maps|maps\.googleapis\.com|googleMapsApiKey/);
});

check('708A does not edit the legacy frontend or backend runtime', () => {
  const migration = read('../docs/GV-WEB-706R-MIGRATION-PLAN.md');
  assert.match(migration, /Phase R3 — recommendation results/i);
  assert.ok(fs.existsSync(path.join(ROOT, '../frontend/mixed-results.html')));
  assert.ok(fs.existsSync(path.join(ROOT, '../backend/lambda.js')));
});

check('responsive recommendation surface exists', () => {
  assert.match(css, /gv-results-grid/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /gv-results-state--error/);
});

checks.forEach((item, index) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}${item.error ? `: ${item.error}` : ''}`));
const passed = checks.filter((item) => item.pass).length;
console.log(`GV-WEB-708A: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;

