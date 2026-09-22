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
 *   - `tests/large-document-guard.test.ts` — 51 executable Level 1/S1-S6 cases
 *     over the predicate itself (count measured 2026-09-21 from the run, not
 *     estimated; was 33 before D6.3(d) added the longest-line family).
 *
 * ── D6.3(d), 2026-09-21: THE PREDICATE GAINED A SECOND TRIGGER ─────────────
 *
 * `docs/adr/0019-large-document-guard-adds-a-longest-line-trigger.md` EXTENDS
 * ADR-0016; it does not supersede it. Every invariant ADR-0016 Decision 1
 * froze still holds, and this file is where three of them are enforced: C12
 * (constant auxiliary space), C13 (one forward pass — NEW, and the only thing
 * anywhere that checks it), C8b' (the thresholds have exactly one home each).
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

    // 1-new — the SAME positive pin for the second comparison, added by
    // D6.3(d) / ADR-0019 Decision 2. Without it the second `<=` counted below
    // would be unattributed: the count would rise to 2 and nothing would say
    // WHICH comparison the new one is. Together the two positive pins make the
    // count meaningful rather than merely larger.
    //
    // This assertion is also load-bearing in a way its sibling is not. A
    // `max(score, longestLine / k) > THRESHOLD` fold is BEHAVIOURALLY
    // IDENTICAL to the two-threshold predicate — it passes every case in
    // `tests/large-document-guard.test.ts`, including LL-17 and M4. This
    // positive pin is the only thing in the suite that catches it, and it is
    // what keeps ADR-0019 Decision 3 ("the new counter gets its own
    // comparison; it is NOT folded into the structure score") enforced rather
    // than merely written down.
    expect(code).toMatch(
      /\blongestLine\s*<=\s*LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD\b/,
    );

    // 1-ADR-0022 — the positive pin for the THIRD comparison, added with
    // ADR-0022 Decision 3: Source's table-row count against its own threshold.
    // Same reason as the pin above: it attributes the third `<=` counted below,
    // and it catches the row count being folded into `score` or compared
    // against an inlined number.
    expect(code).toMatch(/\btableRowStarts\s*<=\s*SOURCE_TABLE_ROW_THRESHOLD\b/);

    // 2 — EXACT `<=` count, stated as a named number, never loosened. If the
    // scan legitimately acquires a second `<=`, this number is RAISED together
    // with a stated reason; it is never relaxed to `toBeGreaterThan(0)`. (Plan
    // risk 15.) Verified against the shipped shape: a
    // `for (let index = 0; index < length; index++)` loop and
    // `code === CHAR_SPACE || code === CHAR_TAB` introduce no `<=`, so 1 holds.
    //
    // RAISED 1 → 2 on 2026-09-21 by D6.3(d), with the reason this case
    // demands: ADR-0019 Decision 2 adds a SECOND threshold
    // (`LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD`) that keeps the `<=` allow
    // direction on purpose, so that a document sitting exactly on either
    // boundary still opens. Two thresholds, two `<=`, each pinned positively
    // above. This is the sanctioned path the paragraph above describes — a
    // raise with a stated reason — and not a relaxation.
    //
    // RAISED 2 → 3 on 2026-09-22, with the reason this case demands:
    // ADR-0022 Decision 3 adds a THIRD threshold (`SOURCE_TABLE_ROW_THRESHOLD`,
    // 50,000 table-row starts, Source only) with the same `<=` allow
    // direction. Three thresholds, three `<=`, each pinned positively above.
    const EXPECTED_LTE_COUNT = 3;
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
    // WIDENED 5 → 6 entries on 2026-09-21 by D6.3(d). Read the distinction
    // carefully, because this case exists to prevent a widening: the entry
    // added is `1_000_000`, a THRESHOLD CONSTANT sanctioned by a new accepted
    // record (ADR-0019 Decision 2). It is NOT a fifth character code. The
    // warning this case carries — "the multiset must NOT be widened to admit
    // them; the remedy is a new ADR, not a longer allowlist" — is aimed at
    // character codes smuggled in as a shortcut, and it is honoured here: the
    // remedy WAS a new ADR. A sixth entry that is a character code, or a
    // threshold with no ADR behind it, is still the failure this case catches.
    //
    // The `filter(l => l !== "0")` above is now MORE load-bearing, not less:
    // the implementation adds `let currentLine = 0;` and `let longestLine = 0;`,
    // i.e. two further zeros. The rationale for dropping `0` is unchanged (a
    // `0` pressed into service as a threshold is still caught by assertion 3).
    //
    // WIDENED 6 → 7 entries on 2026-09-22 by ADR-0022 Decision 3, under the
    // same distinction as above: `50_000` is a THRESHOLD CONSTANT sanctioned
    // by a new accepted record, not a character code. The new counter's
    // `let tableRowStarts = 0;` adds only a filtered zero.
    expect([...literals].sort()).toEqual(
      ["10", "124", "1_000_000", "25_000", "32", "50_000", "9"].sort(),
    );
    expect(literals.filter((literal) => literal === "25_000")).toHaveLength(1);
    // Same multiplicity discipline for the new threshold: exactly one home.
    // A second `1_000_000` anywhere in the module means the constant has been
    // inlined somewhere, which is the D6.2 failure this whole case describes.
    expect(
      literals.filter((literal) => literal === "1_000_000"),
    ).toHaveLength(1);
    // And for the third (ADR-0022): exactly one home for `50_000`.
    expect(literals.filter((literal) => literal === "50_000")).toHaveLength(1);

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
    // CORRECTED 2026-09-21 (D6.3(d)). This case USED to claim it was "the only
    // available enforcement" of ALL of ADR-0016's frozen invariants. That was
    // a false-coverage claim of exactly the kind the recorded blind spot below
    // warns about, and it hid a real hole for a full release: C12 counts
    // ALLOCATIONS, and a second forward pass allocates nothing. The claim
    // splits three ways, and each part has a different home:
    //
    //   - constant auxiliary space → C12 (this case).
    //   - one forward pass         → C13 (immediately below). C12 CANNOT see
    //     loop count: its only positive assertion is the presence check
    //     `toMatch(/\.charCodeAt\(/)`, which a two-loop scan satisfies twice
    //     over.
    //   - no Markdown parsing / no tokenizer → N17 and N1 rows 23/24 in
    //     `tests/large-document-guard.test.ts` (behavioural tripwires), plus
    //     the recorded blind spot below.
    //
    // Behavioural pairing: G18' (`content` read exactly once) is the
    // behavioural half, and it is explicitly a PARTIAL half —
    // `input.content.split("\n")` also reads the property exactly once, and
    // G18' says so itself.
    //
    // RECORDED BLIND SPOT: C12 is blind to a parsing rule that adds no
    // allocation. A one-character lookback skipping `\|`, a boolean tracking
    // backtick spans, or a "row must close with a pipe" rule passes every
    // matcher above. C12 therefore does NOT enforce "no Markdown parsing" on
    // its own; N17 and N1 rows 23/24 in tests/large-document-guard.test.ts are
    // the behavioural tripwires for exactly that class. Claiming C12 alone
    // enforces Decision 1 is a false-coverage claim.
  });

  it("C13: the scan is ONE loop, by source inspection", () => {
    const code = moduleCodeWithoutComments();

    // WHY THIS CASE EXISTS, AND WHY IT CANNOT BE BEHAVIOURAL.
    //
    // The mutant it kills: keep the existing scoring loop byte-for-byte, add a
    // SECOND `for` loop over the same `content` that computes `longestLine`,
    // then decide identically. That implementation is OUTPUT-IDENTICAL at
    // every input. All 51 behavioural cases in
    // `tests/large-document-guard.test.ts` pass against it by construction, at
    // every assertion level, for any input anyone can construct. No
    // behavioural test can distinguish one pass from two — only the source
    // text can. This is the same argument that justifies C12's allocation
    // blacklist, and it is stated in the same terms deliberately: the two are
    // the same kind of instrument, guarding the same ADR.
    //
    // It is also the mutant most likely to actually happen, because a second
    // clean loop is the SAFEST-LOOKING way to add the counter — it leaves the
    // already-proven scoring loop untouched.
    //
    // What it costs in practice, stated so the trade is visible: a genuinely
    // needed refactor splitting the scan into two named passes goes red here
    // and requires an ADR. That is the intended cost. ADR-0016 Decision 1
    // froze "one forward pass"; ADR-0019's Status says it leaves that invariant
    // intact. An anchor that let a second pass through silently would make
    // both of those statements false while the suite stayed green.
    //
    // And the cost of NOT having it is real, not hypothetical: the guard's
    // whole justification is being cheap enough to run on every document up to
    // the 10 MB limit, and the shape that motivated ADR-0019 —
    // `very-long-line.source.md`, 9,961,475 bytes — is exactly where doubling
    // the work hurts most.

    // Exact counts, named, in the same raise-with-a-reason form as
    // `EXPECTED_LTE_COUNT` above. NEVER relaxed to `toBeGreaterThanOrEqual(1)`.
    // If a future change legitimately needs a second loop, this constant is
    // RAISED together with a stated reason AND an ADR superseding ADR-0016
    // Decision 1's "one forward pass". The point of the anchor is that a
    // second pass must be ARGUED FOR, not slipped in.
    const EXPECTED_FOR_LOOP_COUNT = 1;
    expect(code.match(/\bfor\s*\(/g) ?? []).toHaveLength(
      EXPECTED_FOR_LOOP_COUNT,
    );

    // C12's `toMatch(/\.charCodeAt\(/)` stays and answers a DIFFERENT question
    // — "does it read by index at all". This counts the sites. A two-loop scan
    // satisfies C12's presence check twice over and fails here.
    const EXPECTED_CHAR_CODE_AT_COUNT = 1;
    expect(code.match(/\.charCodeAt\s*\(/g) ?? []).toHaveLength(
      EXPECTED_CHAR_CODE_AT_COUNT,
    );

    // Prohibitions, not counts, because zero is the only legitimate number: a
    // second pass written as `while` or `do` would otherwise slip past a
    // `for`-only count.
    expect(code).not.toMatch(/\bwhile\s*\(/);
    expect(code).not.toMatch(/\bdo\s*\{/);

    // And the loop count above must not be satisfiable by swapping the index
    // loop for an iterator loop. C12 already forbids the ALLOCATION a `for…of`
    // implies (one fresh one-code-point string per character); this forbids
    // the form directly.
    expect(code).not.toMatch(
      /\bfor\s*\(\s*(?:const|let|var)\s+\w+\s+(?:of|in)\b/,
    );

    // BEHAVIOURAL PAIR: NONE, AND THERE CANNOT BE ONE — see the opening note.
    // Every other source-text anchor in this file names a behavioural half;
    // this one names its absence, because claiming a pair it does not have is
    // the false-coverage failure that let the two-loop hole survive in the
    // first place.
    //
    // It is NOT wiring-only: renaming a variable, reordering the constant
    // block, or reformatting all leave it green. Only the loop structure moves
    // it.
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

  it("C14: the degrade is logged, from the degrade arm, before the toast", () => {
    const slice = guardEffectSlice();

    const degradeIdx = slice.indexOf('case "degrade-to-source":');
    const logIdx = slice.indexOf("buildLargeDocumentDegradeLog(");
    const toastIdx = slice.indexOf("showToast(");

    expect(degradeIdx).toBeGreaterThan(-1);
    expect(logIdx).toBeGreaterThan(-1);
    expect(toastIdx).toBeGreaterThan(-1);

    // In the degrade arm, not above the switch: a call hoisted before the
    // switch would log every allowed document too, which on a large corpus is
    // a log line per keystroke-triggered re-run of this effect.
    expect(degradeIdx).toBeLessThan(logIdx);

    // Before the toast. The toast is transient and the user may never see it;
    // the log line is the durable record and should not be ordered behind a
    // call that could throw.
    expect(logIdx).toBeLessThan(toastIdx);

    // Exactly one call, and it forwards the decision object rather than
    // rebuilding a payload from re-read fields — re-deriving `elements` or
    // `trigger` at the call site is how a log ends up disagreeing with the
    // decision it describes.
    expect(slice.match(/buildLargeDocumentDegradeLog\(/g) ?? []).toHaveLength(1);
    expect(slice).toMatch(/buildLargeDocumentDegradeLog\(\s*decision\s*,/);

    // What this case does NOT prove: that the call executes, or that anything
    // reaches ~/.mdpro/mdpro.log. Source text cannot reach either, and App.tsx
    // has no rendering test to borrow. The payload's CONTENTS are behavioural
    // and live in tests/large-document-degrade-log.test.ts; this case is only
    // the wiring. The allow arm is kept free of the call by C9, which admits
    // no statement there at all — not restated here.
  });
});

// ---------------------------------------------------------------------------
// plan-20260922-113723 (ADR-0022): the Source table verdict wiring in App.
// Source-text Gates, each a supplement to the named behavioural case; App has
// no render harness.
// ---------------------------------------------------------------------------
describe("ADR-0022: Source table verdict wiring in App (source-text Gates)", () => {
  it("C16: handleTableShortcut's Source branch checks the verdict before dispatching (supplement to K3)", () => {
    const src = readSrc(APP_PATH);
    const start = src.indexOf("const handleTableShortcut");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n    [],", start);
    expect(end).toBeGreaterThan(start);
    const slice = src.slice(start, end);

    const gate =
      /isSourceTablesWithheld\(\s*useEditorStore\.getState\(\)\s*,\s*useDocumentStore\.getState\(\)\.activeDocumentId\s*\)/g;
    const matches = [...slice.matchAll(gate)];
    expect(matches).toHaveLength(1);

    const dispatchIdx = slice.indexOf("dispatchSourceTableAction(");
    expect(dispatchIdx).toBeGreaterThan(-1);
    expect(matches[0].index).toBeLessThan(dispatchIdx);

    // editorStore's own activeDocumentId is not the active document.
    expect(slice).not.toContain("useEditorStore.getState().activeDocumentId");
  });
});

describe("ADR-0022 / A1: the guard effect's Source verdict wiring (source-text Gates)", () => {
  it("C17: the A1 skip precedes the decision, and the verdict is recorded before the switch", () => {
    const slice = guardEffectSlice();

    expect(slice.match(/shouldEvaluateGuard\(/g) ?? []).toHaveLength(1);
    const skipIdx = slice.indexOf("shouldEvaluateGuard(");
    const decideIdx = slice.indexOf("decideLargeDocumentGuard(");
    const switchIdx = slice.indexOf("switch (");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(decideIdx).toBeGreaterThan(-1);
    expect(switchIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeLessThan(decideIdx);
    expect(slice).toMatch(
      /shouldEvaluateGuard\(\s*viewMode\s*,\s*activeDocument\.id\s*,\s*useEditorStore\.getState\(\)\s*\)/,
    );

    expect(slice.match(/sourceTableVerdictOf\(\s*viewMode\s*,\s*decision\s*\)/g) ?? []).toHaveLength(1);
    expect(slice.match(/recordSourceTableVerdict\(activeDocument\.id/g) ?? []).toHaveLength(1);
    const verdictIdx = slice.search(/sourceTableVerdictOf\(\s*viewMode\s*,\s*decision\s*\)/);
    const recordIdx = slice.indexOf("recordSourceTableVerdict(activeDocument.id");
    for (const idx of [verdictIdx, recordIdx]) {
      expect(idx).toBeGreaterThan(skipIdx);
      expect(idx).toBeLessThan(switchIdx);
    }
    expect(slice.slice(switchIdx)).not.toContain("recordSourceTableVerdict(");
  });

  it("C15: the withhold arm is latch-gated, logs before the toast, and never changes mode", () => {
    const slice = guardEffectSlice();

    const degradeIdx = slice.indexOf('case "degrade-to-source":');
    const withholdIdx = slice.indexOf('case "withhold-table-extensions":');
    expect(degradeIdx).toBeGreaterThan(-1);
    expect(withholdIdx).toBeGreaterThan(degradeIdx);

    const armEnd = slice.indexOf("}", withholdIdx);
    expect(armEnd).toBeGreaterThan(withholdIdx);
    const arm = slice.slice(withholdIdx, armEnd);
    const code = arm.replace(/\/\/.*$/gm, "").replace(/\s/g, "");

    expect(code.startsWith('case"withhold-table-extensions":if(!firstVerdict)return;')).toBe(true);

    const logIdx = arm.indexOf("buildSourceTablesWithheldLog(");
    const toastIdx = arm.indexOf("showToast(");
    expect(logIdx).toBeGreaterThan(-1);
    expect(toastIdx).toBeGreaterThan(-1);
    expect(logIdx).toBeLessThan(toastIdx);
    expect(arm).toMatch(/buildSourceTablesWithheldLog\(\s*decision\s*,/);
    expect(arm).toContain("showToast(decision.message)");
    expect(arm).not.toContain("setViewMode(");
  });

  it("C2'': the withhold threshold, copy and verdict values never arrive in App", () => {
    const src = readSrc(APP_PATH);

    expect(src).not.toMatch(/50[_,]?000/);
    expect(src).not.toContain("too many table rows");
    expect(src).not.toContain("Table editing tools are turned off");
    expect(src).not.toContain('"allowed"');
    expect(src).not.toContain('"withheld"');
  });

  it("C6b: the case labels are allow, degrade, withhold — in that order, with no default", () => {
    const slice = guardEffectSlice();

    const labels = [...slice.matchAll(/case\s+"([^"]+)"\s*:/g)].map((m) => m[1]);
    expect(labels).toEqual(["allow", "degrade-to-source", "withhold-table-extensions"]);
    expect(slice).not.toMatch(/default\s*:/);
  });
});

describe("guard log builders carry the active document id (source-text Gate)", () => {
  it("C18: both builder calls pass activeDocument.id as the third argument", () => {
    // Supplement to W10 / L9: the builders forward whatever id they are given;
    // this pins that App gives them the active document's id, and nothing
    // derived from its content.
    const slice = guardEffectSlice();
    const call = (name: string) =>
      new RegExp(
        `${name}\\(\\s*decision\\s*,\\s*loggingService\\.generateActionId\\(\\)\\s*,\\s*activeDocument\\.id\\s*,?\\s*\\)`,
        "g",
      );
    expect(slice.match(call("buildLargeDocumentDegradeLog")) ?? []).toHaveLength(1);
    expect(slice.match(call("buildSourceTablesWithheldLog")) ?? []).toHaveLength(1);
  });
});
