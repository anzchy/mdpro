# Journey registry

Every `EJ-NNN` id ever issued, in issue order, retired ones included. Ids are
never reused, rows are never removed, and every id here keeps its journey
file. `pnpm journeys:check` enforces this against the base commit
([ADR-0103](../../docs/adr/0103-the-e2e-journey-catalogue-is-the-single-source-for-device-checks.md)).

The next id is the row after the last one. Add the row in the commit that
adds the journey file.

| id | title |
|---|---|
| EJ-001 | Cold start opens the file given on the command line |
