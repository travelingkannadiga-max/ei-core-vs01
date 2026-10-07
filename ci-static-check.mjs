import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.version !== '1.2.1-fix17') throw new Error(`unexpected package version: ${pkg.version}`);
const up = fs.readFileSync('migrations/0001_initial_schema.up.sql', 'utf8');
const down = fs.readFileSync('migrations/0001_initial_schema.down.sql', 'utf8');
if (!/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(up)) throw new Error('schema_migrations table is not created');
if (!/INSERT INTO schema_migrations\(version\) VALUES\('0001_initial_schema'\)/i.test(up)) throw new Error('migration marker is not recorded');
if (!/DROP TABLE IF EXISTS schema_migrations/i.test(down)) throw new Error('schema_migrations table is not removed on DOWN');
for (const f of ['src/server.ts','dist/server.js']) {
  const s = fs.readFileSync(f, 'utf8');
  if (!s.includes('1.2.1-fix17')) throw new Error(`${f} has stale release version`);
}
console.log('static release invariants passed');
