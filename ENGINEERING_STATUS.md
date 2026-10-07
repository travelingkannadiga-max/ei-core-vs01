# EI-CORE VS01 — Fix 15 Release Candidate Status

This is the current authoritative status record. Earlier repair notes are historical only.

## Implemented
- SHA-256 fingerprint for normalized booking requests and component sets; a reused key with different data is rejected.
- Idempotent initial schema (`IF NOT EXISTS`) and a transactional migration runner with a schema-migration ledger.
- Fail-closed startup checks for `DATABASE_URL` and a 32-byte-minimum `INTERNAL_API_TOKEN`.
- Constant-time internal bearer token comparison, 1 MiB JSON limit, database readiness probe, and safe internal error responses.
- Payment webhook requires internal bearer auth and adapter signature verification; mock webhook adapter rejects absent/invalid configured signature.
- Server refuses `NODE_ENV=production` while mock supplier/payment adapters are wired.
- SSE replay polling, heartbeats, replay-ID validation, and disconnect cleanup.
- Graceful shutdown of HTTP server and database pool.
- Correct PostgreSQL `LIMIT ... FOR UPDATE SKIP LOCKED` clause ordering in outbox and supplier verification workers.
- Cancellation verification/reconciliation path for ambiguous supplier cancellation outcomes.

## Checks executed successfully
- Strict TypeScript source check using temporary ambient declarations for external packages unavailable in the runner: PASS.
- TypeScript transpilation + generated JavaScript parsing: 15/15 PASS.
- Booking/payment/refund domain checks: 9/9 PASS.
- Booking idempotency behavior smoke checks: 4/4 PASS.
- Supplier cancellation reconciliation smoke test: PASS.
- Mock webhook signature behavior: PASS.
- ZIP integrity: verified at packaging time.

## Blocked / not certified
- `npm install`: timed out in this environment.
- Standard `npm run build`: blocked because project dependencies and their type packages are unavailable.
- Jest: NOT RUN; Jest package unavailable.
- PostgreSQL migration and integration/concurrency tests: NOT RUN; Docker and `psql` are unavailable.
- Real payment/supplier provider tests: NOT RUN; server currently wires mock adapters.

## Release decision
**HOLD for production.** This candidate has passed available static/domain/mock checks but is not production-certified. Require real dependency-backed CI, PostgreSQL migration/concurrency/webhook tests, and real provider-adapter contract tests before production use.
