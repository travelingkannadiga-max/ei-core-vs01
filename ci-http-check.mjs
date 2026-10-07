import process from 'node:process';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
async function expect(path, status) {
  const r = await fetch(`${base}${path}`);
  if (r.status !== status) throw new Error(`${path}: expected ${status}, got ${r.status}`);
}
await expect('/health', 200);
await expect('/ready', 200);
await expect('/api/v1/bookings/nope/status', 401);
process.stdout.write('HTTP health/readiness/auth verification passed\n');
