import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const output = process.argv[2] || '.cache/fargate-demo-site';
const result = spawnSync(process.execPath, ['ops/frontend/compose-site.mjs', output], {stdio:'inherit'});
if (result.status !== 0) process.exit(result.status || 1);
fs.copyFileSync('.cache/docker-policy/environment-policy.cjs', path.join(output, 'runtime/environment-policy.js'));
fs.copyFileSync('.cache/docker-policy/docker-target.json', path.join(output, 'runtime/docker-target.json'));
console.log('Selected Docker policy installed; production and staging source unchanged.');
