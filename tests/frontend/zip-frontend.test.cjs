'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { frontendSourcePath } = require('../../ops/frontend/source-layout.cjs');

function verifyLocalAssets(html) {
  for (const [, relative] of html.matchAll(/(?:src|href)="((?:\.\/)?(?:assets|runtime|scripts|styles)\/[^"#?]+)(?:\?[^"]*)?"/g)) {
    const source = frontendSourcePath('frontend', relative);
    assert.ok(fs.statSync(path.normalize(source)).isFile(), source);
  }
}

test('Fresh B V9 and Multicity A are the public page sources and only use the new renderers', () => {
  const home = fs.readFileSync('frontend/pages/index.html', 'utf8');
  const results = fs.readFileSync('frontend/pages/multicity-visualizer.html', 'utf8');
  assert.match(home, /id="hero-deck"/);
  assert.match(home, /id="journey-deck"/);
  assert.match(home, /id="search"/);
  assert.doesNotMatch(home, /home-live-|gv-home-hero/);
  assert.match(results, /data-concept="a"/);
  assert.match(results, /class="hero-trip"/);
  assert.match(results, /class="a-summary"/);
  assert.match(results, /multicity-search\.js/);
  assert.doesNotMatch(results, /multicity-visualizer-\d|multi-city-visualizer-\d|journey-experience-\d|Illustrative trip estimate|Concept gallery/);
  verifyLocalAssets(home);
  verifyLocalAssets(results);
});
