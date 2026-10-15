const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
function option(name, fallback) { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; }
const schema = option('--schema', 'math2_daily_test');
const execute = args.includes('--execute');
const dryRun = args.includes('--dry-run') || !execute;
const root = path.resolve(__dirname, '..');
const output = path.resolve(option('--out', path.join(root, 'work', `practice-migration-${schema}.sql`)));
if (!['math2_daily_test', 'math2_private'].includes(schema)) throw Error('Use --schema math2_daily_test or math2_private');
if (schema === 'math2_private' && execute && !args.includes('--allow-production')) throw Error('Production execution requires --allow-production');
if (execute && dryRun) throw Error('Use either --execute or --dry-run');
if (execute && !option('--env')) throw Error('Execution requires --env');

let source = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8').replaceAll('math2_private', schema).trim();
source = source.replace(/^BEGIN\s*;/i, '').replace(/COMMIT\s*;\s*$/i, '');
const statements = [];
let start = 0, quote = false, dollar = null, comment = false;
for (let i = 0; i < source.length; i++) {
  const char = source[i];
  if (comment) { if (char === '\n') comment = false; continue; }
  if (dollar) { if (source.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null; } continue; }
  if (quote) { if (char === "'" && source[i + 1] === "'") { i++; continue; } if (char === "'") quote = false; continue; }
  if (char === '-' && source[i + 1] === '-') { comment = true; i++; continue; }
  if (char === "'") { quote = true; continue; }
  if (char === '$') { const match = source.slice(i).match(/^\$[A-Za-z0-9_]*\$/); if (match) { dollar = match[0]; i += dollar.length - 1; continue; } }
  if (char === ';') { const statement = source.slice(start, i).trim(); if (statement) statements.push(statement); start = i + 1; }
}
if (source.slice(start).trim() || quote || dollar) throw Error('Invalid schema SQL boundaries');
const body = statements.map((sql, i) => {
  const delimiter = `$statement_${i}$`;
  if (sql.includes(delimiter)) throw Error('SQL delimiter collision');
  return `EXECUTE ${delimiter}${sql}${delimiter};`;
}).join('\n');
const sql = `DO $migration$ BEGIN\n${body}\nEND $migration$;\n`;
if (schema !== 'math2_private' && sql.includes('math2_private')) throw Error('Test SQL contains production schema reference');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, sql);
process.stdout.write(JSON.stringify({ schema, statements: statements.length, bytes: Buffer.byteLength(sql), output, mode: execute ? 'execute' : 'dry-run' }) + '\n');
if (execute) {
  const cli = path.join(root, 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb');
  const result = spawnSync(process.execPath, [cli, 'db', 'execute', '-e', option('--env'), '--sql', sql, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status || 0;
}
