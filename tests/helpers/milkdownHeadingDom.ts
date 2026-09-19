/**
 * Purpose: build the `#milkdown-container > .ProseMirror > hN*` DOM shape that
 * `App.tsx:139-140` wires in WYSIWYG mode, from `(level, text, id)` triples.
 *
 * Filed by `.claude/tdd-guardian/tests-20260919-114230.md` §0.2 as a **shared** helper.
 * It lives under `tests/helpers/` — outside `vitest.config.ts`'s
 * `include: ["tests/**\/*.test.{ts,tsx}"]` glob — so importing it from two test files
 * does not re-register anybody's suites. `tsconfig.test.json` covers `tests`, so it is
 * typechecked by `pnpm typecheck:tests`.
 *
 * WI-3.6.1 left an equivalent builder inline in `tests/toc-element-resolution.test.ts`
 * as `buildProseMirror`. That file's lines are fingerprinted by WI-3.6.1's red receipt,
 * so it is **deliberately not** refactored onto this helper: editing it would register
 * as a specification change for a work item that is already closed. Duplication of
 * twenty lines is the cheaper of the two costs.
 *
 * ---------------------------------------------------------------------------
 * On the DOM ids callers pass in (matrix §0.5)
 * ---------------------------------------------------------------------------
 * Every id in a fixture is a **transcribed literal**, never a mounted editor's output:
 * by the measured properties P1/P2 (`src/utils/tocElementResolution.ts` header) Milkdown
 * rewrites heading ids in a dispatched transaction on every doc change, so a mounted
 * editor would make the fixtures timing-dependent. Rows the matrix labels *measured*
 * were printed by a real editor on 2026-09-19; rows labelled *derived* were computed
 * from `defaultHeadingIdGenerator` plus `syncHeadingIdPlugin`'s `-#n` dedupe. Because
 * the code under test reads no ids at all, an outdated transcription can only weaken
 * realism — it can never produce a false green. `id: null` (or omitted) means the
 * attribute is genuinely **absent**, which is P3's shape for an empty heading.
 *
 * @coordinates-with tests/use-toc-navigation-identity.test.ts
 * @coordinates-with tests/use-toc-scroll-spy-identity.test.ts
 */

/** One heading element to build. `id: null`/omitted ⇒ no `id` attribute at all (P3). */
export interface MilkdownHeadingSpec {
  level: number;
  text: string;
  id?: string | null;
  /**
   * Measured `null` on every editor-surface heading. A fixture sets it only to prove
   * the code under test does **not** read it — an attribute that is always absent
   * cannot distinguish "not read" from "read and useless".
   */
  dataHeadingId?: string | null;
}

export interface MilkdownDomFixture {
  /** The element `document.getElementById(containerId)` finds. */
  container: HTMLElement;
  /** `null` when built with `withProseMirror: false` — the remount window. */
  proseMirror: HTMLElement | null;
  /** The `hN` elements, in document order. Empty when there is no `.ProseMirror`. */
  headings: HTMLElement[];
}

export interface BuildMilkdownDomOptions {
  containerId?: string;
  /**
   * `false` reproduces the document-switch remount window: `MilkdownProvider` is torn
   * down while `#milkdown-container` — and any open modal inside it — survives. The
   * only state in which today's `proseMirror || container` fallback reaches a modal
   * title. Specs must be empty in that case; there is nowhere legitimate to put them.
   */
  withProseMirror?: boolean;
}

export const DEFAULT_CONTAINER_ID = "milkdown-container";

/** Build the fixture **detached** from `document`. */
export function buildMilkdownDom(
  specs: ReadonlyArray<MilkdownHeadingSpec> = [],
  options: BuildMilkdownDomOptions = {},
): MilkdownDomFixture {
  const { containerId = DEFAULT_CONTAINER_ID, withProseMirror = true } = options;

  const container = document.createElement("div");
  container.id = containerId;

  if (!withProseMirror) {
    if (specs.length > 0) {
      throw new Error(
        "buildMilkdownDom: headings were requested with withProseMirror: false. " +
          "There is no legitimate place for a document heading outside .ProseMirror; " +
          "put modal/dialog nodes in with appendDialogTitle instead.",
      );
    }
    return { container, proseMirror: null, headings: [] };
  }

  const proseMirror = document.createElement("div");
  proseMirror.className = "ProseMirror";
  container.appendChild(proseMirror);

  const headings = specs.map((spec) => createHeading(spec, proseMirror));
  return { container, proseMirror, headings };
}

/** Build the fixture and append it to `document.body`. */
export function mountMilkdownDom(
  specs: ReadonlyArray<MilkdownHeadingSpec> = [],
  options: BuildMilkdownDomOptions = {},
): MilkdownDomFixture {
  const fixture = buildMilkdownDom(specs, options);
  document.body.appendChild(fixture.container);
  return fixture;
}

/** Remove the fixture's container from wherever it is. */
export function unmountMilkdownDom(fixture: MilkdownDomFixture): void {
  fixture.container.remove();
}

/**
 * Append one heading to an existing `.ProseMirror` and return it.
 *
 * Used where a case mutates the DOM between passes rather than rebuilding it.
 */
export function appendHeading(
  fixture: MilkdownDomFixture,
  spec: MilkdownHeadingSpec,
): HTMLElement {
  if (!fixture.proseMirror) {
    throw new Error("appendHeading: this fixture has no .ProseMirror");
  }
  const el = createHeading(spec, fixture.proseMirror);
  fixture.headings.push(el);
  return el;
}

/**
 * The open-modal shape `MilkdownEditor.tsx:302-313` renders *inside*
 * `#milkdown-container`: `<div class="dialog-card"><h3 class="dialog-title">…</h3></div>`.
 * Returns the `<h3>` so a case can assert it never receives a navigation.
 */
export function appendDialogTitle(
  fixture: MilkdownDomFixture,
  title: string,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "dialog-card";
  const heading = document.createElement("h3");
  heading.className = "dialog-title";
  heading.textContent = title;
  card.appendChild(heading);
  fixture.container.appendChild(card);
  return heading;
}

function createHeading(spec: MilkdownHeadingSpec, parent: Element): HTMLElement {
  const el = document.createElement(`h${spec.level}`);
  el.textContent = spec.text;
  if (spec.id != null) el.id = spec.id;
  if (spec.dataHeadingId != null) {
    el.setAttribute("data-heading-id", spec.dataHeadingId);
  }
  parent.appendChild(el);
  return el;
}
