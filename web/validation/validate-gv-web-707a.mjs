import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const repo = path.resolve(web, '..');
const readWeb = (name) => fs.readFileSync(path.join(web, name), 'utf8');
const readRepo = (name) => fs.readFileSync(path.join(repo, name), 'utf8');
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const auth = readWeb('lib/auth.ts');
const config = readWeb('lib/public-config.ts');
const api = readWeb('lib/api.ts');
const handoff = readWeb('lib/saved-trip-handoff.ts');
const openR2 = readWeb('lib/saved-trip-open-707a-r2.ts');
const provider = readWeb('components/account/auth-provider.tsx');
const trips = readWeb('components/account/my-trips-client.tsx');
const account = readWeb('components/account/account-page-client.tsx');
const tripCard = readWeb('components/account/visual-saved-trip-card.tsx');
const nextConfig = readWeb('next.config.ts');
const legacyAuth = readRepo('frontend/scripts/auth-session-705b-r3.js');
const legacyBooking = readRepo('frontend/scripts/my-trips-booking-706a.js');

check('707A version marker is exact', config.includes("GV_WEB_707A_VERSION = 'GV-WEB-707A'"));
check('React migration is scoped under /react', nextConfig.includes("basePath: '/react'") && nextConfig.includes("output: 'export'"));
check('React auth reuses exact 705B session key', auth.includes("SESSION_KEY = 'globevoy.auth.session.705b-r3'") && legacyAuth.includes("SESSION_KEY = 'globevoy.auth.session.705b-r3'"));
check('React auth reuses exact 705B pending key', auth.includes("PENDING_KEY = 'globevoy.auth.pending.705b-r3'") && legacyAuth.includes("PENDING_KEY = 'globevoy.auth.pending.705b-r3'"));
check('React sign-in remains Authorization Code + PKCE S256', auth.includes("code_challenge_method', 'S256'") && auth.includes('pkceChallenge(verifier)') && auth.includes("response_type', 'code'"));
check('Existing legacy callback remains authoritative', config.includes("COGNITO_CALLBACK_URL = `${STAGING_ORIGIN}/auth-callback.html`") && auth.includes("redirect_uri', COGNITO_CALLBACK_URL"));
check('No auth token is written to localStorage', !/localStorage\.setItem\([^\n]*(token|session|auth)/i.test(auth) && auth.includes('localStorageTokensAllowed: false'));
check('No refresh or ID token persistence is introduced', auth.includes('refreshTokenPersisted: false') && auth.includes('idTokenPersisted: false'));
check('Saved Trips API remains bearer authenticated and cookie-free', api.includes('Authorization: `Bearer ${accessToken}`') && api.includes("credentials: 'omit'") && api.includes("cache: 'no-store'"));
check('Delete uses authenticated DELETE on exact saved-trip route', api.includes("request<unknown>('DELETE', `/api/saved-trips?tripId=${encodeURIComponent(id)}`"));
check('Signed-out My Trips clears private rows before any load', trips.includes('if (!session)') && trips.includes('setTrips([])') && trips.includes('my-trips-signin-title'));
check('401 clears the React account session', trips.includes('error.status === 401') && trips.includes('clear()'));
check('My Trips keeps snapshot trust language', trips.includes('VisualSavedTripCard') && tripCard.includes("state: 'estimate'") && tripCard.includes('Saved snapshot · price check needed') && tripCard.includes('checks current provider evidence before partner handoff'));
check('Open Trip allow-lists only proven legacy trip pages', handoff.includes("['trip.html', 'multicity-visualizer.html', 'multi-city-trip.html'].includes(name)"));
check('707A R2 origin-preservation marker is exact', openR2.includes("GV_WEB_707A_R2_VERSION = 'GV-WEB-707A-R2'"));
check('707A R2 prefers the saved account snapshot origin', openR2.includes('const snapshotOrigin = clean(trip.tripSnapshot.origin)') && openR2.includes('if (snapshotOrigin) return snapshotOrigin'));
check('707A R2 overwrites stale sourceUrl origin before legacy navigation', openR2.includes("url.searchParams.set('origin', savedOrigin)") && openR2.includes('window.location.assign(`/${name}${url.search}`)'));
check('707A R2 preserves the exact saved multi-city tour storage handoff', openR2.includes("MULTI_STORAGE = 'globevoy.multi.selected.v1'") && openR2.includes('JSON.stringify(snapshot.tour)'));
check('707A R2 keeps multi-city navigation on approved legacy routes', openR2.includes("new Set(['multicity-visualizer.html', 'multi-city-trip.html'])") && openR2.includes('url.origin !== window.location.origin'));
check('React My Trips uses the R2 origin-preserving Open Trip bridge', trips.includes("openSavedTripPreservingOrigin") && trips.includes("@/lib/saved-trip-open-707a-r2"));
check('Continue booking performs fresh owner-private GET', handoff.includes('const trip = await getSavedTrip(accessToken, id)') && handoff.includes('freshOwnerPrivateGetRequired: true'));
check('706A handoff prefix remains exact', handoff.includes("HANDOFF_PREFIX = 'gv.account.booking.handoff.706a.'") && legacyBooking.includes("HANDOFF_PREFIX = 'gv.account.booking.handoff.706a.'"));
check('Saved handoff is snapshot-only and requires revalidation', handoff.includes('snapshotOnly: true') && handoff.includes('requiresRevalidation: true'));
check('Provider handoff URLs are stripped before booking', handoff.includes("'bookingUrl', 'providerUrl', 'directSearchUrl'") && handoff.includes('delete subject[key]'));
check('Provider verification is downgraded before booking', handoff.includes('productionEligible = false') && handoff.includes("booking.status = 'revalidation-required'"));
check('React account exposes sign-out without password UI', account.includes('Sign out') && !/type=["']password/i.test(account));
check('Auth provider reverifies existing access-token session', provider.includes('reverifyAuthSession(current)'));

for (const [name, source] of [['auth', auth], ['api', api], ['handoff', handoff], ['open-r2', openR2], ['trips', trips], ['account', account]]) {
  check(`${name} source contains no obvious secret literal`, !/DUFFEL_ACCESS_TOKEN|AWS_SECRET_ACCESS_KEY|client_secret|BEGIN PRIVATE KEY|sk_live_/i.test(source));
}

checks.forEach((item, index) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}`));
const passed = checks.filter((item) => item.pass).length;
console.log(`GV-WEB-707A: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;

