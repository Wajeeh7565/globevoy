import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import policy from '../../frontend/runtime/environment-policy.js';
import { approvedFrontend, productionPolicySource } from '../release/production-frontend-policy.mjs';

// Use the maintained release factory and identifiers, never a proxy or a second
// auth implementation. Each artifact includes exactly one selected environment.
export function dockerPolicy(target = 'isolated') {
  if (target === 'isolated') return {
    manifest: { target, origin: null },
    source: fs.readFileSync(new URL('./demo-policy.cjs', import.meta.url), 'utf8')
  };
  if (target === 'production') return {
    manifest: { target, origin: 'https://globevoy.com' },
    source: productionPolicySource({ environment: 'production', target: 'globevoy.com',
      apiBaseUrl: approvedFrontend.apiBaseUrl, reactEnabled: true, accountsEnabled: true, auth: approvedFrontend.auth })
  };
  if (target === 'staging') {
    const configuration = { productionOnly: true, productionApi: '', productionOrigins: [],
      stagingApi: policy.stagingApi, stagingOrigin: policy.stagingOrigin, stagingAuth: policy.stagingAuth };
    return { manifest: { target, origin: policy.stagingOrigin },
      source: `(function(root,factory){const policy=factory(${JSON.stringify(configuration)});\n` +
        `if(typeof module==='object'&&module.exports)module.exports=policy;else root.GLOBEVOY_ENVIRONMENT_POLICY=policy;\n` +
        `})(typeof window==='undefined'?globalThis:window,${policy.createPolicy.toString()});\n` };
  }
  throw Error('Docker target must be isolated, production or staging; no arbitrary API/origin override is supported.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selected = dockerPolicy(process.argv[2] || 'isolated');
  fs.mkdirSync('.cache/docker-policy', { recursive: true });
  fs.writeFileSync('.cache/docker-policy/environment-policy.cjs', selected.source);
  fs.writeFileSync('.cache/docker-policy/docker-target.json', JSON.stringify(selected.manifest));
  console.log('Prepared ' + selected.manifest.target + ' policy; no network requests or deployment.');
}
