<!-- Device-check record. Condensed by mdpro-delegator from dtrack's report on the Mac mini (~/.mdpro-redesign/dtrack/reports/report-20261016-v035-candidate.md), triaged by mdpro-a3. Brief: ~/.mdpro-redesign/stage-3/brief-v035-candidate.md (not in the repo). -->

# v0.3.5 candidate, macOS: S2, D249, D250 (with D244 O1–O3) and D246 on build `3315eb3` (2026-10-16)

Recorded by mdpro-delegator. **Verdict: no FAIL, no UNEXPECTED, nothing skipped.** Every
v0.3.5 code item that had not yet been checked on a Mac device passes here. One new defect
is registered: [D253](../plans/20260912-frontend-backend-sequencing-order.md#d253).

## Setup

| Item | Value |
|---|---|
| Machine | Mac mini, dtrack, 1920×1080 @1x, input source ABC, screen unlocked, `caffeinate -d` for the whole run |
| Build | build-only release run 38830353983 of `3315eb3effdbd993f33047039f3ea6f5da4949c7`. `tauri-app` sha256 `490b53b70709a5d755d3e03b329fe406f3a0e6085ba0c2b1618412c3df8ae717`. releaseId `0.3.4@3315eb3e…` on all 8 cold launches |
| Run | 2026-10-16 09:28–09:39 +0800. One light pass, then one dark pass. Scratch under `~/mdpro-s3-scratch/v035/` (images under dot-dirs never paint) |

## Results

| Cell | Item | Light | Dark | Verdict |
|---|---|---|---|---|
| 1 | STOP 3 S2, code fill ([ADR-0110](../adr/0110-code-surfaces-take-the-neutral-derived-background.md)) | inline and block `#f1f1f1` on editor `#ffffff` | `#1c1e22` on `#0f1115` | **PASS** |
| 2 | extchange-deleted card (= D246 light sample 1) | deleted prompt, Stage 3 card styling | — | **EXPECTED**; D246 PASS |
| 3 | [D249](../plans/20260912-frontend-backend-sequencing-order.md#d249) muted code | quote and h6 code `#636976`, 4.88:1; linked code `#2563eb`, 4.58:1, underlined | `#a1abb8` 7.18:1; links `#60a5fa` 6.56:1 | **PASS** (dark is the control) |
| 4a | [D250](../plans/20260912-frontend-backend-sequencing-order.md#d250) MCP toggles | 2 px `#2563eb` ring, 2 px gap, one toggle per Tab stop | 2 px `#60a5fa`, same geometry | **PASS**; D244 O1 FIXED |
| 4b | D250 image menu: Custom… input and Apply | border `#2563eb` + halo `#e0e9fc`, no WebKit ring; Apply `#2563eb`, white text | border `#60a5fa` + halo `#253751`; Apply `#1d4ed8`, white text | **PASS**; D244 O2 and O3 FIXED |
| 5 | [D246](../plans/20260912-frontend-backend-sequencing-order.md#d246) `rm` of an open clean file | 5 of 5 "deleted" | 5 of 5 "deleted" | **PASS**. The new route (a trailing modify on the gone path) was reached in 8 of 10 samples, and none emitted `modified` |

Every control was reached by Tab. No Esc was pressed, so nothing is NOT EXERCISED.

## Observations

- **A1, by design.** In dark, a checked toggle's track and its D250 ring are both `#60a5fa`, told
  apart by the 2 px gap. This is rule 33 pattern 2 as written, the same as every light primary
  button (a3's triage; audit b172 had no finding).
- **A2 → [D253](../plans/20260912-frontend-backend-sequencing-order.md#d253).** ⌘W on the only tab
  of a secondary window leaves an empty window. Each D246 sample opened its file from outside
  mdpro, which routes to a new window, so the run ended with four. Quits were clean
  (`dirtyCount 0`), and the drafts folder was empty.

## Not covered

The Windows halves of D246, D249 and D250, and the release-candidate regression on the
locked SHA, are separate runs under the
[0.3.5 gate](../plans/20260912-frontend-backend-sequencing-order.md#release-035-gate).
