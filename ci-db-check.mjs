import fs from 'node:fs';
import process from 'node:process';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be configured');

const client = new Client({ connectionString: url });
await client.connect();
try {
  const required = [
    'schema_migrations',    'trips','bookings','booking_components','supplier_operations',
    'payments','payment_operations','refunds','idempotency_records',
    'outbox_events','audit_logs','sse_events','payment_webhook_events'
  ];

  for (const table of required) {
    const r = await client.query(
      `SELECT to_regclass($1) AS name`, [`public.${table}`]
    );
    if (!r.rows[0].name) throw new Error(`missing table: ${table}`);
  }

  const migration = await client.query(
    `SELECT version FROM schema_migrations WHERE version=$1`,
    ['0001_initial_schema']
  );
  if (migration.rowCount !== 1) throw new Error('migration marker missing');

  const down = fs.readFileSync('migrations/0001_initial_schema.down.sql', 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(down);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }

  const gone = await client.query(`SELECT to_regclass($1) AS name`, ['public.bookings']);
  if (gone.rows[0].name) throw new Error('migration DOWN did not remove bookings');
} finally {
  await client.end();
}

process.stdout.write('DB migration UP/schema/DOWN verification passed\n');
