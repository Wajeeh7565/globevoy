import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Used only for the coordinated layout migration. Compare actual runtime source
// against its PR base, allowing relocated CommonJS imports but no other edits.
const baseline = process.argv[2] || '9789223a153eb92d2162651d9198ddd24c932108';
const moves = JSON.parse(fs.readFileSync('docs/refactor/active-layout-moves.json', 'utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const originalFiles = git('ls-tree', '-r', '--name-only', baseline).trim().split('\n');
const originalSet = new Set(originalFiles);
const currentSet = new Set(originalFiles.map(file => moves[file] || file));
const runtime = file => (
  file.startsWith('backend/') && file.endsWith('.js') &&
    !file.includes('/archive/') && !file.includes('/validation/') && !path.posix.basename(file).startsWith('validate-')
) || (
  file.startsWith('frontend/') && !file.includes('/validation/') &&
    (/^frontend\/(scripts|runtime|styles)\//.test(file) || /^frontend\/[^/]+\.html$/.test(file)) &&
    !file.endsWith('-fixture.html')
);
function normalize(source, filename, files, relocate) {
  return source.replace(/\r\n/g, '\n').replace(
    /\brequire(?:\.resolve)?\(\s*(['"])(\.[^'"\n]+)\1\s*\)/g,
    (call, quote, specifier) => {
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier));
      if (!files.has(target) && files.has(`${target}.js`)) target += '.js';
      if (!files.has(target)) throw new Error(`Unresolved runtime import: ${filename} -> ${specifier}`);
      return call.replace(specifier, `@repository/${relocate ? moves[target] || target : target}`);
    }
  );
}
let checked = 0;
function checkAddedRuntime(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!['archive', 'node_modules', '.next'].includes(entry.name)) checkAddedRuntime(filename);
    } else if (runtime(filename) && !currentSet.has(filename)) {
      throw new Error(`New runtime file is outside the layout migration: ${filename}`);
    }
  }
}
checkAddedRuntime('backend');
checkAddedRuntime('frontend');
for (const original of originalFiles.filter(runtime)) {
  const current = moves[original] || original;
  const before = normalize(git('show', `${baseline}:${original}`), original, originalSet, true);
  const after = normalize(fs.readFileSync(current, 'utf8'), current, currentSet, false);
  if (before !== after) throw new Error(`Runtime change beyond import relocation: ${original} -> ${current}`);
  checked++;
}
console.log(`PASS layout equivalence: ${checked} runtime files preserve source behavior; only module paths moved.`);
