import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sourceLayout from './source-layout.cjs';
import { readPageLayout, writeCompatibilityPages } from './page-layout.mjs';
import { writeClassicSeo } from './seo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(root, process.argv[2] || '.cache/frontend-preview');
if (output !== path.join(root, 'amplify-publish') && !output.startsWith(path.join(root, '.cache') + path.sep)) {
  throw Error('Output must be amplify-publish or a directory inside .cache/');
}
if (fs.existsSync(output) && fs.readdirSync(output).length) throw Error('Output must be empty; preserve previous builds');
fs.mkdirSync(output, {recursive:true});
sourceLayout.copyFrontendSource(output);
writeClassicSeo(output, readPageLayout().publicPageSources);
fs.cpSync(path.join(root, 'web/out'), path.join(output, 'react'), {recursive:true});
writeCompatibilityPages(output);
console.log('Composed classic and React website at ' + output + '. No deployment performed.');
