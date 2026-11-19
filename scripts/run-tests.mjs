import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const groups = {
  demo: [['node', '--test', 'tests/backend/full-site-demo.test.cjs']],
  'demo-browser': [['node', '--test', 'tests/frontend/full-site-demo-browser.test.cjs'], ['node', '--test', 'tests/frontend/leaflet-demo-browser.test.cjs']],
  release: [['node', '--test', 'tests/release/docker-lambda-targets.test.mjs'], ['node', '--test', 'tests/release/production-only-frontend.test.mjs'], ['node', '--test', 'tests/release/production-config.test.mjs'], ['node', '--test', 'tests/release/account-build-config.test.cjs']],
  repo: [
    ['node', '.github/scripts/validate-repo.mjs'],
    ['node', 'scripts/validate-organization.mjs']
  ],

  browser: [['node', '--test', 'tests/frontend/classic-save-browser.test.cjs']],

  backend: [
    ['node', '--test', 'tests/backend/search-activity.test.cjs'],
    ['python', '-B', 'tests/backend/search_activity_reporting_test.py'],
    ['node', '--test', 'tests/backend/trip-accuracy-005.test.cjs'],
    ['node', '--test', 'tests/backend/providers-ignav-agoda-id.test.cjs'],
    ['node', '--test', 'tests/backend/ignav-live-fares.test.cjs'],
    ['node', '--test', 'tests/backend/generated-tour-planning-dates.test.cjs'],
    ['node', '--test', 'tests/backend/server-http.test.cjs'],
    ['node', 'backend/validation/validate-gv-rec-687b-p3.js'],
    ['node', 'backend/validation/validate-gv-rec-687b.js'],
    ['node', 'backend/validation/validate-gv-data-701a.js'],
    ['node', 'backend/validation/validate-gv-data-701b.js'],
    ['node', 'backend/validation/validate-gv-rec-702a.js'],
    ['node', 'backend/validation/validate-gv-rec-702b.js'],
    ['node', 'backend/validation/validate-gv-rec-702b-r1.js'],
    ['node', 'backend/validation/validate-gv-rec-702c.js'],
    ['node', 'backend/validation/validate-gv-rec-702c-r2.js'],
    ['node', 'backend/validation/validate-gv-rec-702d.js'],
    ['node', 'backend/validation/validate-gv-rec-702d-r1.js'],
    ['node', 'backend/validation/validate-gv-rec-702e.js'],
    ['node', 'backend/validation/validate-gv-web-fe-r2.js']
  ],

  frontend: [
    ['node', 'frontend/validation/validate-gv-book-685d-frontend.js'],
    ['node', 'tests/frontend/validate-fixture-paths.mjs'],
    ['node', '--test', 'tests/frontend/page-layout.test.mjs'],
    ['node', '--test', 'tests/frontend/classic-saved-trip.test.cjs'],
    ['node', '--test', 'tests/frontend/booking-ignav-links.test.cjs'],
    ['node', 'frontend/validation/validate-gv-data-701c.js'],
    ['node', 'frontend/validation/validate-gv-rec-687b-frontend.js'],
    ['node', 'frontend/validation/validate-gv-web-fe-r3-1b.js']
  ],

  web: [
    ['node', 'web/validation/validate-gv-web-707a.mjs'],
    ['node', 'web/validation/validate-gv-web-708a.mjs'],
    ['node', 'web/validation/validate-gv-web-fe-r3.mjs'],
    ['node', 'web/validation/validate-gv-web-fe-r3-2.mjs'],
    ['node', '--test', 'web/validation/validate-gv-live-712c.test.mjs']
  ],

  account: [
    ['node', '--test', 'tests/backend/login-history.test.cjs'],
    ['python', '-B', 'tests/backend/login-history-report.test.py'],
    ['node', 'backend/validation/validate-gv-production-account.js'],
    ['node', 'backend/validation/validate-gv-account-705b-r3.js'],
    ['node', 'backend/validation/validate-gv-account-705c.js'],
    ['node', 'backend/validation/validate-gv-account-705c-r3.js'],
    ['node', 'backend/validation/validate-gv-account-705c-r4.js'],
    ['node', 'backend/validation/validate-gv-book-706a.js']
  ],

  providers: [
    ['node', 'backend/validation/validate-gv-live-712.js'],
    ['node', 'backend/validation/validate-gv-flight-703c.js'],
    ['node', 'backend/validation/validate-gv-flight-703e.js'],
    ['node', 'backend/validation/validate-gv-web-707b.js'],
    ['node', 'backend/validation/validate-gv-web-707b-r1.js'],
    ['node', 'backend/validation/validate-gv-hotel-708c.js']
  ],

  performance: [
    ['node', '--test', 'tests/performance/validate-gv-perf-r2.test.js'],
    ['node', '--test', 'tests/performance/validate-gv-perf-r3.test.js'],
    ['node', '--test', 'tests/performance/validate-gv-perf-r4.test.js'],
    ['node', '--test', 'tests/performance/validate-gv-perf-r5.test.js']
  ],

  syntax: [
    ['node', '--check', 'backend/lambda.js'],
    ['node', '--check', 'backend/staging-lambda.js'],
    ['node', '--check', 'backend/staging-lambda-702d.js'],
    ['node', '--check', 'backend/services/domain/tours/generated-tour.js'],
    ['node', '--check', 'backend/services/domain/live-fares/affordable-flight-discovery-684b.js'],
    ['node', '--check', 'backend/services/domain/routing/route-diversity-687b.js'],
    ['node', '--check', 'backend/services/cities/registry/worldwide-city-registry-701a.js'],
    ['node', '--check', 'backend/services/admin/audits/global-recommendation-coverage-702a.js'],
    ['node', '--check', 'backend/services/admin/audits/global-recovery-priority-702b.js'],
    ['node', '--check', 'backend/services/admin/audits/global-provider-recovery-smoke-plan-702c.js'],
    ['node', '--check', 'backend/services/cities/recovery/reviewed-recovery-overlay-702c-r2.js'],
    ['node', '--check', 'backend/services/cities/recovery/staging/staging-reviewed-recovery-702d.js'],
    ['node', '--check', 'backend/services/cities/recovery/reviewed-activation-promotion-702e.js'],
    ['node', '--check', 'frontend/runtime/api-client.js'],
    ['node', '--check', 'frontend/scripts/multicity-visualizer-687b.js']
  ]
};

