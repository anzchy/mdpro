# Manual test fixtures

<!-- moved-from: CLAUDE.md § Manual test fixtures (ADR-0147) -->
Markdown documents for device checks (`/macos-device-test`, `/gui-manual-verify`)
live in **`tests/manual-fixtures/`**, named `<id>-<slug>.md`, e.g.
`d41-source-tab.md`. Not in a session scratchpad, where they vanish, and not in
`tests/fixtures/`, which holds the unit tests' contract JSON. Vitest only
collects `*.test.{ts,tsx}`, so nothing here runs.

- **Run on a copy.** Copy the fixture to the scratchpad and open the copy. A
  run edits the document, ⌘S writes it and a draft can outlive the run, so the
  committed original must stay pristine.
- Large generated fixtures (multi-MB) are not committed. Commit the generator
  script instead.
