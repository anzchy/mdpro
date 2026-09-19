/**
 * D6.3 / WI-2 — the `App.tsx` WYSIWYG large-document guardrail is a THIN CALLER
 * of `src/utils/largeDocumentGuard.ts`, and the frozen constants have exactly
 * one home each.
 *
 * ── SPEC LEVEL: EVERY CASE IN THIS FILE IS BELOW LEVEL 6 ────────────────────
 *
 * Every assertion here is SOURCE-TEXT INSPECTION. These cases read
 * `src/App.tsx` and `src/utils/largeDocumentGuard.ts` off disk as strings and
 * match them. Nothing here renders `App`, runs the effect, or observes
 * `showToast` / `setViewMode`.
 *
 * What these cases CANNOT prove — enumerated so nobody re-derives the omission
 * as a deliberate limit:
 *   - cannot prove the effect ever runs;
 *   - cannot prove the dependency array causes it to run at the right times;
 *   - cannot prove the two side effects fire, or fire in order, at runtime;
 *   - cannot prove a later effect does not undo the mode flip;
 *   - cannot prove the values passed into the predicate are the *active
 *     document's* at runtime. C8 pins the argument TEXT, not the runtime
 *     values: `activeDocument` could be shadowed or stale and C8 stays green.
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
 * The guardrail entirely dismantled, and the suite passing. C2 is an ABSENCE
 * check on the message, so it passes MORE easily with the wrong string than
 * with the right one. The arguments were the gap; C8 closes it.
 *
 * ── WHERE THE BEHAVIOURAL WEIGHT ACTUALLY SITS ─────────────────────────────
 *
 *   - `tests/large-document-guard.test.ts` — WI-1's 23 executable Level 1/S4/S5
 *     cases over the predicate itself.
 *   - Runtime wiring is MANUAL QA: open a >500 KB `.md` in `pnpm tauri dev`,
 *     confirm the mode flips to Source and the toast reads exactly
 *     "Document exceeds 500KB. Switched to Source mode for performance.";
 *     then open a ~400 KB file and confirm nothing happens.
 *
 * ANYONE READING A GREEN RUN OF THIS FILE AS PROOF THAT THE GUARDRAIL WORKS IS
 * MISREADING IT.
 *
 * ── SCOPE LOCK ─────────────────────────────────────────────────────────────
 *
 * `500 * 1024`, the `<=` direction, and "bytes, with on-disk `fileSize` taking
 * precedence" are FROZEN pending D6.1's WKWebView sweep
 * (ADR-0006 `:107-113`, `:201-203`). These cases pin current behaviour; they do
 * not endorse the number.
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
 * The shared slice used by C3-C6, C8 and C9, and the home of case C10.
 *
 * Slicing is MANDATORY, not hygiene: `if (!activeDocument) return;` occurs
 * three times in `App.tsx` (`:483`, `:512`, `:586`), so a whole-file
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
 * and `effectStart` falls back to the `decideFileChange` effect at `:482`. That
 * neighbour then donates the exact two anchors the guardrail just lost —
 * `if (!activeDocument) return;` at `:483` satisfies C5 and
 * `switch (decision.action)` at `:485` satisfies C6 — and every case passes
 * while production throws `TypeError: Cannot read properties of null (reading
 * 'fileSize')` on every render with no active document.
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

describe("WI-2: large-document guardrail call site (source-text, below Level 6)", () => {
  it("C1: App imports and calls the extracted predicate", () => {
    const src = readSrc(APP_PATH);
    expect(src).toMatch(
      /import\s*\{[^}]*decideLargeDocumentGuard[^}]*\}\s*from\s*["']\.\/utils\/largeDocumentGuard["']/,
    );
    expect(src).toContain(CALL_ANCHOR);
  });

  it("C2: the threshold, the encoder, the message, and the mode test each have exactly one home", () => {
    const src = readSrc(APP_PATH);

    // Whitespace-tolerant regexes, not toContain("500 * 1024"): `500*1024`
    // reintroduces the constant and defeats a literal substring check.
    expect(src).not.toMatch(/500\s*\*\s*1024/);
    expect(src).not.toMatch(/512[_]?000/);
    expect(src).not.toMatch(/TextEncoder/);
    expect(src).not.toMatch(/Document exceeds 500KB/);

    // This is the case in the file that earns its keep: a partially-completed
    // or later-reverted extraction leaves two copies of a frozen constant, and
    // two copies of a frozen constant is precisely how D6.1's future one-line
    // change becomes a two-day bug hunt.
    //
    // Known blind spots, stated: /512[_]?000/ does not catch 0x7D000,
    // `500 << 10`, or a computed spelling — source-text matching cannot be made
    // exhaustive against an adversary; it is aimed at the accident. And the
    // message assertion is an ABSENCE check, so it passes more easily with the
    // WRONG string than with the right one; it cannot tell "moved into the
    // module" from "replaced with something else". C8 makes the positive claim.
    const slice = guardEffectSlice();

    // Narrow, and deliberately not widened: this catches ONE spelling out of at
    // least five. `viewMode === "source"`, `viewMode != "wysiwyg"`,
    // `switch (viewMode)`, and a re-check hoisted outside the slice all pass it
    // untouched. Broadening was rejected because `viewMode` legitimately
    // appears in the slice as an argument (C8 asserts it does), so any regex
    // loose enough to catch the family fires on correct code.
    expect(slice).not.toMatch(/viewMode\s*!==/);
  });

  it("C3: the dependency array is character-for-character unchanged", () => {
    const src = readSrc(APP_PATH);
    // Cannot prove the array is CORRECT — only that it is the one that was
    // reviewed. That is the acceptance criterion and nothing more.
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
    // completely. C8 is what makes the arguments a claim, and C9's arm-order
    // assertion is what keeps this case non-vacuous.
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
    // `activeDocument.fileSize` on null and throws inside an effect.
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
    // that happened for real while C11 was being added. C8b already carries the
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

  it("C8: the call site passes the right arguments — the predicate's inputs and the decision's outputs", () => {
    const slice = guardEffectSlice();

    expect(slice).toContain("fileSize: activeDocument.fileSize");
    expect(slice).toContain("content: activeDocument.content");
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
  });

  it("C8b: the threshold has exactly one home inside the module, too", () => {
    const src = readSrc(MODULE_PATH);

    // The strip is load-bearing, not setup. Without it the third assertion is
    // satisfied by the module header's prose, and this passes in full:
    //   export const LARGE_DOCUMENT_THRESHOLD_BYTES = 500 * 1024;  // decorative
    //   if (bytes <= 512 * 1000) return { action: "allow" };       // the real one
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code.match(/<=/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/bytes\s*<=\s*LARGE_DOCUMENT_THRESHOLD_BYTES/);

    // Enumerates EVERY numeric literal in the comment-stripped code and
    // requires the list to be exactly ["500", "1024"], so 0x7D000, `500 << 10`,
    // `512 * 1000` and a bare 512000 all fail. This is the only enforcement
    // LAW 4 has: at D6.2 the one-line threshold change would otherwise move the
    // constant, redden a few literal anchors, get them "fixed", and leave the
    // predicate comparing against an inlined 512000 — green suite, unmoved
    // threshold, and an ADR recording a change that never shipped.
    expect(code.match(/0x[0-9a-fA-F]+|\b\d[\d_]*\b/g) ?? []).toEqual([
      "500",
      "1024",
    ]);

    // Price paid knowingly: a `500 * 1024` in the header COMMENT no longer
    // trips anything, because comments are stripped first. A comment copy is a
    // documentation-rot problem; a code copy is the D6.2 failure above.
  });

  it("C9: the allow arm does nothing, and the arms are in the order C4 assumes", () => {
    const slice = guardEffectSlice();

    const allowIdx = slice.indexOf('case "allow":');
    const degradeIdx = slice.indexOf('case "degrade-to-source":');

    expect(allowIdx).toBeGreaterThan(-1);
    expect(degradeIdx).toBeGreaterThan(-1);
    expect(allowIdx).toBeLessThan(degradeIdx); // pins arm order; also re-arms C4

    // Admits no statement in the arm. C8 pinned the DEGRADE arm's arguments and
    // left the allow arm unspecified; with it unconstrained, this typechecks
    // and passes every other case:
    //   case "allow":
    //     setViewMode("wysiwyg");   // the whole bug
    //     return;
    // Production effect: Source mode becomes unreachable for every document
    // under 500 KB. `viewMode` is in the dependency array, so Ctrl-2
    // (View -> Source) fires the effect, which immediately forces the user back
    // to WYSIWYG. The large-file degrade still works, which is precisely what
    // lets it survive every test and fail every user.
    expect(slice.slice(allowIdx, degradeIdx).replace(/\s/g, "")).toBe(
      'case"allow":return;',
    );

    // The ordering assertion above is independently valuable and is the part to
    // not skip: it is what makes C4's check non-vacuous. C4 compares
    // indexOf("showToast(") < indexOf("setViewMode(") over the whole slice —
    // swapping the arm order defeats it, and nothing else pins arm order.
  });
});
