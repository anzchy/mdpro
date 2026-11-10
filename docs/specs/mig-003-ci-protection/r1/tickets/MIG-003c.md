## Parent

#700 (MIG-003 row). Spec: #752 (r1). Decisions MIG003-r1-D6, D11, D12, D13, D23. **ADR flag**: the grant needs the dependency ADR accepted (draft `adr-draft-webkit-test-dependency.md`, unnumbered, Proposed; the delegator reserves the number).

## What to build

The MIG-001 corpus runs in real WebKit, against the same committed baselines, nightly and on dispatch.

- **Spike (first cycle)**: one category-a corpus runner passes in WebKit through Vitest browser mode (Playwright provider, `webkit`), with its Tauri-boundary mocks. If the mocks or a jsdom-only API cannot run there, stop for the delegator before anything else is written.
- **Dependencies**: `@vitest/browser` at the repo's Vitest range and `playwright` at an exact version, both devDependencies. The browser is installed in CI only (`playwright install --with-deps webkit`).
- **WebKit Vitest config**: selects `tests/corpus-{a,d,g,l}-*.any.test.tsx` and writes a JSON report. The runners are not edited.
- **Verdict**: each case is compared with its committed baseline; a mismatch is red. No WebKit baseline file.
- **Vacuous checker**: non-zero unless the JSON report holds at least one passed case.
- **`webkit-advisory.yml`**: `ubuntu-latest`; `schedule` `7 4 * * *` and `workflow_dispatch` with no inputs; `contents: read`; per-ref concurrency, never cancelling; uploads the report as an artifact.

## Acceptance criteria

- [ ] The spike's result is in the handoff: the runner name and its pass in WebKit, or the stop.
- [ ] A test pins the config's selection: today it matches only the category-a runners, and a file named for category b, c or e does not match.
- [ ] The checker's cases: one passed case (exit 0); zero cases (non-zero); every case failed (non-zero); a missing or malformed report (non-zero).
- [ ] A workflow test pins the triggers, permissions, concurrency, runner and the CI-only browser install; no `pull_request` or `v*` trigger.
- [ ] `pnpm install` on a clean checkout installs no browser.
- [ ] The confirm record holds a dispatch run at the handoff SHA: green, or red with each mismatch listed for the delegator's triage.
- [ ] Nothing claims to replace the macOS WKWebView device card (ADR-0144).
- [ ] Size: about 80 counted production lines (`package.json`, the lockfile and the workflow are not counted).

## Blocked by

- #753 (MIG-003a)

## Citations (master `ddc60447`)

| Cited | Path and name | Exists | Quoted |
|---|---|---|---|
| corpus boundary | `docs/specs/mig-001-golden-corpus/r5/spec.md` § Engine driver | yes | "It replaces only the Tauri boundary: the API modules and the native opener." |
| category a runner | `tests/corpus-a-empty-paragraphs.any.test.tsx` | yes | file exists |
| Vitest | `package.json` | yes | `"vitest": "~3.2.7"` |
| ADR scope | `CLAUDE.md` § Architecture Decision Records | yes | "a dependency" |
| off the PR run | `.agents/skills/mdpro-delegator/references/landing-and-audit.md` § PR CI | yes | "the native platform lanes and the real-WebKit lane, which run on `schedule` and `workflow_dispatch` only (MIG-003)." |
