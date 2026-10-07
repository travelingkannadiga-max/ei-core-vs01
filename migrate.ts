import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be configured');
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const version = '0001_initial_schema';
    const applied = await client.query('SELECT version FROM schema_migrations WHERE version=$1', [version]);
    if (applied.rowCount) {
      await client.query('COMMIT');
      process.stdout.write(`migration ${version} already applied\n`);
      return;
    }
    const sql = fs.readFileSync(path.join(process.cwd(), 'migrations/0001_initial_schema.up.sql'), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    await client.query('COMMIT');
    process.stdout.write(`migration ${version} complete\n`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original migration error */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error('Migration failed'); console.error(e); process.exitCode = 1; });
