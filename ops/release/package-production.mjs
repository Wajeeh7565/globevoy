import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const key = process.env.GLOBEVOY_MAPS_BROWSER_KEY;
if (!key || !/^AIza[\w-]{35}$/.test(key)) throw Error('Set GLOBEVOY_MAPS_BROWSER_KEY to the restricted public browser key. Never use a server credential.');
const output = path.join(root, '.cache/production-site');
if (fs.existsSync(output)) throw Error('Output already exists. Preserve/rename .cache/production-site before rebuilding.');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim());
execFileSync(process.execPath, [path.join(root, 'web/node_modules/next/dist/bin/next'), 'build'], {cwd:path.join(root,'web'), stdio:'inherit'});
fs.mkdirSync(output, {recursive:true});
for (const entry of fs.readdirSync(path.join(root,'frontend'),{withFileTypes:true})) {
 if ((!entry.isDirectory() && /\.(html|ico)$/.test(entry.name)) || ['assets','pages','runtime','scripts','styles'].includes(entry.name)) {
  fs.cpSync(path.join(root,'frontend',entry.name),path.join(output,entry.name),{recursive:true,filter:p=>!p.endsWith('.d.ts')});
 }
}
fs.cpSync(path.join(root,'web/out'),path.join(output,'react'),{recursive:true});
const configPath=path.join(output,'runtime/config.js');
fs.writeFileSync(configPath,fs.readFileSync(configPath,'utf8').replace('YOUR_RESTRICTED_GOOGLE_MAPS_BROWSER_KEY',key));
for (const file of ['index.html','runtime/environment-policy.js','react/index.html','react/account/index.html','react/my-trips/index.html','react/journey/index.html']) {
 if (!fs.existsSync(path.join(output,file))) throw Error('Missing release file: '+file);
 if(file.startsWith('react/') && !fs.readFileSync(path.join(output,file),'utf8').includes('/react/_next/')) throw Error('Missing React asset prefix: '+file);
}
for (const excluded of ['validation','screenshots','.env','package.json']) if(fs.existsSync(path.join(output,excluded))) throw Error('Unexpected public content: '+excluded);
const files={};
for (const file of fs.readdirSync(output,{recursive:true}).sort()) {
 const full=path.join(output,file);
 if(fs.statSync(full).isFile()) files[file.replaceAll('\\','/')]=createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({commit,dirty,builtAt:new Date().toISOString(),productionAccounts:false,productionReact:false,files},null,2)+'\n');
console.log('Validated static artifact: '+output+' ('+Object.keys(files).length+' files). No deployment performed.');
