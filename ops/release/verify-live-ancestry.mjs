// Refuses a deployment that would replace newer production code with older code.
// Usage: node ops/release/verify-live-ancestry.mjs <live-release-manifest.json> <package-dir>
// Fetch the live manifest first: curl -fsS https://globevoy.com/release-manifest.json -o live-manifest.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function checkAncestry(live, next, isAncestor) {
  if (!live?.commit || !next?.commit) return { ok: false, reason: 'Both manifests need a commit.' };
  if (next.deployable === false || next.ciTestPackage) return { ok: false, reason: 'This is a CI test package and cannot be deployed.' };
  if (next.dirty) return { ok: false, reason: 'The new package was built from uncommitted code.' };
  if (live.commit === next.commit) return { ok: true, reason: 'Same commit as production (redeploy).' };
  if (!isAncestor(live.commit, next.commit)) {
    return { ok: false, reason: `Production commit ${live.commit} is not contained in ${next.commit}. Merge production's commit first.` };
  }
  return { ok: true, reason: `${next.commit} contains production commit ${live.commit}.` };
}

const gitAncestor = (a, b) => {
  try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch { return false; }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [livePath, packageDir] = process.argv.slice(2);
  if (!livePath || !packageDir) { console.error('Usage: verify-live-ancestry.mjs <live-manifest.json> <package-dir>'); process.exit(2); }
  const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
  const next = JSON.parse(fs.readFileSync(path.join(packageDir, 'release-manifest.json'), 'utf8'));
  const result = checkAncestry(live, next, gitAncestor);
  console.log((result.ok ? 'PASS ' : 'FAIL ') + result.reason);
  process.exit(result.ok ? 0 : 1);
}
