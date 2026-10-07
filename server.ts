import express from 'express';
import { Pool } from 'pg';
import { timingSafeEqual } from 'node:crypto';
import { Database } from './infrastructure/database';
import { Outbox } from './application/outbox';
import { Audit } from './application/audit';
import { Saga } from './application/saga';
import { MockSupplyAdapter } from './infrastructure/adapters/mock-supply-adapter';
import { MockPaymentAdapter } from './infrastructure/adapters/mock-payment-adapter';
import { SseGateway } from './infrastructure/sse-gateway';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must be configured');
const internalToken = process.env.INTERNAL_API_TOKEN;
if (!internalToken || Buffer.byteLength(internalToken) < 32) {
  throw new Error('INTERNAL_API_TOKEN must be configured with at least 32 bytes');
}

if (process.env.NODE_ENV === 'production') throw new Error('Mock supplier/payment adapters are development-only; configure real provider adapters before production');
const pool = new Pool({ connectionString: databaseUrl });
const db = new Database(pool);
const outbox = new Outbox();
const audit = new Audit();
const sse = new SseGateway(db);
const saga = new Saga(db, new MockSupplyAdapter(), new MockPaymentAdapter(), outbox, audit);
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb', verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = Buffer.from(buf); } }));
app.get('/health', (_req: any, res: any) => res.json({ ok: true, service: 'ei-core-vs01', version: '1.2.1-fix17' }));
app.get('/ready', async (_req: any, res: any) => {
  try { await db.query('SELECT 1'); res.json({ ok: true, database: 'ready' }); }
  catch { res.status(503).json({ ok: false, database: 'unavailable' }); }
});

function constantTimeTokenMatch(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(internalToken!);
  return a.length === b.length && timingSafeEqual(a, b);
}
app.use((req: any, res: any, next: any) => {
  if (req.path === '/health' || req.path === '/ready') return next();
  const header = String(req.header('Authorization') ?? '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !constantTimeTokenMatch(match[1])) return res.status(401).json({ error: 'UNAUTHORIZED' });
  next();
});

app.post('/api/v1/bookings/hold', async (req: any, res: any, next: any) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || !Array.isArray(body.components)) return res.status(400).json({ error: 'INVALID_REQUEST' });
    const id = await saga.createBooking({ ...body, totalAmountMinor: BigInt(body.totalAmountMinor), supplierCostMinor: BigInt(body.supplierCostMinor), idempotencyKey: req.header('Idempotency-Key') ?? body.idempotencyKey });
    await saga.requestHolds(id);
    res.status(201).json({ bookingId: id });
  } catch (e) { next(e); }
});
app.post('/api/v1/checkouts/:bookingId/payment', async (req: any, res: any, next: any) => {
  try { res.json(await saga.createPayment(req.params.bookingId, req.header('Idempotency-Key') ?? req.body?.idempotencyKey)); }
  catch (e) { next(e); }
});
app.post('/api/v1/payments/webhook/:bookingId', async (req: any, res: any, next: any) => {
  try { await saga.handlePaymentWebhook(req.params.bookingId, req.rawBody?.toString('utf8') ?? '', req.header('X-Signature') ?? ''); res.sendStatus(204); }
  catch (e) { next(e); }
});
app.get('/api/v1/bookings/:bookingId/status', async (req: any, res: any, next: any) => {
  try {
    const b = (await db.query('SELECT * FROM bookings WHERE id=$1', [req.params.bookingId])).rows[0];
    if (!b) return res.status(404).json({ error: 'ERR_NOT_FOUND' });
    const c = (await db.query('SELECT * FROM booking_components WHERE booking_id=$1', [req.params.bookingId])).rows;
    res.json({ booking: b, components: c });
  } catch (e) { next(e); }
});
app.get('/api/v1/bookings/:bookingId/stream', async (req: any, res: any, next: any) => {
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const rawLast = String(req.header('Last-Event-ID') ?? req.query.lastEventId ?? '0');
    if (!/^\d+$/.test(rawLast)) return res.status(400).json({ error: 'INVALID_LAST_EVENT_ID' });
    let last = Number(rawLast);
    if (!Number.isSafeInteger(last)) return res.status(400).json({ error: 'INVALID_LAST_EVENT_ID' });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const pump = async () => {
      if (res.writableEnded || res.destroyed) return;
      try {
        const events = await sse.replay(req.params.bookingId, last);
        for (const e of events) {
          const seq = Number(e.stream_seq);
          if (!Number.isSafeInteger(seq) || seq <= last) continue;
          res.write(`id: ${seq}\nevent: ${e.event_type}\ndata: ${JSON.stringify(e.payload)}\n\n`);
          last = seq;
        }
        if (events.length === 0) res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch { res.write('event: stream-error\ndata: {"error":"TEMPORARY_UNAVAILABLE"}\n\n'); }
    };
    await pump();
    timer = setInterval(() => { void pump(); }, 3000);
    req.on('close', () => { if (timer) clearInterval(timer); });
  } catch (e) { if (timer) clearInterval(timer); if (!res.headersSent) next(e); else res.end(); }
});

app.use((e: any, _req: any, res: any, _next: any) => {
  const status = Number.isInteger(e?.statusCode) && e.statusCode >= 400 && e.statusCode <= 599 ? e.statusCode : 500;
  const code = typeof e?.code === 'string' ? e.code : 'INTERNAL_ERROR';
  res.status(status).json({ error: code, message: status >= 500 ? 'An internal error occurred' : String(e?.message ?? 'Request failed') });
});

const server = app.listen(Number(process.env.PORT ?? 3000), () => console.log('EI-CORE listening'));
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`EI-CORE received ${signal}; shutting down`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  server.close(async () => {
    try { await db.close(); clearTimeout(force); process.exit(0); }
    catch { process.exit(1); }
  });
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
