import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stagingDestinations, approvedFrontend } from './production-frontend-policy.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
export function verifyProductionFrontend(artifact) {
  return JSON.parse(execFileSync(process.env.PYTHON || 'python',
    [path.join(root,'verify-production-frontend.py'),path.resolve(artifact)],
    {input:JSON.stringify({staging:stagingDestinations(),approved:approvedFrontend}),encoding:'utf8',stdio:['pipe','pipe','pipe']}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !fs.existsSync(process.argv[2])) throw Error('Supply the built directory or ZIP to inspect.');
  console.log(JSON.stringify(verifyProductionFrontend(process.argv[2]),null,2));
}
