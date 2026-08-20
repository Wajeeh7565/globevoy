'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ClassList {
  constructor(el) { this.el = el; this.values = new Set(); }
  toggle(name, force) {
    const on = force === undefined ? !this.values.has(name) : Boolean(force);
    if (on) this.values.add(name); else this.values.delete(name);
    return on;
  }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class Element {
  constructor(id = '', tag = 'div') {
    this.id = id; this.tagName = tag.toUpperCase(); this.innerHTML = ''; this.textContent = '';
    this.className = ''; this.classList = new ClassList(this); this.dataset = {}; this.disabled = false;
    this.attributes = new Map(); this.href = ''; this.onclick = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'href') this.href = String(value); }
  getAttribute(name) { if (name === 'href') return this.attributes.has(name) ? this.attributes.get(name) : (this.href || null); return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return name === 'href' ? this.attributes.has(name) || Boolean(this.href) : this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'href') this.href = ''; }
}
class Storage {
  constructor() { this.values = new Map(); }
  getItem(k) { return this.values.has(k) ? this.values.get(k) : null; }
  setItem(k, v) { this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
}

function resultBlocked() {
  return {
    ok: true, version: 'GV-ENTRY-675A', overallStatus: 'blocked', hardBlocked: true,
    summary: '1 destination is blocked by a current authoritative entry guardrail for this passport profile.',
    checks: [{ city: 'Miami', country: 'United States', countryCode: 'US', airportCode: 'MIA', status: 'not-currently-eligible', label: 'U.S. tourist entry is currently restricted', hardBlock: true, action: 'Do not continue to partner booking for this route.', source: { url: 'https://travel.state.gov/' } }],
    transit: { label: 'Transit check required after flight selection', action: 'Re-check every connection country before payment.' },
    disclaimer: 'Airlines and border authorities make the final decision.'
  };
}
function resultClear() {
  return {
    ok: true, version: 'GV-ENTRY-675A', overallStatus: 'verification-required', hardBlocked: false,
    summary: 'No hard restriction was found by the limited built-in guardrails. Live verification remains required.',
    checks: [{ city: 'Paris', country: 'France', countryCode: 'FR', airportCode: 'CDG', status: 'verification-required', label: 'Live visa or travel-authorization check required', hardBlock: false, action: 'Verify requirements before purchase.' }],
    transit: { label: 'Transit check required after flight selection', action: 'Re-check every connection country before payment.' },
    disclaimer: 'Airlines and border authorities make the final decision.'
  };
}

async function main() {
  const elements = new Map();
  const ids = ['gv-entry-section','gv-entry-recheck','gv-entry-summary','gv-entry-grid','gv-entry-transit','gv-entry-edit-profile','gv-entry-disclaimer','gv-booking-multicity','gv-booking-open-all-flights','gv-booking-open-all-stays','gv-booking-continue-partner'];
  for (const id of ids) elements.set(id, new Element(id, id.includes('booking') || id.includes('recheck') ? 'button' : 'div'));
  const link = new Element('', 'a'); link.setAttribute('href', 'https://example.com/flight'); link.classList.add('gv-booking-link');
  const document = {
    querySelector(selector) { return selector.startsWith('#') ? elements.get(selector.slice(1)) || null : null; },
    querySelectorAll(selector) { return selector === '.gv-booking-link' ? [link] : []; }
  };
  const localStorage = new Storage(), sessionStorage = new Storage();
  localStorage.setItem('globevoy.travel.profile.v1', JSON.stringify({ passportCountryCode: 'IR', passportCountry: 'Iran', residenceCountryCode: 'CA', residenceCountry: 'Canada', entryAware: true }));
  const tour = { origin: { city: 'Toronto', country: 'Canada', countryCode: 'CA', code: 'YYZ' }, cities: [{ city: 'Miami', country: 'United States', countryCode: 'US', code: 'MIA' }], legs: [{ departureDate: '2026-11-05' }] };
  sessionStorage.setItem('globevoy.multi.selected.v1', JSON.stringify(tour));
  let apiResult = resultBlocked();
  const context = {
    console, URLSearchParams, Promise, setTimeout, clearTimeout,
    document, localStorage, sessionStorage,
    location: { search: '?multi=true', pathname: '/booking.html' },
    window: null
  };
  context.window = context;
  context.window.name = '';
  context.window.GlobevoyApi = { isConfigured: () => true, checkTravelEntry: async () => apiResult };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, 'scripts/booking-entry-675a.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'booking-entry-675a.js' });
  await new Promise(resolve => setTimeout(resolve, 25));

  const checks = [];
  const check = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
  const summary = elements.get('gv-entry-summary');
  check('blocked route renders partner-booking pause', /Partner booking paused/.test(summary.innerHTML), summary.innerHTML);
  check('blocked route renders destination and official-source link', /Miami/.test(elements.get('gv-entry-grid').innerHTML) && /Official source/.test(elements.get('gv-entry-grid').innerHTML));
  check('blocked route renders transit warning', /Transit check required/.test(elements.get('gv-entry-transit').innerHTML));
  check('blocked route disables all main partner actions', ['gv-booking-multicity','gv-booking-open-all-flights','gv-booking-open-all-stays','gv-booking-continue-partner'].every(id => elements.get(id).disabled));
  check('blocked route removes partner href', !link.hasAttribute('href') && link.getAttribute('aria-disabled') === 'true', { href: link.getAttribute('href'), ariaDisabled: link.getAttribute('aria-disabled') });

  apiResult = resultClear();
  await context.window.GlobevoyEntry675A.check(tour);
  check('clear verification state restores partner actions', ['gv-booking-multicity','gv-booking-open-all-flights','gv-booking-open-all-stays','gv-booking-continue-partner'].every(id => !elements.get(id).disabled));
  check('clear verification state restores partner href', link.getAttribute('href') === 'https://example.com/flight' && !link.hasAttribute('aria-disabled'), { href: link.getAttribute('href') });
  check('clear state remains honest about live verification', /Entry checkpoint/.test(summary.innerHTML) && /Live verification remains required/.test(summary.innerHTML), summary.innerHTML);

  const result = { release: 'GV-ENTRY-675A', fixture: 'booking-entry-dom-behaviour', generatedAt: new Date().toISOString(), checkCount: checks.length, passedCount: checks.filter(x => x.passed).length, failedCount: checks.filter(x => !x.passed).length, checks };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_ENTRY_675A_BROWSER_FIXTURE.json'), JSON.stringify(result, null, 2) + '\n');
  if (result.failedCount) throw new Error(`GV-ENTRY-675A browser fixture failed (${result.failedCount}).`);
  console.log(`GV-ENTRY-675A browser fixture passed (${result.passedCount}/${result.checkCount}).`);
}
main().catch(error => { console.error(error.stack || error); process.exit(1); });
