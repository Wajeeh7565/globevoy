import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/refactor/remaining-cleanup-moves.json'), 'utf8'));
const failures = [];
for (const move of manifest.moves) {
  const destination = path.join(root, move.to);
  if (fs.existsSync(path.join(root, move.from))) failures.push(`Archived file returned to active tree: ${move.from}`);
  if (!fs.existsSync(destination)) {
    failures.push(`Missing archive: ${move.to}`);
    continue;
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  if (hash !== move.sha256) failures.push(`Historical bytes changed: ${move.to}`);
}

// Scan executable/configuration surfaces, including release manifests, for
// references to the archived filenames. Historical prose is intentionally excluded.
const extensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.css', '.json', '.yml', '.yaml', '.ps1', '.sh', '.sha256', '.txt']);
const excluded = new Set(['.git', 'node_modules', '.next', 'out', 'archive', 'docs', 'coverage', '.cache', 'amplify-publish']);
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) inspect(absolute);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      const text = fs.readFileSync(absolute, 'utf8');
      for (const move of manifest.moves) {
        if (text.includes(path.posix.basename(move.from))) {
          failures.push(`Active reference to archived file: ${path.relative(root, absolute)} -> ${move.from}`);
        }
      }
    }
  }
}
inspect(root);
const layout = JSON.parse(fs.readFileSync(path.join(root, 'docs/refactor/active-layout-moves.json'), 'utf8'));
for (const [before, after] of Object.entries(layout)) {
  if (fs.existsSync(path.join(root, before))) failures.push(`Old layout path still exists: ${before}`);
  if (!fs.existsSync(path.join(root, after))) failures.push(`Moved file missing: ${after}`);
}
const entryPoints = new Set(['lambda.js', 'server.js', 'staging-lambda.js', 'staging-lambda-702d.js', 'production-account-lambda.js']);
for (const name of fs.readdirSync(path.join(root, 'backend'))) {
  if (name.endsWith('.js') && !entryPoints.has(name)) failures.push(`Backend root is reserved for entry points: ${name}`);
}
for (const entry of fs.readdirSync(path.join(root, 'frontend'), { withFileTypes: true })) {
  if (entry.isFile() && !entry.name.endsWith('.html') && !['favicon.ico', 'README.md'].includes(entry.name)) {
    failures.push(`Frontend root is reserved for public pages, favicon and README: ${entry.name}`);
  }
  if (entry.name.endsWith('-fixture.html')) failures.push(`Move browser fixture under validation/fixtures: ${entry.name}`);
}
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PASS organization: ${manifest.moves.length} byte-preserved moves; no active references to archived files.`);
}
