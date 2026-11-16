// Offline/local build only. No AWS commands. Uses the existing locked dependency manifest.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const stage = path.resolve(process.argv[2] || '.cache/login-history-package');
if (!stage.startsWith(path.resolve('.cache') + path.sep)) throw new Error('Output must stay inside .cache');
if (fs.existsSync(stage)) throw new Error('Remove the previous local package directory before rebuilding');
fs.mkdirSync(stage, { recursive: true });
for (const name of ['package.json', 'package-lock.json'])
  fs.copyFileSync(`ops/release/backend-dependencies/${name}`, path.join(stage, name));
fs.copyFileSync('backend/services/accounts/login-history/post-authentication.cjs', path.join(stage, 'index.cjs'));
const args = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
const result = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/d', '/c', 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund'],
      { cwd: stage, stdio: 'inherit' })
  : spawnSync('npm', args, { cwd: stage, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Package directory: ${stage}; handler index.handler. Tracking defaults OFF.`);
const zip = `${stage}.zip`;
const archive = spawnSync('python', ['-c', `
import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED) as out:
    for p in sorted(root.rglob('*')):
        if p.is_file():
            info=zipfile.ZipInfo(p.relative_to(root).as_posix(), (2026,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644 << 16
            out.writestr(info,p.read_bytes())
`, stage, zip], { stdio: 'inherit' });
if (archive.status !== 0) process.exit(archive.status || 1);
console.log(`ZIP: ${zip}`);
console.log(`SHA-256: ${createHash('sha256').update(fs.readFileSync(zip)).digest('hex')}`);
