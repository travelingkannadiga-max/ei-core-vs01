# Fix 8 repair note

## Change
When any component hold fails, `runHolds` now invokes compensation after recording `HOLD_FAILED`. This releases sibling components that were already held instead of leaving inventory stranded.

## Important limits
This is a source-level repair only. It does not make compensation fully crash-safe: cancellation operations should be claimed and persisted before supplier calls, and a worker must resume pending cancellation operations after restart. Payment webhook amount/currency/event deduplication also remains incomplete because the current adapter event contract does not carry those fields. Do not use live payment or supplier credentials until these are implemented and tested.

## Validation
No successful typecheck, automated tests, build, or PostgreSQL integration run is claimed in this environment.
