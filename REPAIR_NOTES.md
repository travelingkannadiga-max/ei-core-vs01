# Fix 5 engineering repair notes

Changes in this pass:
- Reject zero/negative customer totals and negative component costs.
- Require at least one booking component.
- Reconcile the sum of component net costs to the supplied supplier cost before persisting a booking.
- Use the typed IdempotencyConflictError for conflicting reuse of an idempotency key.

Verification limitation: npm install repeatedly timed out in the execution environment. Therefore typecheck, Jest, build, and PostgreSQL integration are NOT certified. This is a source-level patch, not a production release.

Critical open items from source review:
1. Payment intent creation is called before a durable operation claim; concurrent requests can create duplicate intents.
2. Webhook result contract lacks amount/currency and event id; amount matching and durable webhook dedupe are not enforceable here.
3. Partial inventory hold failure does not automatically compensate successful sibling holds.
4. Commit verification worker does not drive the saga to completion/compensation after resolving uncertainty.
5. SSE endpoint replays then ends; it is not a live stream, and append sequencing needs concurrency-safe allocation.
6. Workers are not started by server bootstrap; recovery/outbox behavior is not demonstrated.
7. API has no authentication/authorization and request schema validation.

## Fix 7 — durable payment intent claim
- `createPayment` now locks the booking and claims a unique CREATE_INTENT operation in PostgreSQL before provider I/O.
- Provider calls remain outside transactions.
- Retries return the persisted intent when operation succeeded; concurrent/in-flight/unknown operations are blocked for reconciliation rather than creating another intent.
- Provider-call errors are marked UNKNOWN because a timeout can occur after provider-side creation.
- Remaining: implement provider lookup/reconciliation for UNKNOWN intents; enrich signed webhook contract with amount/currency/provider event ID and enforce deduplication before capture. This is not production-ready until those are done and tests pass.
