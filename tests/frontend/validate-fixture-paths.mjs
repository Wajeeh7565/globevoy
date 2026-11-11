import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { frontendSourcePath } from '../../ops/frontend/source-layout.cjs';
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
const directory = path.join(frontend, 'validation/fixtures');
let redirects = 0;
for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(directory, name), 'utf8');
  const page = new URL(`/validation/fixtures/${name}`, 'https://fixture.invalid');
  const storage = new Map();
  let destination;
  const context = {
    sessionStorage: { setItem: (key, value) => storage.set(key, value) },
    window: { name: '' },
    location: { origin: page.origin, replace: target => { destination = new URL(target, page); } },
    console, URL, URLSearchParams
  };
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    vm.runInNewContext(script[1], context, { filename: name, timeout: 1000 });
  }
  if (!name.includes('partner-fixture')) {
    assert(destination, `${name} must redirect to a public page`);
    assert.equal(destination.origin, page.origin);
    assert(['booking.html', 'multicity-visualizer.html'].includes(destination.pathname.slice(1)), name);
    assert(fs.existsSync(frontendSourcePath(frontend, destination.pathname.slice(1))), destination.href);
    assert(storage.size > 0 || context.window.name.startsWith('globevoy.trip.handoff.v1:'), `${name} must seed isolated browser state`);
    redirects++;
  }
  for (const localLink of html.matchAll(/location\.origin\s*\+\s*['"]([^'"]+)['"]/g)) {
    assert(fs.existsSync(frontendSourcePath(frontend, localLink[1].replace(/^\//, ''))), `${name}: ${localLink[1]}`);
  }
}
console.log(`PASS ${redirects} browser fixture redirects and local partner paths resolve after relocation.`);
