'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Keep fresh test output separate from the versioned historical evidence.
module.exports = function outputPath(filename) {
  const directory = path.resolve(__dirname, '../../.cache/validation/frontend');
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, path.basename(filename));
};