const defaultGroups = ['repo', 'backend', 'frontend', 'performance', 'syntax'];

const selected = process.argv.slice(2);
const requested = selected.length === 0 || selected.includes('default')
  ? defaultGroups
  : selected;

const unknown = requested.filter((name) => !groups[name]);
if (unknown.length) {
  console.error(`Unknown test group(s): ${unknown.join(', ')}`);
  console.error(`Available groups: default, ${Object.keys(groups).join(', ')}`);
  process.exit(2);
}

function commandLabel(command) {
  return command.map((part) => JSON.stringify(part)).join(' ');
}

let ran = 0;

for (const groupName of requested) {
  console.log(`\n=== GlobeVoy test group: ${groupName} ===`);
  for (const command of groups[groupName]) {
    const file = command.at(-1);
    if (typeof file === 'string' && /\.(?:js|mjs|cjs)$/.test(file) && !fs.existsSync(file)) {
      console.error(`FAIL missing test target: ${file}`);
      process.exit(1);
    }

    const [bin, ...args] = command;
    const executable = bin === 'node' ? process.execPath : bin;
    console.log(`> ${commandLabel([bin, ...args])}`);

    const result = spawnSync(executable, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env
    });

    if (result.error) {
      console.error(`FAIL could not start command: ${result.error.message}`);
      process.exit(1);
    }

    if (result.status !== 0) {
      console.error(`FAIL group ${groupName}: ${file || commandLabel(command)} exited with code ${result.status}`);
      process.exit(result.status || 1);
    }

    ran += 1;
  }
}

console.log(`\nPASS GlobeVoy test runner: ${ran} command(s) across ${requested.length} group(s).`);
