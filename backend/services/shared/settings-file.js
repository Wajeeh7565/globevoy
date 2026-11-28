'use strict';
// Lambda allows only 4 KB of settings in total. Non-secret behaviour settings can live in
// backend/config/lambda-settings.json, which ships inside the code package (and so in Git).
// A setting present in the Lambda configuration always wins, so any value can still be
// overridden, or switched off, from the console without a new package.
// Secrets never go in this file: names that look like keys, tokens or passwords are refused.
const fs = require('node:fs');
const path = require('node:path');

const SECRET = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE)/i;
const NAME = /^[A-Z][A-Z0-9_]{1,80}$/;

function load(file = path.join(__dirname, '../../config/lambda-settings.json')) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return {}; }
  const data = JSON.parse(raw);
  const settings = data && data.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('lambda-settings.json: "settings" must be an object');
  for (const [k, v] of Object.entries(settings)) {
    if (!NAME.test(k)) throw Error('lambda-settings.json: bad name ' + k);
    if (SECRET.test(k)) throw Error('lambda-settings.json: secrets are not allowed here (' + k + ')');
    if (typeof v !== 'string') throw Error('lambda-settings.json: ' + k + ' must be a string');
  }
  return settings;
}

/** Copy file settings into process.env where the Lambda configuration has no value. */
function apply(env = process.env, file) {
  const settings = load(file), applied = [];
  for (const [k, v] of Object.entries(settings)) if (env[k] === undefined) { env[k] = v; applied.push(k); }
  return applied;
}

module.exports = { load, apply, SECRET };
