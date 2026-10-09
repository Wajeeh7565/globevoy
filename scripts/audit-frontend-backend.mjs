#!/usr/bin/env node
/**
 * Read-only inventory of the classic frontend and Node backend.
 *
 * Usage: node scripts/audit-frontend-backend.mjs [--json]
 *
 * This tool deliberately never deletes/moves files. In particular, lack of a
 * literal file-name reference does NOT prove an asset, page, snapshot or
 * historical validator can be removed: paths may be dynamic or externally used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const includeForRefs = ['frontend', 'backend', 'web', 'scripts', 'tests', '.github', 'docs'];
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.css', '.json', '.md', '.yml', '.yaml', '.txt', '.ps1']);
const ignoredDirectories = new Set(['.git', 'node_modules', '.next', 'out', 'coverage', 'amplify-publish', 'fullsite-preview']);
const MAX_REFERENCE_FILE_SIZE = 1024 * 1024; // avoid loading multi-megabyte data snapshots
const MAX_CANDIDATES_SHOWN = 20;

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !ignoredDirectories.has(e.name)) items.push(...listFiles(path.join(dir, e.name)));
    else if (e.isFile()) items.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/'));
  }
  return items;
}

function filesize(p) {
  return fs.statSync(path.join(root, p)).size;
}
function byExtension(files) {
  const result = {};
  for (const p of files) {
    const ext = path.extname(p).toLowerCase() || '(no extension)';
    result[ext] = (result[ext] || 0) + 1;
  }
  return result;
}
function byTopDirectory(files, parent) {
  const out = {};
  for (const p of files) {
    const relative = p.slice(parent.length + 1);
    const label = relative.includes('/') ? relative.split('/')[0] : '(root)';
    out[label] = (out[label] || 0) + 1;
  }
  return out;
}

const frontend = listFiles(path.join(root, 'frontend'));
const backend = listFiles(path.join(root, 'backend'));
const repoDocs = listFiles(path.join(root, 'docs'));
const trackedLike = [...frontend, ...backend, ...repoDocs];
const frontRootDocs = frontend.filter(p => /^frontend\/[^/]+\.(?:md|txt|json|sha256|ps1)$/i.test(p));
const releaseArtifacts = frontRootDocs.filter(p => /^(?:frontend\/)(?:GV-|DEPLOY_|VALIDATION_|BROWSER_VALIDATION_)/.test(p));
const backendArchive = backend.filter(p => p.startsWith('backend/archive/'));
const backendData = backend.filter(p => p.startsWith('backend/data/'));
const referencePaths = includeForRefs.flatMap(dir => listFiles(path.join(root, dir)))
  .concat(fs.existsSync(path.join(root, 'amplify.yml')) ? ['amplify.yml'] : []);
let scannedReferenceFiles = 0;
let skippedOversizedReferenceFiles = 0;
const referenceTexts = [];
for (const p of referencePaths) {
  if (!textExtensions.has(path.extname(p).toLowerCase())) continue;
  if (p.startsWith('backend/data/') || p.startsWith('backend/archive/')) continue;
  if (filesize(p) > MAX_REFERENCE_FILE_SIZE) { skippedOversizedReferenceFiles++; continue; }
  referenceTexts.push([p, fs.readFileSync(path.join(root, p), 'utf8')]);
  scannedReferenceFiles++;
}
const candidateExamples = releaseArtifacts.map(candidate => {
  const base = path.basename(candidate);
  const refs = referenceTexts
    .filter(([p, content]) => p !== candidate && content.includes(base))
    .map(([p]) => p);
  return { path: candidate, literalReferences: refs.slice(0, 5), referenceCount: refs.length };
});
const frontOlderVariants = frontend.filter(p => /^frontend\/(?:scripts|styles)\/[^/]+[-_]\d{3,}[^/]*\.(?:js|css)$/i.test(p));

const result = {
  warning: 'Inventory only. No file is declared unused or safe to delete. Search is non-exhaustive.',
  frontend: {
    fileCount: frontend.length,
    totalMB: Number((frontend.reduce((sum, p) => sum + filesize(p), 0) / 1048576).toFixed(2)),
    byExtension: byExtension(frontend),
    byDirectory: byTopDirectory(frontend, 'frontend'),
    historicalReportCandidates: releaseArtifacts.length,
    versionedJsCssFilesToAudit: frontOlderVariants.length
  },
  backend: {
    fileCount: backend.length,
    totalMB: Number((backend.reduce((sum, p) => sum + filesize(p), 0) / 1048576).toFixed(2)),
    byExtension: byExtension(backend),
    byDirectory: byTopDirectory(backend, 'backend'),
    archivedFiles: backendArchive.length,
    dataFiles: backendData.length,
    largestDataFiles: backendData.slice().sort((a, b) => filesize(b) - filesize(a))
      .slice(0, 10).map(p => ({ path: p, MB: Number((filesize(p) / 1048576).toFixed(2)) }))
  },
  referenceAudit: {
    scannedTextFiles: scannedReferenceFiles,
    oversizedFilesSkipped: skippedOversizedReferenceFiles,
    candidateCount: candidateExamples.length,
    sampleCandidates: candidateExamples.slice(0, MAX_CANDIDATES_SHOWN)
  },
  general: { countInAuditedFolders: trackedLike.length }
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('GlobeVoy frontend/backend read-only cleanup audit');
  console.log('Frontend:', result.frontend.fileCount, 'files /', result.frontend.totalMB, 'MB; historical root reports:', result.frontend.historicalReportCandidates);
  console.log('Backend:', result.backend.fileCount, 'files /', result.backend.totalMB, 'MB; already archived:', result.backend.archivedFiles, '; data files:', result.backend.dataFiles);
  console.log('Files scanned for literal references:', result.referenceAudit.scannedTextFiles);
  console.log('\nLargest backend data files:');
  for (const entry of result.backend.largestDataFiles) console.log(' -', entry.path, entry.MB + ' MB');
  console.log('\nHistorical frontend reports for manual review (first 20):');
  for (const entry of result.referenceAudit.sampleCandidates) {
    console.log(' -', entry.path, '(' + entry.referenceCount + ' literal references found)');
  }
  console.log('\nWARNING:', result.warning);
}
