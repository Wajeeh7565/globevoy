import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sourceLayout from '../frontend/source-layout.cjs';
import { readPageLayout, writeCompatibilityPages } from '../frontend/page-layout.mjs';
import { writeClassicSeo } from '../frontend/seo.mjs';
import { productionPolicySource } from './production-frontend-policy.mjs';
import { verifyProductionFrontend } from './verify-production-frontend.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const key = process.env.GLOBEVOY_MAPS_BROWSER_KEY;
if (!key || !/^AIza[\w-]{35}$/.test(key)) throw Error('Set GLOBEVOY_MAPS_BROWSER_KEY to the restricted public browser key. Never use a server credential.');
// The hybrid UI is opt-in. Ordinary production builds remain classic-only until
// the deployment owner has verified the matching public API and Cognito setup.
const reactEnabled = process.env.GLOBEVOY_ENABLE_PRODUCTION_REACT === 'true';
const accountsEnabled = process.env.GLOBEVOY_ENABLE_PRODUCTION_ACCOUNTS === 'true';
const apiBaseUrl = process.env.GLOBEVOY_PRODUCTION_API_BASE_URL || 'https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws';
const stagingApi = 'https://mirksnjcjim4iowstuda4lesrm0ghmfw.lambda-url.us-east-2.on.aws';
if (!/^https:\/\/[a-z0-9-]+\.lambda-url\.us-east-2\.on\.aws\/?$/.test(apiBaseUrl) || apiBaseUrl.replace(/\/$/, '') === stagingApi) {
 throw Error('Production API must be a dedicated HTTPS Lambda URL, never the staging API.');
}
if (reactEnabled && process.env.GLOBEVOY_PRODUCTION_REACT_VERIFIED !== 'yes') {
 throw Error('React production requires GLOBEVOY_PRODUCTION_REACT_VERIFIED=yes after browser/API acceptance.');
}
if (accountsEnabled && (!reactEnabled || process.env.GLOBEVOY_PRODUCTION_ACCOUNTS_VERIFIED !== 'yes')) {
 throw Error('Accounts require approved React and GLOBEVOY_PRODUCTION_ACCOUNTS_VERIFIED=yes after backend/Cognito verification.');
}
let auth = null;
if (accountsEnabled) {
 const region = 'us-east-2';
 const userPoolId = process.env.GLOBEVOY_PRODUCTION_USER_POOL_ID || '';
 const clientId = process.env.GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID || '';
 const domainBaseUrl = (process.env.GLOBEVOY_PRODUCTION_COGNITO_DOMAIN || '').replace(/\/$/, '');
 if (!/^us-east-2_[A-Za-z0-9]+$/.test(userPoolId) || !/^[a-z0-9]{12,64}$/.test(clientId) ||
     !/^https:\/\/[a-z0-9-]+\.auth\.us-east-2\.amazoncognito\.com$/.test(domainBaseUrl) ||
     domainBaseUrl.includes('globevoy-stg-')) {
  throw Error('Production Cognito public IDs/domain missing or invalid. Never use the staging pool.');
 }
 auth = { region, userPoolId, clientId, issuer: 'https://cognito-idp.us-east-2.amazonaws.com/' + userPoolId, domainBaseUrl };
}
const releaseConfig = { environment: 'production', target: 'globevoy.com', apiBaseUrl: apiBaseUrl.replace(/\/$/, ''), reactEnabled, accountsEnabled, auth };
const outputName = process.env.GLOBEVOY_OUTPUT_NAME || 'production-site';
if (!/^[a-zA-Z0-9_-]+$/.test(outputName)) throw Error('Invalid output name');
const output = path.join(root, '.cache', outputName);
if ([output, output+'.zip', output+'.zip.sha256'].some(file => fs.existsSync(file))) throw Error('Output already exists. Preserve/rename .cache/production-site before rebuilding.');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim());
// Production packages must come from committed code that is already on GitHub main,
// so every deployed file can be traced to a pushed commit (docs/RELEASE.md).
if (dirty && process.env.GLOBEVOY_ALLOW_DIRTY_BUILD !== 'yes') throw Error('Commit your changes first: production packages are built from a clean tree.');
let onMain = false;
try { execFileSync('git',['merge-base','--is-ancestor',commit,'origin/main'],{cwd:root,stdio:'ignore'}); onMain = true; } catch {}
if (!onMain && process.env.GLOBEVOY_ALLOW_UNMERGED_BUILD !== 'yes') throw Error('HEAD is not on origin/main. Merge and push to main, run git fetch, then build. (Set GLOBEVOY_ALLOW_UNMERGED_BUILD=yes only for a pre-merge review package.)');
const policySource = productionPolicySource(releaseConfig);
const policyModule = path.join(root, '.cache', outputName + '-policy.cjs');
fs.mkdirSync(path.dirname(policyModule), {recursive:true});
fs.writeFileSync(policyModule, policySource);
execFileSync(process.execPath, [path.join(root, 'web/node_modules/next/dist/bin/next'), 'build'], {
 cwd:path.join(root,'web'), stdio:'inherit',
 env:{...process.env,GLOBEVOY_PRODUCTION_POLICY_MODULE:policyModule,NEXT_PUBLIC_GLOBEVOY_API_BASE_URL:releaseConfig.apiBaseUrl,NEXT_PUBLIC_GLOBEVOY_LEGACY_ASSET_BASE_URL:'/assets'}
});
fs.mkdirSync(output, {recursive:true});
sourceLayout.copyFrontendSource(output);
writeClassicSeo(output, readPageLayout().publicPageSources);
fs.cpSync(path.join(root,'web/out'),path.join(output,'react'),{recursive:true});
writeCompatibilityPages(output);
const configPath=path.join(output,'runtime/config.js');
fs.writeFileSync(configPath,fs.readFileSync(configPath,'utf8').replace('YOUR_RESTRICTED_GOOGLE_MAPS_BROWSER_KEY',key));
// The same file is loaded by classic HTML and by Next before hydration, so both
// frontends resolve the identical public production configuration at runtime.
const policyPath = path.join(output, 'runtime/environment-policy.js');
fs.writeFileSync(policyPath, policySource);
for (const file of ['index.html','auth-callback.html','runtime/auth-config-705b-r3.js','scripts/auth-session-705b-r3.js','runtime/environment-policy.js','react/index.html','react/account/index.html','react/my-trips/index.html','react/journey/index.html']) {
 if (!fs.existsSync(path.join(output,file))) throw Error('Missing release file: '+file);
 if(file.startsWith('react/') && !fs.readFileSync(path.join(output,file),'utf8').includes('/react/_next/')) throw Error('Missing React asset prefix: '+file);
}
for (const excluded of ['validation','screenshots','.env','package.json']) if(fs.existsSync(path.join(output,excluded))) throw Error('Unexpected public content: '+excluded);
const files={};
for (const file of fs.readdirSync(output,{recursive:true}).sort()) {
 const full=path.join(output,file);
 if(fs.statSync(full).isFile()) files[file.replaceAll('\\','/')]=createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({commit,dirty,onMain,productionOnly:true,builtAt:new Date().toISOString(),productionAccounts:accountsEnabled,productionReact:reactEnabled,files},null,2)+'\n');
console.log('Validated static artifact: '+output+' ('+Object.keys(files).length+' files). No deployment performed.');

console.log('Production directory scan:', verifyProductionFrontend(output));
const zip = output + '.zip';
if (fs.existsSync(zip)) throw Error('ZIP already exists; preserve it before rebuilding.');
execFileSync(process.env.PYTHON || 'python', ['-c',
 'import shutil,sys;shutil.make_archive(sys.argv[1],"zip",sys.argv[1])',output], {stdio:'inherit'});
const verified = verifyProductionFrontend(zip);
console.log('Actual ZIP scan:', verified);
const sha256 = createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
fs.writeFileSync(zip + '.sha256', sha256 + '  ' + path.basename(zip) + '\n');
console.log('ZIP SHA-256: ' + sha256 + '. No deployment performed.');
