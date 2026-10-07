# EI-CORE VS01 — Fix 14 Release Candidate

ORBIT / EI-SYN-01 transactional booking foundation for Bengaluru → Bali.

## Authority boundaries
AI orchestrates only through the Tool Gateway. EI-07 owns price. EI-08 owns inventory. Payment Authority owns payment. EI-CORE owns booking state.

## Safety invariants
- PostgreSQL is authoritative for EI-CORE state and durable operations.
- No external supplier/payment call occurs inside a PostgreSQL transaction.
- `UNKNOWN` is not treated as success or a final failure; it must be reconciled.
- Money is represented in integer minor units.
- Quote source must be `EI-07_REVENUE` and quote must be unexpired.
- Reused booking idempotency keys must match a SHA-256 fingerprint of the normalized request.
- Internal API endpoints require a high-entropy bearer token; payment webhooks additionally require adapter signature verification.
- Mock adapters are development-only. The server refuses to start with `NODE_ENV=production` while mock adapters are configured.

## Run locally
```bash
cp .env.example .env
# Replace INTERNAL_API_TOKEN with at least 32 random bytes before starting.
# Keep MOCK_WEBHOOK_SIGNATURE local-only; do not use mock adapters in production.
docker compose up -d postgres
npm install
npm run migrate
npm run typecheck
npm test
npm run build
npm run dev
```

## Release status
This is a **release candidate, not production-certified**. This runner can execute static/domain/mock smoke checks but does not have project dependencies, Jest, Docker, or PostgreSQL. See `ENGINEERING_STATUS.md` for the exact verification boundary. Real provider adapters and CI integration tests are required before production.
