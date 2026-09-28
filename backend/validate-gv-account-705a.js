'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const account = require('./services/accounts/architecture/account-architecture-705a');

assert.equal(account.VERSION, 'GV-ACCOUNT-705A');
assert.equal(account.AUTH_PROVIDER, 'Amazon-Cognito-User-Pools');
assert.equal(account.AUTH_FLOW, 'authorization-code-pkce');
assert.equal(account.API_TOKEN_USE, 'access');
assert.equal(account.TOKEN_STORAGE, 'session-storage-no-refresh-token-persistence');

const staging = account.publicClientPlan705A('staging');
assert(staging);
assert.equal(staging.clientType, 'public-browser-client');
assert.equal(staging.clientSecretRequired, false);
assert.equal(staging.clientSecretAllowedInBrowser, false);
assert.equal(staging.authorizationCodeGrant, true);
assert.equal(staging.pkceRequired, true);
assert.equal(staging.pkceMethod, 'S256');
assert.equal(staging.implicitGrantAllowed, false);
assert.equal(staging.clientCredentialsGrantAllowed, false);
assert.equal(staging.managedLogin, true);
assert.equal(staging.localStorageTokensAllowed, false);
assert.equal(staging.refreshTokenPersistedInBrowser, false);
assert.equal(staging.identityPoolRequired, false);
assert.equal(staging.awsCredentialsAllowedInBrowser, false);
assert.equal(staging.guestPlanningAllowed, true);
assert.equal(staging.persistentSaveRequiresAuthentication, true);
assert.deepEqual(staging.callbackUrls, ['https://staging.dy4fw8gx1ccie.amplifyapp.com/auth-callback.html']);
assert.deepEqual(staging.logoutUrls, ['https://staging.dy4fw8gx1ccie.amplifyapp.com/index.html']);

const production = account.publicClientPlan705A('production');
assert.deepEqual(production.callbackUrls, ['https://globevoy.com/auth-callback.html']);
assert.deepEqual(production.logoutUrls, ['https://globevoy.com/index.html']);
assert.equal(production.wildcardCallbacksAllowed, false);

const validClient = account.validatePublicClientConfig705A({
  environment: 'staging',
  generateSecret: false,
  allowedOAuthFlows: ['code'],
  pkceRequired: true,
  pkceMethod: 'S256',
  callbackUrls: staging.callbackUrls,
  logoutUrls: staging.logoutUrls
});
assert.equal(validClient.valid, true);

const secretClient = account.validatePublicClientConfig705A({
  environment: 'staging',
  generateSecret: true,
  allowedOAuthFlows: ['code'],
  pkceRequired: true,
  callbackUrls: staging.callbackUrls,
  logoutUrls: staging.logoutUrls
});
assert.equal(secretClient.valid, false);
assert(secretClient.errors.includes('public-client-must-not-have-secret'));

const implicitClient = account.validatePublicClientConfig705A({
  environment: 'staging',
  generateSecret: false,
  allowedOAuthFlows: ['code', 'implicit'],
  pkceRequired: true,
  callbackUrls: staging.callbackUrls,
  logoutUrls: staging.logoutUrls
});
assert.equal(implicitClient.valid, false);
assert(implicitClient.errors.includes('implicit-grant-forbidden'));

const wrongCallback = account.validatePublicClientConfig705A({
  environment: 'staging',
  generateSecret: false,
  allowedOAuthFlows: ['code'],
  pkceRequired: true,
  callbackUrls: ['https://evil.example/auth-callback.html'],
  logoutUrls: staging.logoutUrls
});
assert.equal(wrongCallback.valid, false);
assert(wrongCallback.errors.includes('callback-allowlist-mismatch'));

const claims = {
  sub: '11111111-2222-3333-4444-555555555555',
  iss: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_EXAMPLE',
  client_id: 'public-client-705a',
  token_use: 'access',
  scope: 'openid email profile globevoy/trips.write',
  email: 'traveller@example.com',
  email_verified: true
};
const principal = account.verifiedPrincipal705A(claims, {
  jwtVerified: true,
  expectedIssuer: claims.iss,
  expectedClientId: claims.client_id,
  requiredScope: account.REQUIRED_API_SCOPE
});
assert.equal(principal.valid, true);
assert.equal(principal.principal.sub, claims.sub);
assert.equal(principal.principal.emailVerified, true);

