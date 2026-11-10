import fs from 'node:fs';
import assert from 'node:assert/strict';
import policy from '../../frontend/runtime/environment-policy.js';
import { execFileSync } from 'node:child_process';
import { approvedFrontend } from '../../ops/release/production-frontend-policy.mjs';
if (process.argv.includes('--verify-normal-build')) {
 const chunks=fs.readdirSync('web/out',{recursive:true}).filter(file=>file.endsWith('.js'));
 for (const value of [policy.stagingApi,policy.stagingOrigin,policy.stagingAuth.userPoolId,policy.stagingAuth.clientId,policy.stagingAuth.domainBaseUrl]) {
  assert.ok(chunks.some(file=>fs.readFileSync('web/out/'+file,'utf8').includes(value)), 'Normal build lost its staging defaults');
 }
 console.log('PASS normal build retains staging destinations after the isolated production build');
} else {
// Offline CI fixture: public identifiers, dummy Maps key, no AWS or real authentication.
execFileSync(process.execPath,['ops/release/package-production.mjs'],{stdio:'inherit',env:{...process.env,
 GLOBEVOY_OUTPUT_NAME:process.env.GLOBEVOY_OUTPUT_NAME||'ci-production-frontend',
 GLOBEVOY_MAPS_BROWSER_KEY:process.env.GLOBEVOY_MAPS_BROWSER_KEY||'AIza'+'0'.repeat(35),
 GLOBEVOY_PRODUCTION_API_BASE_URL:approvedFrontend.apiBaseUrl,
 // Simulate a developer shell configured for staging; the production child overrides it.
 NEXT_PUBLIC_GLOBEVOY_API_BASE_URL:policy.stagingApi,
 NEXT_PUBLIC_GLOBEVOY_LEGACY_ASSET_BASE_URL:policy.stagingOrigin+'/assets',
 GLOBEVOY_ENABLE_PRODUCTION_REACT:'true',GLOBEVOY_ENABLE_PRODUCTION_ACCOUNTS:'true',
 GLOBEVOY_PRODUCTION_REACT_VERIFIED:'yes',GLOBEVOY_PRODUCTION_ACCOUNTS_VERIFIED:'yes',
 GLOBEVOY_PRODUCTION_USER_POOL_ID:approvedFrontend.auth.userPoolId,
 GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID:approvedFrontend.auth.clientId,
 GLOBEVOY_PRODUCTION_COGNITO_DOMAIN:approvedFrontend.auth.domainBaseUrl
}});

}
