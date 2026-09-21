// Minimal dependency-free .env loader shared by build/sql/install/deploy scripts.
// Values already present in process.env win over the file, so CI/inline overrides work.
const fs = require('node:fs');
const path = require('node:path');

function parse(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

// Loads <root>/.env into process.env without overriding already-set variables.
function load(root = path.resolve(__dirname, '..')) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return { loaded: false, file };
  for (const [k, v] of Object.entries(parse(fs.readFileSync(file, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return { loaded: true, file };
}

// Returns the trimmed value of a required variable, or undefined when absent/blank.
function get(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

module.exports = { load, parse, get };