const decodedOnly = account.verifiedPrincipal705A(claims, { jwtVerified: false });
assert.equal(decodedOnly.valid, false);
assert(decodedOnly.errors.includes('jwt-must-be-cryptographically-verified-first'));

const idToken = account.verifiedPrincipal705A({ ...claims, token_use: 'id' }, { jwtVerified: true });
assert.equal(idToken.valid, false);
assert(idToken.errors.includes('access-token-required-for-api'));

const wrongIssuer = account.verifiedPrincipal705A(claims, {
  jwtVerified: true,
  expectedIssuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_OTHER'
});
assert.equal(wrongIssuer.valid, false);
assert(wrongIssuer.errors.includes('issuer-mismatch'));

const missingScope = account.verifiedPrincipal705A({ ...claims, scope: 'openid email profile' }, {
  jwtVerified: true,
  requiredScope: account.REQUIRED_API_SCOPE
});
assert.equal(missingScope.valid, false);
assert(missingScope.errors.includes('required-scope-missing'));

const saved = account.buildSavedTripRecord705A(principal.principal, {
  tripId: 'trip_2026_001',
  ownerSub: 'ATTACKER-CONTROLLED-SUB-MUST-BE-IGNORED',
  title: 'Miami and Orlando',
  trip: {
    originAirportCode: 'JFK',
    stops: [
      { cityId: 'miami-us', city: 'Miami', airportCode: 'MIA', nights: 3 },
      { cityId: 'orlando-us', city: 'Orlando', airportCode: 'MCO', nights: 2 }
    ],
    dateMode: 'exact',
    departureDate: '2026-10-15',
    returnDate: '2026-10-20',
    budget: { amount: 2500, currency: 'USD' },
    travellers: { adults: 2, children: 0 },
    recommendationRole: 'best-balance'
  }
}, '2026-08-21T02:00:00.000Z');
assert.equal(saved.valid, true);
assert.equal(saved.record.ownerSub, claims.sub);
assert.equal(saved.record.PK, `USER#${claims.sub}`);
assert.equal(saved.record.SK, 'TRIP#trip_2026_001');
assert.equal(saved.record.trip.originAirportCode, 'JFK');
assert.equal(saved.record.trip.stops.length, 2);
assert.equal(saved.record.trip.budget.amount, 2500);
assert.equal(saved.record.trip.travellers.adults, 2);
assert.equal(saved.record.evidencePolicy.savedPriceIsSnapshotOnly, true);
assert.equal(saved.record.evidencePolicy.savedPriceMustNotBeClaimedLiveOnReopen, true);
assert.equal(saved.record.evidencePolicy.revalidateProvidersWhenTripIsReopened, true);
assert.equal(saved.record.evidencePolicy.rawProviderResponsesStored, false);
assert.equal(saved.record.evidencePolicy.providerCredentialsStored, false);
assert.equal(saved.record.evidencePolicy.paymentDataStored, false);
assert.equal(saved.record.evidencePolicy.passportNumbersOrScansStored, false);
assert.equal(Object.values(saved.record).includes('ATTACKER-CONTROLLED-SUB-MUST-BE-IGNORED'), false);

const noOwner = account.buildSavedTripRecord705A({}, { tripId: 'trip_1', originAirportCode: 'JFK', stops: [{ airportCode: 'MIA' }] });
assert.equal(noOwner.valid, false);
assert(noOwner.errors.includes('verified-owner-sub-required'));

const migration = account.migrationPlan705A();
assert.equal(migration.currentBrowserProfileKey, 'globevoy.travel.profile.v1');
assert.equal(migration.autoUploadExistingBrowserProfileOnSignIn, false);
assert.equal(migration.explicitMigrationConfirmationRequired, true);
assert.equal(migration.browserEmailMustNotOverrideVerifiedAccountEmail, true);
assert.equal(migration.guestPlanningRemainsAvailable, true);
assert(migration.prohibitedProfileFields.includes('passportNumber'));
assert(migration.prohibitedProfileFields.includes('paymentCard'));

