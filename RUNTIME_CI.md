# EI-CORE Runtime CI Gate

This repository does not claim runtime certification from static inspection.

A green runtime certificate is emitted only by `.github/workflows/runtime-ci.yml` after:

1. npm dependency installation succeeds;
2. a lockfile exists and `npm ci` succeeds;
3. TypeScript typecheck succeeds;
4. Jest unit tests succeed;
5. production build succeeds;
6. PostgreSQL 17 starts healthy;
7. migrations apply;
8. migration schema verification and DOWN/UP verification succeed;
9. the HTTP server starts and reaches readiness;
10. health, readiness, and authentication checks succeed.

The certificate is deliberately CI-generated and tied to the commit SHA.
