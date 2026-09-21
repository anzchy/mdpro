/**
 * D6.3(c) / WI-4 + WI-5 — the `App.tsx` WYSIWYG large-document guardrail is a
 * THIN CALLER of `src/utils/largeDocumentGuard.ts`, and the frozen constants
 * have exactly one home each.
 *
 * ── SPEC LEVEL: EVERY CASE IN THIS FILE IS BELOW LEVEL 6 ────────────────────
 *
 * Every assertion here is SOURCE-TEXT INSPECTION. These cases read
 * `src/App.tsx` and `src/utils/largeDocumentGuard.ts` off disk as strings and
 * match them. Nothing here renders `App`, runs the effect, or observes
 * `showToast` / `setViewMode`.
 *
 * `policy-core` mandatory rule 1 ("every test must have at least one Level 1-5
 * assertion") is NOT met by this file, and was not met before this change. The
 * waiver is pre-existing (plan risk 8) and is restated here rather than
 * quietly dropped.
 *
 * What these cases CANNOT prove — enumerated so nobody re-derives the omission
 * as a deliberate limit:
 *   - cannot prove the effect ever runs;
 *   - cannot prove the dependency array causes it to run at the right times;
 *   - cannot prove the two side effects fire, or fire in order, at runtime;
 *   - cannot prove a later effect does not undo the mode flip;
 *   - cannot prove the values passed into the predicate are the *active
 *     document's* at runtime. C8' pins the argument TEXT, not the runtime
 *     values: `activeDocument` could be shadowed or stale and C8' stays green.
 *
 * ── WHY THERE IS NO `render(<App />)` TEST, STATED RATHER THAN IMPLIED ──────
 *
 * This file is a DECLARED, REASONED WAIVER, not an oversight. Rendering
 * `App.tsx` is not feasible here and was not attempted, for four verified
 * reasons: no test in this repository renders `App` today, so there is no
 * harness to extend; `App` transitively pulls Milkdown/ProseMirror, CodeMirror 6
 * and the Tauri `invoke`/`listen` surface, so the mount would require mocking
 * far more collaborators than the unit has real ones; jsdom here has no layout
 * engine, so the mount would be a fiction of the WKWebView behaviour this guard
 * exists to protect; and the effect's real risk — firing at the right time — is
 * exactly what a jsdom mount verifies least convincingly.
 *
 * The rejected middle option, named so it is not silently skipped: extracting a
 * `useLargeDocumentGuard` hook and testing it with `renderHook` would give
 * genuine Level 2 verification of the ordering and the two calls. It is
 * rejected here ONLY because the decided shape keeps the `useEffect` in
 * `App.tsx` as owner of the side effects. If a future work item wants the
 * ordering behaviourally pinned, that hook extraction is the way.
 *
 * ── THE ARGUMENT-LEVEL CORRECTION, RECORDED ────────────────────────────────
 *
 * An earlier revision of this matrix asserted only that `showToast(` precedes
 * `setViewMode(` (C4) and that the message string is *absent* from `App.tsx`
 * (C2), and never looked INSIDE the parentheses. Under that revision this
 * implementation was fully green:
 *
 *     showToast("Switched to Source mode.");   // wrong user-visible copy
 *     setViewMode("wysiwyg");                  // the mode never actually flips
 *
 * The guardrail entirely dismantled, and the suite passing. C2' is an ABSENCE
 * check on the message, so it passes MORE easily with the wrong string than
 * with the right one. The arguments were the gap; C8' closes it.
 *
 * ── WHERE THE BEHAVIOURAL WEIGHT ACTUALLY SITS ─────────────────────────────
 *
 *   - `tests/large-document-guard.test.ts` — 33 executable Level 1/S1-S6 cases
 *     over the predicate itself (count measured 2026-09-21, not estimated).
 *   - Runtime wiring is MANUAL QA: in `pnpm tauri dev`, open a structurally
 *     heavy `.md` — the corpus from `scripts/perf/generate-corpus.mjs` is the
 *     intended source, `large-table.wysiwyg.md` and `many-short-nodes.wysiwyg.md`
 *     degrade — and confirm the mode flips to Source and the toast reads exactly
 *     "This document is too complex for WYSIWYG. Switched to Source mode for
 *     performance."; then open `very-long-line.wysiwyg.md` (471,862 B, 3 lines)
 *     and `dense-math.wysiwyg.md` and confirm nothing happens. The old
 *     instruction here named a 500 KB byte threshold and the "Document exceeds
 *     500KB" copy; ADR-0016 makes both false, so it was replaced rather than
 *     left to rot.
 *
 * ANYONE READING A GREEN RUN OF THIS FILE AS PROOF THAT THE GUARDRAIL WORKS IS
 * MISREADING IT.
 *
 * ── ADR-0016: WHAT IS FROZEN IS THE INVARIANT SET, NOT THE NUMBER ──────────
 *
 * This block replaces the SCOPE LOCK that stood here while the predicate judged
 * bytes. ADR-0016 Decision 1 freezes a set of INVARIANTS and explicitly does
 * not freeze the arithmetic: one forward pass over `content`, constant
 * auxiliary space, no Markdown parsing and no tokenizer, and a decision made by
 * comparing counts only. Later work "may add or reweight counters within those
 * invariants without superseding this ADR; changing the invariants requires a
 * new one."
 *
 * The number is therefore NOT the frozen thing. `25_000` is "a choice within a
 * measured interval, not a measurement" (Decision 2, boundary located only to
 * the open interval (20,664, 32,657)); the cell weight `k = 1` is policy, the
 * data constraining it merely to `k > 0.464`. The `<=` allow direction is
 * retained (Decision 2) and `fileSize` is removed from the input entirely
 * (Decision 5).
 *
 * What this file pins against that backdrop: C12 is the ONLY available
 * enforcement of the invariant set — and it is blind to an allocation-free
 * *parsing* rule, for which N17 and N1 rows 23/24 in
 * `tests/large-document-guard.test.ts` are the behavioural tripwires. C8b' is
 * the source-text half of "the threshold has exactly one home"; G21' is the
 * behavioural half. Neither endorses the value.
 *
 * `src/App.tsx:504-509` (the `largeFileWarning` effect) is proven dead by
 * ADR-0016 Decision 6 and its removal is explicitly NOT authorised. No case
 * here asserts it still exists — a test pinning dead code would pin an
 * accident. Diff review is the enforcement, and the WI-4 acceptance criterion
 * says so. C10's slice isolation does make an accidental *expansion* into that
 * effect fail, which is a different and weaker guarantee.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Anchor on expect.getState().testPath, NOT import.meta.url: under Vite's
// transform import.meta.url is not a file:// URL and fileURLToPath throws
// "TypeError: The URL must be of scheme file". Precedent and rationale:
// tests/logging-hydration-call-site.test.ts:39-41.
function readSrc(relativeToTestsDir: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  return fs.readFileSync(
    path.resolve(path.dirname(testPath), relativeToTestsDir),
    "utf-8",
  );
}

const APP_PATH = "../src/App.tsx";
const MODULE_PATH = "../src/utils/largeDocumentGuard.ts";

// Written out in full rather than composed, because C3's whole job is that this
// exact text survives character-for-character.
const DEPENDENCY_ARRAY = "[activeDocument, setViewMode, showToast, viewMode]";
const CALL_ANCHOR = "const decision = decideLargeDocumentGuard(";

/**
 * Strip comments before matching. Shared by C8b' and C12.
 *
 * The strip is LOAD-BEARING, not setup. Without it the module header's prose
 * satisfies both cases' matchers: the header discusses `25_000`, discusses
 * `split` and `TextEncoder` by name in contract answers (3) and (6), and would
 * therefore make C12's absence set unsatisfiable and C8b''s literal list
 * satisfiable by documentation alone — while the predicate compared against an
 * inlined number.
 *
 * Price paid knowingly: a stale `500 * 1024` left in the header COMMENT no
 * longer trips anything, because comments are stripped first. A comment copy is
 * a documentation-rot problem, and rule 60 § "Documentation Sync" — not a test
 * — is its enforcement (WI-6). A code copy is the D6.2 failure C8b' describes.
 */
