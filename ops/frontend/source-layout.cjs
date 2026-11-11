'use strict';
const fs = require('node:fs');
const path = require('node:path');
const repository = path.resolve(__dirname, '../..');
const layout = require('./page-layout.json');
const publicNames = new Set(layout.publicPageSources.map(item => path.basename(item.to)));

// Source locations and published URLs are deliberately separate. HTML bytes,
// relative links, callback paths and shell depths describe the published layout.
function frontendSourcePath(frontendRoot, ...parts) {
  const relative = path.join(...parts);
  return path.join(frontendRoot, publicNames.has(relative) ? 'pages' : '', relative);
}

function copyFrontendSource(output) {
  const frontend = path.join(repository, 'frontend');
  const expected = [...publicNames, ...layout.retainedLegacyPages].sort();
  const actual = fs.readdirSync(path.join(frontend, 'pages')).filter(name => name.endsWith('.html')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Page inventory differs from page-layout.json');
  if (fs.readdirSync(frontend).some(name => name.endsWith('.html'))) throw Error('HTML source belongs in frontend/pages/');
  for (const name of ['assets', 'runtime', 'scripts', 'styles', 'favicon.ico']) {
    fs.cpSync(path.join(frontend, name), path.join(output, name), {
      recursive: true, filter: file => !file.endsWith('.d.ts')
    });
  }
  for (const item of layout.publicPageSources) {
    fs.copyFileSync(path.join(repository, item.to), path.join(output, path.basename(item.to)));
  }
  fs.mkdirSync(path.join(output, 'pages'), { recursive: true });
  for (const name of layout.retainedLegacyPages) {
    fs.copyFileSync(path.join(frontend, 'pages', name), path.join(output, 'pages', name));
  }
}

module.exports = { frontendSourcePath, copyFrontendSource };