const storage = account.storagePlan705A();
assert.equal(storage.recommendedStore, 'Amazon-DynamoDB');
assert.equal(storage.ownerSource, 'verified-access-token-sub-only');
assert.equal(storage.ownerAcceptedFromRequestBody, false);
assert.equal(storage.crossUserReadAllowed, false);
assert.equal(storage.crossUserWriteAllowed, false);
assert.equal(storage.publicSharingIn705, false);
assert.equal(storage.reopenRequiresPriceRevalidation, true);

const status = account.architectureStatus705A();
assert.equal(status.cognitoResourcesCreatedBy705A, false);
assert.equal(status.dynamodbResourcesCreatedBy705A, false);
assert.equal(status.frontendRuntimeChangedBy705A, false);
assert.equal(status.backendRuntimeChangedBy705A, false);
assert.equal(status.productionChanged, false);
assert.equal(status.recommendedJwtVerifierForNode, 'aws-jwt-verify');

// Audit the current product boundary so 705B does not accidentally treat the
// existing local travel profile as secure authentication.
const frontendIndex = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
const profileHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'create-account.html'), 'utf8');
const profileJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'scripts', 'travel-profile-675a.js'), 'utf8');
const shellJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'scripts', 'shell-670f.js'), 'utf8');
const lambdaJs = fs.readFileSync(path.join(__dirname, 'lambda.js'), 'utf8');

assert(frontendIndex.includes('You can continue as a guest.'));
assert(frontendIndex.includes('Continue as guest'));
assert(profileHtml.includes('It is not a secure Globevoy account'));
assert(profileHtml.includes('this creates a travel profile stored only in this browser'));
assert(profileJs.includes("const KEY='globevoy.travel.profile.v1'"));
assert(profileJs.includes('localStorage.setItem(KEY,JSON.stringify(profile))'));
assert(shellJs.includes('Travel profile'));
assert(lambdaJs.includes("'Access-Control-Allow-Headers': 'Content-Type,X-GV-Admin-Token,X-GV-Provider-Canary,Authorization'"));

// 705A itself must remain architecture-only and must not be imported by the
// current browser/backend runtime until 705B explicitly implements it.
for (const file of [
  path.join(__dirname, 'lambda.js'),
  path.join(__dirname, 'generated-tour.js'),
  path.join(__dirname, '..', 'frontend', 'scripts', 'shell-670f.js'),
  path.join(__dirname, '..', 'frontend', 'scripts', 'travel-profile-675a.js')
]) {
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(/account-architecture-705a|GV-ACCOUNT-705A/.test(text), false, `${file} contains runtime 705A wiring`);
}

const moduleText = fs.readFileSync(path.join(__dirname, 'services', 'accounts', 'architecture', 'account-architecture-705a.js'), 'utf8');
for (const forbidden of [
  'require(\'@aws-sdk/',
  'require("@aws-sdk/',
  'CognitoIdentityProviderClient(',
  'DynamoDBClient(',
  'globalThis.fetch(',
  'DUFFEL_ACCESS_TOKEN',
  'AGODA_API_KEY',
  'clientSecret:'
]) {
  assert.equal(moduleText.includes(forbidden), false, `705A pure contract contains forbidden runtime/secret token: ${forbidden}`);
}

console.log('GV-ACCOUNT-705A validation PASS');
console.log(JSON.stringify({
  version: account.VERSION,
  currentProfile: 'browser-only-localStorage-not-secure-account',
  authProvider: account.AUTH_PROVIDER,
  authFlow: account.AUTH_FLOW,
  managedLogin: staging.managedLogin,
  tokenStorage: account.TOKEN_STORAGE,
  apiTokenUse: account.API_TOKEN_USE,
  guestPlanningAllowed: staging.guestPlanningAllowed,
  savedTripStore: storage.recommendedStore,
  ownerSource: storage.ownerSource,
  providerPriceRevalidationOnReopen: storage.reopenRequiresPriceRevalidation,
  runtimeChanged: false
}, null, 2));
