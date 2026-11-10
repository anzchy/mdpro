## Parent

#700 (MIG-003 row). Spec: #752 (r3). Decisions MIG003-r1-D6, D11, D12, D23; MIG003-r2-D25–D28; MIG003-r3-D30, D31; r2 fixes MH1, MH2, MM1, MM7; r3 fixes H1, O-M2, O-M6, Lows 3 and 7. **ADR flag**: the grant needs the dependency ADR accepted (draft `adr-draft-webkit-test-dependency.md`, unnumbered, Proposed; the delegator reserves the number).

## What to build

The MIG-001 corpus runs in real WebKit against the same committed baselines, nightly and on dispatch. It lands on static evidence; its first runs are the delegator's bootstrap after landing.

- **Spike (first cycle)**: one category-a case passes in WebKit through Vitest browser mode (Playwright provider, `webkit`) with its Tauri-boundary mocks, after c0, run locally on macOS: `pnpm exec playwright install webkit`, then `pnpm exec vitest run --config vitest.webkit.config.ts` (Playwright's WebKit build; CI's ubuntu WebKit is first exercised at the bootstrap). If a shared module still cannot run there, stop for the delegator before anything else is written.
- **Dependencies**: `@vitest/browser` at the repo's Vitest range and `playwright` at an exact version, both devDependencies. The browser is installed in CI only (`playwright install --with-deps webkit`).
- **Config**: `vitest.webkit.config.ts` at the repo root, including only `tests/webkit/**/*.webkit.tsx`, writing a JSON report.
- **Entry**: one browser entry under `tests/webkit/` loads the manifests, fixtures and baselines of categories a, d, g and l with Vite raw imports and runs each case through the unchanged driver and comparator. A category joins when its manifest lands. The six `corpus-a-driver-*` tests are out.
- **Shared shard check** (MIG003-r3-D30): move the pure per-shard part of `scripts/corpus/core.ts` `loadCorpus` (JSON parse, array, canonical JSON, category matches shard) and its empty-corpus check into a new browser-safe module under `tests/support/corpus/`. `loadCorpus` keeps its signature and error messages and calls it; the entry calls it on the raw-imported shards. This `core.ts` edit is in MIG-001's area, approved by D30; the grant waits while an open MIG-001 ticket that edits `core.ts` is in flight.
- **Accepted mismatches** (MIG003-r3-D31): `tests/webkit/accepted-mismatches.json`, a canonical-JSON array, empty at landing. Each entry is `{caseId, actual: {untouched, serialized, observation}, issue, reason, approval: {quote, date}}`: `actual` is the full WebKit output of every field the comparator compares (`observation` omitted only when the case has none), and `approval.quote` is the user's words, verbatim. A listed case passes only when every compared field is byte-equal to its entry; any other difference, in any field, is unlisted. The run fails on an unlisted mismatch, a listed mismatch whose observed output changed, a listed case that now matches, and any other error.
- **Artifact**: actual outputs for every case, and the WebKit, Playwright and Vitest versions.
- **Checker**: non-zero unless the JSON report holds at least one passed case.
- **`webkit-advisory.yml`**: `ubuntu-latest`; `timeout-minutes: 20`; `schedule` `7 4 * * *` and `workflow_dispatch` with no inputs; `contents: read`; per-ref concurrency, never cancelling.
- **Pin edit** (spec § Pins; no other): `gh639-frontend-shard-shape` › "leaves vitest.config.ts byte-identical, adds no vitest config, and overrides thresholds only on the shard run" expects the base root-config set plus exactly `vitest.webkit.config.ts`.
- **Bootstrap (delegator, after the fast-forward)**: dispatch on master and record the run id, `head_sha`, conclusion and artifact. A red run → a follow-up issue with an owner and a target date, whose PR adds the user-approved accepted mismatches (or fixes the cause); the workflow stays enabled; the WebKit mapping of the handoff rule activates only after the first green master run.

## Acceptance criteria

- [ ] The spike's result is in the handoff: the case-id and its pass in WebKit, or the stop.
- [ ] A test pins the config: it includes exactly `tests/webkit/**/*.webkit.tsx`; the default `vitest.config.ts` lane does not pick up the entry, and the WebKit config picks up no `*.test.*` file.
- [ ] A test of the entry's discovery: it finds exactly the cases of the committed manifests among categories a, d, g and l, whichever have landed at the handoff SHA (the handoff names them); a fixture manifest for d is found, one for b or e is not; no `corpus-a-driver-*` test is run.
- [ ] Accepted-mismatch cases: an unlisted mismatch fails; a listed mismatch with every compared field byte-equal passes; a listed mismatch that differs in any one field (`untouched`, `serialized` or `observation`, one case each) fails; a listed case that now matches fails; a malformed entry, a non-canonical file, or an entry without an issue number, a reason or `approval.quote` fails.
- [ ] Shared shard check: the new module's cases cover each `loadCorpus` refusal (bad JSON, not an array, non-canonical, category ≠ shard, empty corpus) with the same message; the entry refuses a raw-imported shard through it; `loadCorpus` keeps its signature; the existing corpus suite passes unedited.
- [ ] The checker's cases: one passed case (exit 0); zero cases (non-zero); every case failed (non-zero); a missing or malformed report (non-zero).
- [ ] A workflow test pins the triggers, permissions, concurrency, runner, `timeout-minutes: 20`, the artifact upload and the CI-only browser install; no `pull_request`, `push` or `v*` trigger.
- [ ] `pnpm install` on a clean checkout installs no browser.
- [ ] The config-set pin edit is exactly as stated, and a mutation-RED case shows it still fails when a second extra root `vitest*.config.*` is added or `vitest.config.ts` changes. No other existing test is edited; any other one this change turns red stops the ticket for the delegator.
- [ ] Nothing claims to replace the macOS WKWebView device card (ADR-0144).
- [ ] Size: about 90 counted production lines (`package.json`, the lockfile, the workflow and `tests/` are not counted; the `core.ts` edit is counted).

## Post-landing obligations (delegator; not part of this ticket's acceptance verdict)

The handoff's self-acceptance table, the brief's AC map, the verifier, both auditors' `AC` lines and the ADR-0146 decision 4 pre-audit check do not list these (spec § Bootstrap). The issue closes only when they are recorded.

- [ ] The landing record (delegator) holds the bootstrap run: id, `head_sha`, conclusion, artifact; for a red run, each mismatch listed and the follow-up issue number, owner and target date.

## Blocked by

- #753 (MIG-003a)
- #759 (MIG-003c0)

## Citations (master `4dac35fb`)

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
| loadCorpus refusals | `scripts/corpus/core.ts:19, 24` | yes | ``if (source !== canonicalJson(records)) throw new Error(`${path}: canonical key order and formatting required`);`` / `if (!data.records.length) throw new Error('corpus is empty: no cases');` |
| compared fields | `tests/support/corpus/comparator.ts:9` | yes | `export interface ComparisonActual { untouched: string; serialized: string; observation?: Observations }` |
