# Fix 10 — Payment operation claim safety

## Change
- A pre-existing CREATE_INTENT operation is never reset to RUNNING and blindly called again.
- SUCCEEDED operations must have a gateway reference and matching persisted payment row; missing data now fails closed for reconciliation.
- A first attempt is inserted once under the booking row lock. Concurrent requests serialize on that lock; the second sees the existing operation and returns pending/existing rather than calling the provider.
- Currency is normalized to uppercase before provider invocation.

## Important limitation
This is a source-level safety repair. The provider adapter must honor the stable idempotency key, and a reconciliation worker/API must resolve UNKNOWN outcomes. No successful typecheck, test, or PostgreSQL run is claimed in this package.
