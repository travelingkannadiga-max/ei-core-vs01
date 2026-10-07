# Fix 11 — Release reliability audit repairs

## Repaired defects
1. Persist `booking_components.currency` using the authoritative booking currency.
2. Normalize/validate booking currency to ISO-4217-style 3-letter uppercase.
3. Correct payment flow: provider intent creation lands the booking in `PAYMENT_PENDING`; authorization/capture then advances the state machine safely.
4. Add missing `PAYMENT_PENDING -> BOOKING_PROCESSING` and `PAYMENT_AUTHORIZED -> BOOKING_PROCESSING` transitions.
5. Preserve the raw webhook body before JSON parsing so production adapters can verify signatures against the exact payload.
6. Fix PostgreSQL-invalid `FOR UPDATE` usage on an aggregate in SSE sequence allocation; serialize sequence allocation through the booking row lock.
7. Add durable outbox `processing_at` timestamps and recovery of stale `PROCESSING` events.
8. Make supplier verification atomically claim work and recover `VERIFY_REQUESTED` operations after worker crashes.
9. When supplier verification proves a commit, re-evaluate the aggregate and confirm the booking when all components are committed.
10. When supplier verification proves a paid booking was not committed, escalate to HITL rather than silently treating the booking as complete.
11. Make compensation cancellation operations durable/idempotent through `supplier_operations`.
12. Avoid incorrectly moving unpaid hold-failure compensation directly to `REFUND_PENDING`; use `BOOKING_FAILED` unless payment was captured.
13. Add rollback cleanup for `payment_webhook_events`.
14. Expand domain transition tests for the corrected payment flow.

## Verification performed
- All TypeScript source files passed a syntax/transpile pass with TypeScript 5.8.3.
- Eight independent domain state-machine flow assertions passed.
- Structural checks confirmed the key persistence, payment, webhook, and cancellation changes.
- ZIP/source inspection passed.

## Runtime verification limitation
`npm install` could not complete in this environment, so `node_modules` is unavailable. Consequently the real Jest suite, dependency-backed TypeScript typecheck, and PostgreSQL integration tests are **not claimed as passing**. `npm run typecheck` is blocked by missing installed modules/types; `npm test` is blocked because Jest is not installed.

## Release decision
**HOLD — improved but not production-verified.** Do not use live supplier/payment credentials or accept real bookings until dependencies can be installed and the full Jest/typecheck/PostgreSQL test suite is executed.
