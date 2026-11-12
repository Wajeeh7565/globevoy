// Test-only cache of the version already loaded by ResultsMap710D. No runtime
// dependency upgrade or new maps provider. Hashes are Leaflet 1.9.4 release SRI.
import fs from 'node:fs';
import crypto from 'node:crypto';
const assets = {
  'leaflet.js': '20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  'leaflet.css': 'p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
};
fs.mkdirSync('.cache/leaflet-test', {recursive:true});
for (const [name, hash] of Object.entries(assets)) {
  const file='.cache/leaflet-test/'+name;
  let bytes=fs.existsSync(file)?fs.readFileSync(file):null;
  if (!bytes) {
    const response=await fetch('https://unpkg.com/leaflet@1.9.4/dist/'+name,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Could not cache pinned Leaflet test asset');
    bytes=Buffer.from(await response.arrayBuffer());
  }
  if(crypto.createHash('sha256').update(bytes).digest('base64')!==hash)throw Error('Leaflet test asset integrity mismatch');
  fs.writeFileSync(file,bytes);
}
console.log('Cached integrity-verified Leaflet 1.9.4 JS/CSS for offline browser tests; no tile requests.');