function moduleCodeWithoutComments(): string {
  return readSrc(MODULE_PATH)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * The shared slice used by C3-C6, C8' and C9, and the home of case C10.
 *
 * Slicing is MANDATORY, not hygiene: `if (!activeDocument) return;` occurs
 * three times in `App.tsx` (`:484`, `:512`, `:598` — measured 2026-09-21), so a whole-file
 * `toContain` would stay green after this effect's guard was deleted.
 *
 * ── CASE C10 (three assertions, no separate `it()` block) ──────────────────
 *
 * C10 is implemented HERE rather than beside the other cases because it is a
 * PRECONDITION on all of them: it must run before each consumer, so every
 * consumer of the slice inherits it.
 *
 * The mechanism it guards: `effectStart` uses `lastIndexOf("useEffect(() => {")`,
 * and `useEffect(() => {` occurs FIFTEEN times in `src/App.tsx`. `lastIndexOf`
 * does not fail on a mismatch — it silently returns a DIFFERENT effect's start
 * and the slice quietly expands to swallow the neighbour. Concretely: reformat
 * the guardrail's opener across lines and delete its `!activeDocument` guard,
 * and `effectStart` falls back to the `decideFileChange` effect at `:483`. That
 * neighbour then donates the exact two anchors the guardrail just lost —
 * `if (!activeDocument) return;` at `:484` satisfies C5 and
 * `switch (decision.action)` at `:486` satisfies C6 — and every case passes
 * while production throws `TypeError: Cannot read properties of null (reading
 * 'content')` on every render with no active document.
 *
 * Every other formatting deviation in this file fails LOUDLY. This one fails
 * GREEN, which is the only failure mode a reader cannot detect from the report.
 */
function guardEffectSlice(): string {
  const src = readSrc(APP_PATH);

  const callIdx = src.indexOf(CALL_ANCHOR);
  const effectStart = src.lastIndexOf("useEffect(() => {", callIdx);
  const effectEnd = src.indexOf(DEPENDENCY_ARRAY, callIdx);

  // Three mandatory -1 guards. `-1 < anyIndex`, so the ordering assertions
  // below would go vacuously green in exactly the failure case they guard.
  expect(callIdx).toBeGreaterThan(-1);
  expect(effectStart).toBeGreaterThan(-1);
  expect(effectEnd).toBeGreaterThan(-1);
  expect(effectStart).toBeLessThan(callIdx);
  expect(callIdx).toBeLessThan(effectEnd);

  const slice = src.slice(effectStart, effectEnd);

  // C10 — the slice is the guardrail's effect and not a neighbour's.
  expect(slice.match(/useEffect\(/g) ?? []).toHaveLength(1);
  expect(slice.match(/switch\s*\(decision\.action\)/g) ?? []).toHaveLength(1);
  expect(slice.match(/decideLargeDocumentGuard\(/g) ?? []).toHaveLength(1);

  return slice;
}

describe("WI-4/WI-5: large-document guardrail call site (source-text, below Level 6)", () => {
  it("C1: App imports and calls the extracted predicate", () => {
    const src = readSrc(APP_PATH);
    expect(src).toMatch(
      /import\s*\{[^}]*decideLargeDocumentGuard[^}]*\}\s*from\s*["']\.\/utils\/largeDocumentGuard["']/,
    );
    expect(src).toContain(CALL_ANCHOR);
  });

  it("C2': the removed literals stay removed, and the new ones never arrive", () => {
    const src = readSrc(APP_PATH);

    // NEW absences — the new threshold's and the new copy's one home is the
    // module. Verified before writing: `src/App.tsx` contains no `25_000`, no
    // `25000`, and neither message fragment today.
    expect(src).not.toMatch(/25[_]?000/);
    expect(src).not.toMatch(/too complex for WYSIWYG/);
    expect(src).not.toMatch(/Switched to Source mode/);

    // Deliberately NOT /WYSIWYG/ on its own: `src/App.tsx` legitimately
    // contains the word at `:733`, `:763`, `:968`, `:971` and inside an
    // unrelated toast at `:976`. The two fragments above are the copy; the bare
    // word is not.

    // RETAINED absences. Whitespace-tolerant regexes, not
    // toContain("500 * 1024"): `500*1024` reintroduces the constant and defeats
    // a literal substring check. `/TextEncoder/` is now trivially true, and is
    // kept because it is cheap and still meaningful as a revert anchor; the
    // three byte-era spellings below are regression anchors against a revert —
    // the old predicate coming back would trip these before anything else.
    expect(src).not.toMatch(/TextEncoder/);
    expect(src).not.toMatch(/500\s*\*\s*1024/);
    expect(src).not.toMatch(/512[_]?000/);
    expect(src).not.toMatch(/Document exceeds 500KB/);

    // This is the case in the file that earns its keep: a partially-completed
    // or later-reverted extraction leaves two copies of a frozen constant, and
    // two copies of a frozen constant is precisely how a future one-line
    // threshold change becomes a two-day bug hunt.
    //
    // Known blind spots, stated: /512[_]?000/ does not catch 0x7D000,
    // `500 << 10`, or a computed spelling — and neither does /25[_]?000/ catch
    // 0x61A8, `25 << 0`, or `25e3`. Same class, same caveat: source-text
    // matching cannot be made exhaustive against an adversary; it is aimed at
    // the accident. And the message assertions are ABSENCE checks, so they pass
    // more easily with the WRONG string than with the right one; they cannot
    // tell "moved into the module" from "replaced with something else". C8'
    // makes the positive claim, and M1/M2 make it behaviourally.
    const slice = guardEffectSlice();

    // Narrow, and deliberately not widened: this catches ONE spelling out of at
    // least five. `viewMode === "source"`, `viewMode != "wysiwyg"`,
    // `switch (viewMode)`, and a re-check hoisted outside the slice all pass it
    // untouched. Broadening was rejected because `viewMode` legitimately
    // appears in the slice as an argument (C8' asserts it does), so any regex
    // loose enough to catch the family fires on correct code.
    expect(slice).not.toMatch(/viewMode\s*!==/);
  });

  it("C3: the dependency array is character-for-character unchanged", () => {
    const src = readSrc(APP_PATH);
    // Cannot prove the array is CORRECT — only that it is the one that was
    // reviewed. That is the acceptance criterion and nothing more.
    //
    // It is also the enforcement of plan risk 6's resolution. Risk 6 asked
    // whether the score should be memoized at the call site; option (b) was
    // `useMemo`, and the addendum resolves risk 6 to option (a) — accept the
    // recompute and record it. An implementer who reaches for `useMemo` here
    // changes this array, breaks this case, and must go back to the plan rather
    // than re-decide it inside an effect.
    expect(src).toContain(DEPENDENCY_ARRAY);
  });

  it("C4: showToast precedes setViewMode inside this effect", () => {
    const slice = guardEffectSlice();
    const toastIdx = slice.indexOf("showToast(");
    const setModeIdx = slice.indexOf("setViewMode(");

    // Mandatory -1 guards, per the precedent at
    // tests/logging-hydration-call-site.test.ts:79-81.
    expect(toastIdx).toBeGreaterThan(-1);
    expect(setModeIdx).toBeGreaterThan(-1);
    expect(toastIdx).toBeLessThan(setModeIdx);

    // Cannot prove the calls execute, or that React batches them as the source
    // order suggests, and does NOT look inside the parentheses at all:
    // `showToast("anything"); setViewMode("wysiwyg");` satisfies this case
    // completely. C8' is what makes the arguments a claim, and C9's arm-order
    // assertion is what keeps this case non-vacuous. Behavioural pairing: NONE
    // — the ordering of two React side effects is precisely what source text
    // cannot verify. Recorded, not papered over.
  });

  it("C5: the no-active-document early return survives, inside this effect", () => {
    const slice = guardEffectSlice();
    const guardIdx = slice.indexOf("if (!activeDocument) return;");
    const callIdx = slice.indexOf("decideLargeDocumentGuard(");

    expect(guardIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(callIdx);

    // This case carries the coverage lost at G3. It cannot prove the early
    // return executes, only that it is written before the call. That is a
    // genuine downgrade from an executable assertion and is recorded, not
    // dropped. Deleting the guard, or moving it after the call, dereferences
    // `activeDocument.content` on null and throws inside an effect. (The field
    // name changed with ADR-0016 Decision 5 — it was `activeDocument.fileSize`
    // until `fileSize` left the input. Rule 22: the comment moves with the
    // code, the failure mode is unchanged.)
  });

  it("C6: the caller handles both union arms and has no default: escape hatch", () => {
    const slice = guardEffectSlice();

    expect(slice).toContain("switch (decision.action)");
    expect(slice).toContain('case "allow":');
    expect(slice).toContain('case "degrade-to-source":');
    expect(slice).not.toMatch(/default\s*:/);

    // What this case does NOT provide: it checks only that both labels are
    // present and that no `default:` is. It does not catch an empty or
    // fallen-through `case "allow":` — C9 does that.
    //
    // CORRECTION (2026-09-19). An earlier version of this comment claimed
    // "discriminated-union narrowing makes an unhandled arm an error", enforced
    // by `tsc --noEmit`. That is FALSE, and it was verified false rather than
    // reasoned about: compiling this exact shape with a third union arm added
    // and no `default:` produces NO diagnostic under this repo's compiler
    // options. `noFallthroughCasesInSwitch` (tsconfig.json:21) catches fallthrough
    // between arms, not a missing arm. A bare `switch` earns nothing for rule 60
    // § "Enum and Union Completeness" — the exhaustiveness guard C11 pins is
    // what actually earns it.
    //
    // KNOWN WEAKNESS of the assertion above, recorded not repaired: it scans the
    // raw slice, so it cannot tell code from comment. Writing the escape hatch's
    // name inside a nearby comment turns this case red with the code correct —
    // that happened for real while C11 was being added. C8b' already carries the
    // repair for this class (strip comments, then match); C6 does not, because
    // editing a recorded assertion to make new code pass is precisely what the
    // red receipt exists to prevent. Repair belongs in its own change.
  });

  it("C11: the switch carries an exhaustiveness guard, because the switch alone carries none", () => {
    const slice = guardEffectSlice();

    expect(slice).toMatch(/decision\s+satisfies\s+never\s*;/);

    // Why this case exists, stated plainly because the matrix got it wrong.
    //
    // C6's original rationale asserted that omitting `default:` buys
    // compiler-enforced exhaustiveness. It does not. Measured on 2026-09-19
    // against this repo's own tsc and compiler options, with the effect's exact
    // shape:
    //
    //   two arms, no `satisfies`  -> clean
    //   THREE arms, no `satisfies` -> CLEAN. The unhandled arm is silent.
    //   three arms + `satisfies never` -> TS1360, as wanted
    //   two arms  + `satisfies never` -> clean, so no false positive today
    //
    // Both arms `return`, so control flow reaching past the switch has narrowed
    // `decision` to `never`. Adding a third action to LargeDocumentGuardDecision
    // therefore fails to compile HERE, at the call site that would otherwise
    // drop it on the floor. That is the whole mechanism rule 60 § "Enum and
    // Union Completeness" asks for, and without this line it is absent.
    // Behavioural pairing: G20' (the union's exact key sets) fails in the unit
    // lane for the same third arm that fails `tsc` here.
    //
    // KNOWN GAP, recorded not fixed: the `decideFileChange` effect immediately
    // above this one uses the same bare-switch idiom and was the cited precedent
    // for it. It has the same hole. Fixing it is a separate change with its own
    // tests — editing it from here would be the drive-by rule 22 forbids.
  });

  it("C7: the extracted module is actually pure — no React, no store, no DOM, no side effect", () => {
    const src = readSrc(MODULE_PATH);

    expect(src).toMatch(/^import type \{ ViewMode \} from "\.\.\/types\/editor";$/m);
    expect((src.match(/^import\b/gm) ?? []).length).toBe(1);

    expect(src).not.toMatch(/from "react"/);
    expect(src).not.toMatch(/\/stores\//);
    expect(src).not.toMatch(/showToast/);
    expect(src).not.toMatch(/setViewMode/);
    expect(src).not.toMatch(/\bwindow\./);
    // The `document.` check is deliberately narrowed to DOM-API call sites
    // because the module header discusses documents in prose. Decided once,
    // recorded here: narrowed, not weakened to nothing.
    expect(src).not.toMatch(
      /\bdocument\.(getElementById|querySelector|body|createElement)/,
    );
    expect(src).not.toMatch(/console\./);

    // This case catches globals reached by IMPORT, not a global DECLARED in the
    // file — a module-scope mutable object is invisible to it. That axis is G22
    // in tests/large-document-guard.test.ts.
  });

  it("C8': the call site passes the right arguments, and fileSize is gone from the slice", () => {
    const slice = guardEffectSlice();

    expect(slice).toContain("content: activeDocument.content");

    // The WI-4 acceptance criterion, and the reason this case was rewritten:
    // ADR-0016 Decision 5 removes `fileSize` from the guard's input entirely.
    // Scoped to the SLICE, not the whole file, because `activeDocument.fileSize`
    // may legitimately appear elsewhere in `App.tsx`.
    expect(slice).not.toMatch(/fileSize/);

    expect(slice).toContain("showToast(decision.message)");
    expect(slice).toContain('setViewMode("source")');

    // The `viewMode` shorthand is pinned by MEANING, not by adjacency. An
    // earlier revision asserted toContain("viewMode,"), which killed the
    // hardcoded-mode mutation only incidentally (a `:` is not a `,`) while
    // failing on CORRECT code that merely orders the object's properties
    // differently. There is no prettier config in this repository, so that
    // false-failure surface is real. The pair below states the two things
    // actually meant and is indifferent to property order and line breaks.
    expect(slice).not.toMatch(/viewMode\s*:\s*["']/); // not a hardcoded literal
    expect(slice).toMatch(/\bviewMode\b\s*[,}]/); // present as a shorthand

    // This is the only case in the matrix that connects the predicate's OUTPUT
    // to the side effect's INPUT, and the only one that pins the flip target as
    // "source". It still cannot prove the effect runs, that `activeDocument` is
    // not shadowed or stale, or that the toast reaches a user.
    //
    // NOTE — a residual RUNTIME `fileSize` read inside the module gets no case
    // here, deliberately. The shape would be a dead `if ("fileSize" in input)`
    // branch in `largeDocumentGuard.ts`. It is defeated twice without a case:
    // (a) WI-3 requires the module to stay 100/100/100/100, and an unreachable
    // branch drops branch coverage below 100 — the COVERAGE GATE is the
    // enforcement; (b) the `fileSize` absence above means no production caller
    // can reach the branch even if it existed. The only test that could execute
    // it would have to construct `{ viewMode, content, fileSize }` and defeat
    // TS2353 with an `as` cast — asserting a shape the type forbids, teaching
    // the next reader that the extra member is legitimate, and buying strictly
    // less than the coverage gate already provides. Recorded so nobody later
    // adds the cast believing it closes a hole.
  });

  it("C8b': the threshold has exactly one home, and the character codes are an enumerated allowance", () => {
    const code = moduleCodeWithoutComments();

    // 1 — POSITIVE pin on the comparison. The old C8b only counted `<=`; a
    // positive match is what survives the constant being renamed out from under
    // a pure count.
    expect(code).toMatch(/\bscore\s*<=\s*LARGE_DOCUMENT_STRUCTURE_THRESHOLD\b/);

    // 2 — EXACT `<=` count, stated as a named number, never loosened. If the
    // scan legitimately acquires a second `<=`, this number is RAISED together
    // with a stated reason; it is never relaxed to `toBeGreaterThan(0)`. (Plan
    // risk 15.) Verified against the shipped shape: a
    // `for (let index = 0; index < length; index++)` loop and
    // `code === CHAR_SPACE || code === CHAR_TAB` introduce no `<=`, so 1 holds.
    const EXPECTED_LTE_COUNT = 1;
    expect(code.match(/<=/g) ?? []).toHaveLength(EXPECTED_LTE_COUNT);

    // 3 — NO comparison against a bare number, in either direction. This is the
    // assertion that actually survives a moved constant, independently of the
    // literal list below. Verified free of false positives against the intended
    // shape: `= 9`, `= 124`, `index++`, `index < length` all pass.
    expect(code).not.toMatch(/[<>]=?\s*\d/);
    expect(code).not.toMatch(/\d\s*[<>]=?/);

    // 4 — The complete numeric-literal set, as a SORTED MULTISET, with the
    // threshold's multiplicity named separately. Sorted-multiset equality is
    // order-independent (reordering the constant block does not false-fail) yet
    // exact (a sixth literal fails, a duplicated `10` fails, a second `25_000`
    // fails).
    //
    // THE PERMITTED LIST, AND WHY EACH ENTRY IS PERMITTED — an open-ended "any
    // number is fine" defeats the anchor:
    //   `25_000` — the threshold, LARGE_DOCUMENT_STRUCTURE_THRESHOLD. Exactly
    //              one home. The underscore spelling is part of WI-1 contract
    //              answer (5), not cosmetics.
    //   `10`     — CHAR_NEWLINE. `124` — CHAR_PIPE. `32` — CHAR_SPACE.
    //   `9`      — CHAR_TAB. Permitted ONLY inside the named-constant block
    //              resolved in WI-1 answer (6).
    //
    // If the scan acquires a FIFTH character code — `92` for backslash, `96`
    // for backtick — this assertion goes RED, and that is correct: those codes
    // have no legitimate use in a counts-only scan, and their appearance is
    // precisely the parsing rule N17 exists to catch. The multiset must NOT be
    // widened to admit them; the remedy is a new ADR, not a longer allowlist.
    //
    // ZEROES ARE FILTERED OUT, and this is a correction to the matrix
    // (revision 3, R3-4), not an implementer's convenience. The matrix demanded
    // the multiset equal exactly ["10","124","25_000","32","9"]; the real
    // multiset is ['0','0','9','10','32','124','25_000'], the two extras being
    // `let score = 0` and the `for (let index = 0; …)` initialiser — both
    // unavoidable in a forward counting scan, and the case's own design note
    // anticipated the loop without carrying it through to the literal list. As
    // written the assertion was UNSATISFIABLE. Filtering `"0"` costs the anchor
    // nothing: assertion 3 above independently forbids comparing against a bare
    // number, so a `0` pressed into service as a threshold (`score <= 0`) is
    // still caught. What is dropped is a value with no threshold semantics, and
    // pinning its multiplicity would false-fail on any innocuous loop refactor
    // while catching nothing. The implementation was NOT contorted to satisfy
    // the assertion — contorting production code to satisfy a source-text
    // assertion is the exact failure mode this anchor exists to prevent.
    const literals = (code.match(/0x[0-9a-fA-F]+|\b\d[\d_]*\b/g) ?? []).filter(
      (literal) => literal !== "0",
    );
    expect([...literals].sort()).toEqual(
      ["10", "124", "25_000", "32", "9"].sort(),
    );
    expect(literals.filter((literal) => literal === "25_000")).toHaveLength(1);

    // The two spellings the literal regex cannot see.
    expect(code).not.toMatch(/\d(?:\.\d+)?e[+-]?\d+/i);
    expect(code).not.toMatch(/Number\s*\(|parseInt\s*\(/);

    // THE FAILURE MODE THIS PREVENTS, stated because a green suite is not the
    // same as a shipped change: at a future reweighting the one-line threshold
    // change would otherwise move the constant, redden a few literal anchors,
    // get them "fixed", and leave the predicate comparing against an inlined
    // 25,000 — green suite, unmoved threshold, and an ADR recording a change
    // that never shipped.
    //
    // The adversary-vs-accident caveat carries forward verbatim from the
    // byte-era C8b: source-text matching cannot be made exhaustive against an
    // adversary; it is aimed at the accident. Behavioural counterpart: G21',
    // the boundary re-stated against the exported constant.
  });

  it("C12: the scan is single-pass and allocation-free, by source inspection", () => {
    const code = moduleCodeWithoutComments();

    // Nothing derived from `content` may be allocated. Each of these is a
    // distinct way to break "one forward pass, constant auxiliary space".
    expect(code).not.toContain(".split(");
    expect(code).not.toContain(".match(");
    expect(code).not.toContain(".matchAll(");
    expect(code).not.toContain(".replace(");
    expect(code).not.toContain(".slice(");
    expect(code).not.toContain(".trim");
    expect(code).not.toContain(".padStart");
    expect(code).not.toContain("TextEncoder");
    expect(code).not.toContain("Array.from");
    expect(code).not.toContain("JSON.");
    expect(code).not.toContain("[...");
    expect(code).not.toContain(".concat(");

    // No regex literal anywhere in the comment-stripped code: a regex over
    // `content` is both an allocation and, in effect, a tokenizer.
    expect(code).not.toMatch(/=\s*\/[^/\n]+\/[gimsuy]*/);
    expect(code).not.toMatch(/\/[^/\s][^\n]*\/[gimsuy]*\.test\(/);

    // Positive: the scan reads character codes by index.
    expect(code).toMatch(/\.charCodeAt\(/);

    // WHY `charCodeAt` AND NOT `for (const ch of input.content)` — WI-1 contract
    // answer (6) resolved. A `for…of` scan is single-pass but allocates a fresh
    // one-code-point string per character, which is not constant auxiliary
    // space in the sense ADR-0016 Decision 1 freezes. The index loop is
    // unambiguously allocation-free. The rejected alternative (direct string
    // comparison, `c === "\n"`) would have left C8b''s literal list as the
    // single entry ["25_000"] — a STRONGER anchor — but gives up that
    // guarantee. The stronger anchor was traded for the stronger invariant,
    // deliberately.
    //
    // THIS IS THE ONLY AVAILABLE ENFORCEMENT of ADR-0016's frozen invariants
    // (one forward pass, constant auxiliary space, no Markdown parsing, no
    // tokenizer). Behavioural pairing: G18' (`content` read exactly once) is
    // the behavioural half, and it is explicitly a PARTIAL half —
    // `input.content.split("\n")` also reads the property exactly once.
    //
    // RECORDED BLIND SPOT: C12 is blind to a parsing rule that adds no
    // allocation. A one-character lookback skipping `\|`, a boolean tracking
    // backtick spans, or a "row must close with a pipe" rule passes every
    // matcher above. C12 therefore does NOT enforce "no Markdown parsing" on
    // its own; N17 and N1 rows 23/24 in tests/large-document-guard.test.ts are
    // the behavioural tripwires for exactly that class. Claiming C12 alone
    // enforces Decision 1 is a false-coverage claim.
  });

  it("C9: the allow arm does nothing, and the arms are in the order C4 assumes", () => {
    const slice = guardEffectSlice();

    const allowIdx = slice.indexOf('case "allow":');
    const degradeIdx = slice.indexOf('case "degrade-to-source":');

    expect(allowIdx).toBeGreaterThan(-1);
    expect(degradeIdx).toBeGreaterThan(-1);
    expect(allowIdx).toBeLessThan(degradeIdx); // pins arm order; also re-arms C4

    // Admits no statement in the arm. C8' pinned the DEGRADE arm's arguments and
    // left the allow arm unspecified; with it unconstrained, this typechecks
    // and passes every other case:
    //   case "allow":
    //     setViewMode("wysiwyg");   // the whole bug
    //     return;
    // Production effect: Source mode becomes unreachable for every document
    // under the threshold. `viewMode` is in the dependency array, so Ctrl-2
    // (View -> Source) fires the effect, which immediately forces the user back
    // to WYSIWYG. The large-document degrade still works, which is precisely
    // what lets it survive every test and fail every user.
    expect(slice.slice(allowIdx, degradeIdx).replace(/\s/g, "")).toBe(
      'case"allow":return;',
    );

    // The ordering assertion above is independently valuable and is the part to
    // not skip: it is what makes C4's check non-vacuous. C4 compares
    // indexOf("showToast(") < indexOf("setViewMode(") over the whole slice —
    // swapping the arm order defeats it, and nothing else pins arm order.
  });
});
