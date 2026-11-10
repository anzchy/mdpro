## Parent

#700 (MIG-003 row). Spec: #752 (r2). Decisions MIG003-r1-D6, D11, D12, D23; MIG003-r2-D25–D28; r2 fixes MH1, MH2, MM1, MM7. **ADR flag**: the grant needs the dependency ADR accepted (draft `adr-draft-webkit-test-dependency.md`, unnumbered, Proposed; the delegator reserves the number).

## What to build

The MIG-001 corpus runs in real WebKit against the same committed baselines, nightly and on dispatch. It lands on static evidence; its first runs are the delegator's bootstrap after landing.

- **Spike (first cycle)**: one category-a case passes in WebKit through Vitest browser mode (Playwright provider, `webkit`) with its Tauri-boundary mocks, after c0. If a shared module still cannot run there, stop for the delegator before anything else is written.
- **Dependencies**: `@vitest/browser` at the repo's Vitest range and `playwright` at an exact version, both devDependencies. The browser is installed in CI only (`playwright install --with-deps webkit`).
- **Config**: `vitest.webkit.config.ts` at the repo root, including only `tests/webkit/**/*.webkit.tsx`, writing a JSON report.
- **Entry**: one browser entry under `tests/webkit/` loads the manifests, fixtures and baselines of categories a, d, g and l with Vite raw imports and runs each case through the unchanged driver and comparator. A category joins when its manifest lands. The six `corpus-a-driver-*` tests are out.
- **Accepted mismatches**: a committed list, empty at landing. Each entry holds the case-id, the exact observed WebKit output for the differing part, an issue number and a reason. The run fails on an unlisted mismatch, a listed mismatch whose observed output changed, a listed case that now matches, and any other error.
- **Artifact**: actual outputs for every case, and the WebKit, Playwright and Vitest versions.
- **Checker**: non-zero unless the JSON report holds at least one passed case.
- **`webkit-advisory.yml`**: `ubuntu-latest`; `timeout-minutes: 20`; `schedule` `7 4 * * *` and `workflow_dispatch` with no inputs; `contents: read`; per-ref concurrency, never cancelling.
- **Pin edit** (spec § Pins; no other): `gh639-frontend-shard-shape` › "leaves vitest.config.ts byte-identical, adds no vitest config, and overrides thresholds only on the shard run" expects the base root-config set plus exactly `vitest.webkit.config.ts`.
- **Bootstrap (delegator, after the fast-forward)**: dispatch on master and record the run id, `head_sha`, conclusion and artifact. A red run → a follow-up issue with an owner and a target date, whose PR adds the user-approved accepted mismatches (or fixes the cause); the workflow stays enabled; the WebKit mapping of the handoff rule activates only after the first green master run.

## Acceptance criteria

- [ ] The spike's result is in the handoff: the case-id and its pass in WebKit, or the stop.
- [ ] A test pins the config: it includes exactly `tests/webkit/**/*.webkit.tsx`; the default `vitest.config.ts` lane does not pick up the entry, and the WebKit config picks up no `*.test.*` file.
- [ ] A test of the entry's discovery: with today's corpus it finds only category a's cases; a fixture manifest for d is found, one for b or e is not; no `corpus-a-driver-*` test is run.
- [ ] Accepted-mismatch cases: an unlisted mismatch fails; a listed mismatch with the same observed output passes; a listed mismatch with a different observed output fails; a listed case that now matches fails; a malformed entry or one without an issue number fails.
- [ ] The checker's cases: one passed case (exit 0); zero cases (non-zero); every case failed (non-zero); a missing or malformed report (non-zero).
- [ ] A workflow test pins the triggers, permissions, concurrency, runner, `timeout-minutes: 20`, the artifact upload and the CI-only browser install; no `pull_request`, `push` or `v*` trigger.
- [ ] `pnpm install` on a clean checkout installs no browser.
- [ ] The config-set pin edit is exactly as stated, and a mutation-RED case shows it still fails when a second extra root `vitest*.config.*` is added or `vitest.config.ts` changes. No other existing test is edited; any other one this change turns red stops the ticket for the delegator.
- [ ] Nothing claims to replace the macOS WKWebView device card (ADR-0144).
- [ ] The landing record (delegator) holds the bootstrap run: id, `head_sha`, conclusion, artifact; for a red run, each mismatch listed and the follow-up issue number, owner and target date.
- [ ] Size: about 80 counted production lines (`package.json`, the lockfile, the workflow and `tests/` are not counted).

## Blocked by

- #753 (MIG-003a)
- #759 (MIG-003c0)

## Citations (master `93c7e9bb`)

| Cited | Path and name | Exists | Quoted |
|---|---|---|---|
| config pin | `tests/tooling/gh639-frontend-shard-shape.test.ts` › "leaves vitest.config.ts byte-identical, adds no vitest config, and overrides thresholds only on the shard run" | yes | `expect(configs(fs.readdirSync(ROOT).join("\n"))).toEqual(configs(stdout))` |
| naming precedent | `vitest.perf.config.ts:16` | yes | `include: ["tests/perf/**/*.perf.ts"],` |
| default include | `vitest.config.ts:31` | yes | `include: ["tests/**/*.test.{ts,tsx}"],` |
| runner is Node-bound | `tests/corpus-a-empty-paragraphs.any.test.tsx:5–6` | yes | `await import('node:path')`; `await import('../scripts/corpus/core.ts')` |
| corpus boundary | `docs/specs/mig-001-golden-corpus/r5/spec.md` § Engine driver | yes | "It replaces only the Tauri boundary: the API modules and the native opener." |
| Vitest | `package.json` | yes | `"vitest": "~3.2.7"` |
| ADR scope | `CLAUDE.md:114–115` § Architecture Decision Records | yes | "a dependency" |
| off the PR run | `.agents/skills/mdpro-delegator/references/landing-and-audit.md` § PR CI | yes | "the native platform lanes and the real-WebKit lane, which run on `schedule` and `workflow_dispatch` only (MIG-003)." |
