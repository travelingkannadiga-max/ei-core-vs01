# EI-CORE VS01 Fix 15 — Final Engineering Audit

## Changes made
1. Added SHA-256 request fingerprinting over trip/proposal/quote identifiers, quote version and expiry, authoritative total/currency/supplier cost/pricing source, and normalized sorted component data. A reused booking idempotency key with different data raises `ERR_IDEMPOTENCY_CONFLICT`.
2. Made initial schema table/index creation idempotent and added a transactional migration ledger so the initial migration is skipped after successful application.
3. Added fail-closed startup checks for `DATABASE_URL` and a high-entropy `INTERNAL_API_TOKEN`; internal routes use constant-time token comparison.
4. Added 1 MiB JSON request limit, separate readiness endpoint, and sanitized unexpected 500 errors.
5. Required both internal bearer authentication and payment adapter signature verification on webhook requests. The mock adapter rejects missing/incorrect `MOCK_WEBHOOK_SIGNATURE`.
6. Prevented production startup while mock supplier/payment adapters are wired.
7. Added SSE replay polling/heartbeats/cleanup and graceful shutdown.
8. Corrected PostgreSQL row-lock query clause ordering and added a dedicated reconciliation path for ambiguous supplier cancellations.
9. Validated quote expiry dates and corrected a strict query-result type annotation.

## Test evidence
- Strict TypeScript check with temporary declarations for unavailable external modules: PASS.
- Transpilation and JavaScript syntax: 15/15 PASS.
- Domain tests: 9/9 PASS.
- Booking fingerprint smoke tests: 4/4 PASS.
- Supplier cancellation reconciliation: PASS.
- Mock webhook signature behavior: PASS.
- Archive integrity: PASS after packaging.

## Explicit limitations
The ordinary project build/test commands cannot complete because `npm install` timed out. `npm run build` reports missing `pg`, `express`, and Node type packages; `npm test` cannot find Jest. This runner has neither Docker nor `psql`, so the SQL migration, actual PostgreSQL locking semantics, integration, and concurrency behavior have not been executed. No real supplier/payment APIs were called; the server uses mock adapters and refuses to start when `NODE_ENV=production`.

## Release verdict
**HOLD for production.** This is a hardened release candidate. Production certification requires dependency-backed CI, PostgreSQL migration and integration tests, concurrency/idempotency tests, webhook-signature tests, and contract tests for real supplier/payment adapters.
