/**
 * WI-1 (+ WI-5's export half) — the ordering law for `ExportSettings`.
 *
 * ## The law
 *
 * *Last action wins, per field.* Fold every **resolved** `set_preferences`
 * payload in issue order over the preferences `get_preferences` returned; for
 * every field the user acted on, the folded value must equal the value of the
 * user's **most recent** action on that field. Plus *conservation*: no group the
 * user did not touch may differ from what was loaded, and no payload may carry a
 * group the user did not touch.
 *
 * The law has two halves and a naive fix satisfies only one:
 *
 * - **no-stale-revert** — the fold must not carry a pre-change value for a field
 *   changed later (defeated by today's code: the 500 ms debounce captures the
 *   whole export group and replays the stale snapshot over a newer sibling write);
 * - **no-lost-update** — the fold must still carry the final text value
 *   (defeated by a "just `clearTimeout` in the bool handler and stop" fix).
 *
 * It is stated as a fold rather than per-call payload equality on purpose: a
 * legitimate fix may change write count or timing. It may **not** change write
 * *granularity*. `merge_preferences` is a whole-group replace and
 * `ExportConfig.html_include_styles` carries `#[serde(default = …)] → true`, so a
 * per-leaf payload `{ export: { defaultFolder } }` silently resurrects `true` over
 * a user's `false` — the very defect under repair, relocated into the serde layer.
 * `recorder.fold()` runs `assertGroupsComplete` first, so a per-leaf fix fails
 * every case here. That backend fact is pinned from the Rust side by F-D in
 * `src-tauri/src/services/preferences_fold_contract_tests.rs`.
 *
 * ## WI-5's intent, stated because the two outcomes are indistinguishable
 *
 * On unmount the pending debounced write is **DISCARDED, not flushed**. A flush
 * would also produce "no state update on an unmounted component", so nothing in
 * the observable behaviour distinguishes the two without a stated intent. Discard
 * is chosen to match the rest of the settings dialog's posture: *no write the
 * user cannot see the result of*. Closing the dialog mid-keystroke abandons the
 * keystroke; it does not silently commit it after the surface is gone.
 *
 * ## Scope — what a green suite here proves
 *
 * These tests set the `isTauri` spy (`tests/support/tauriCoreMock.ts`) true in
 * `beforeEach` to force the real `preferencesService` down its Tauri branch and
 * make the boundary observable. Since ADR-0031 step 5b (D24) the shipping app
 * takes that branch too, so these payloads are what reaches `set_preferences`.
 * Whether the packaged WebView carries the `isTauri` marker is verified only by
 * the ADR-0032 GUI run; the Rust half is `commands/preferences_tests.rs`
 * (matrix § 0.6).
 *
 * ## Mock boundary
 *
 * Exactly one: `@tauri-apps/api/core#invoke`, a genuine system boundary, answered
 * by the shared recorder (`tests/support/preferenceRecorder.ts`). `exportService`,
 * `preferencesService`, `toastStore` and `loggingService` are all **real** — the
 * `pick_export_folder` call is answered by the same recorder, so the picker path
 * exercises the real service too.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";

import type { ExportConfig, UserPreferences } from "../src/types/preferences";
import type { PreferenceRecorder, UserAction } from "./support/preferenceRecorder";

let recorder: PreferenceRecorder;

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args?: unknown) => recorder.invoke(cmd, args),
}));

import { ExportSettings } from "../src/components/common/settings/ExportSettings";
import { useToastStore } from "../src/stores/toastStore";
import { makePreferences } from "./support/preferenceFixtures";
import { assertNoSupersededPayload, createRecorder } from "./support/preferenceRecorder";

/** The component's debounce window. Named so no assertion carries a bare 500. */
const DEBOUNCE_MS = 500;

/**
 * The panel's inline note, located by ROLE rather than by text.
 *
 * Rule 30 §5 gives one event exactly one signal. This panel has two distinct
 * events and they resolve differently:
 *
 * - **save failure** → `preferencesService` raises {@link SERVICE_TOAST}, so the
 *   inline note must be **absent** (WI1-J). Two signals for one event is the
 *   violation the rule names outright.
 * - **load failure** → no toast is raised anywhere, so the inline note is that
 *   event's **sole** signal and must be **present** (WI1-K).
 *
 * Located by role because the earlier version of this constant matched the
 * literal string `/failed to save export settings/i`, which the fix deleted from
 * the source. A negative assertion against a string that exists nowhere is
 * vacuous: it stays green whether or not the panel renders an inline note, and
 * it stays green if someone re-adds one under different wording — which is the
 * exact regression it was supposed to prevent. The role is the stable contract;
 * the wording is not. Since WI-4.3b the load-failure line is the shared
 * `SettingsLoadFailed`, an alert (it was a status note before).
 */
const inlineNote = () => screen.queryByRole("alert");

/** The single signal `preferencesService` raises for a failed write. */
const SERVICE_TOAST = /failed to save preferences/i;

/** The stored export group every case starts from. */
const EXPORT_BASE: ExportConfig = { defaultFolder: "/old", htmlIncludeStyles: true };

let basePrefs: UserPreferences;
let toastMessages: string[];
let unsubscribeToast: (() => void) | null;

function setupRecorder(exportGroup: ExportConfig = { ...EXPORT_BASE }): void {
  basePrefs = makePreferences({ export: { ...exportGroup } });
  recorder = createRecorder(basePrefs);
}

function setupUser() {
  // Both options are mandatory (matrix § 0.4). Without `advanceTimers`,
  // userEvent's internal delay never resolves under fake timers and the test
  // hangs to timeout. Without `delay: null`, userEvent advances timers between
  // keystrokes and fires the 500 ms debounce mid-word, which would make the
  // coalescing cases measure the harness instead of the component.
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
}

/**
 * MEASURED HARNESS FACT, and a correction to matrix § 0.4.
 *
 * `advanceTimers` is necessary but **not sufficient** in this repo: with it alone
 * every `userEvent` call still deadlocks to the 5 s timeout. The cause is not
 * userEvent's delay. `@testing-library/react`'s `asyncWrapper` (pure.js:84-104)
 * wraps every userEvent API in
 *
 *     await new Promise(resolve => {
 *       setTimeout(resolve, 0);
 *       if (jestFakeTimersAreEnabled()) jest.advanceTimersByTime(0);
 *     });
 *
 * and `jestFakeTimersAreEnabled()` (pure.js:62) short-circuits on
 * `typeof jest !== "undefined"`. Under Vitest there is no `jest` global, so RTL
 * concludes timers are real, schedules a `setTimeout(…, 0)` onto the **fake**
 * clock, and nothing ever advances it.
 *
 * The shim below is the smallest thing that restores the intended behaviour: it
 * makes RTL's own detection true and hands it a working pump. It changes nothing
 * about what the component does — it only lets RTL drain its microtask queue.
 * `vitest.config.ts` sets `unstubGlobals: true`, and `afterEach` unstubs anyway.
 */
function installReactTestingLibraryTimerPump(): void {
  vi.stubGlobal("jest", {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  });
}

/** Flush the promise chain (invoke → service → component) inside `act`. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await settle();
}

/**
 * Mount and wait out the initial `get_preferences`.
 *
 * Explicit flush rather than `findByRole`: testing-library's `waitFor` timer
 * interop is a second variable in an already-delicate fake-timer harness
 * (matrix § 0.5).
 */
async function mountPanel() {
  const result = render(<ExportSettings />);
  await settle();
  return result;
}

const folderInput = () =>
  screen.getByRole("textbox", { name: /Default Export Folder/i });
const stylesCheckbox = () =>
  screen.getByRole("switch", { name: /Include Styles/i });
const browseButton = () => screen.getByRole("button", { name: /Browse/i });

type ActionId = "T" | "B" | "P";

/**
 * Replace the textbox contents.
 *
 * `userEvent.type` appends, and the input is controlled and pre-seeded, so "set
 * the folder to X" is clear-then-type. Both events land inside one debounce
 * window, so this is still a single coalesced edit.
 */
async function replaceFolder(
  user: ReturnType<typeof setupUser>,
  value: string,
): Promise<void> {
  await user.clear(folderInput());
  await user.type(folderInput(), value);
}

/**
 * Record a user action for the § 0.3.1 per-seq supplement, then perform it.
 *
 * The seq is captured **before** the action, because `UserAction.seq` means "this
 * action precedes every call whose seq is at least this value". Capturing it
 * afterwards would exclude the action's own write from the check.
 *
 * A typing burst is logged as one action carrying its final value: the burst
 * issues no calls of its own (the debounce has not fired), so no payload exists
 * for the intermediate values to constrain.
 */
async function runAction(
  user: ReturnType<typeof setupUser>,
  id: ActionId,
  actions: UserAction[],
): Promise<void> {
  if (id === "T") {
    actions.push({ seq: recorder.calls.length, field: "export.defaultFolder", value: "/new" });
    await replaceFolder(user, "/new");
    return;
  }
  if (id === "B") {
    actions.push({
      seq: recorder.calls.length,
      field: "export.htmlIncludeStyles",
      value: false,
    });
    await user.click(stylesCheckbox());
    await settle();
    return;
  }
  actions.push({
    seq: recorder.calls.length,
    field: "export.defaultFolder",
    value: "/picked",
  });
  await user.click(browseButton());
  await settle();
}

/** Independent expectation: replay the actions over the base by hand. */
function expectedExport(ids: ActionId[]): ExportConfig {
  let defaultFolder = EXPORT_BASE.defaultFolder;
  let htmlIncludeStyles = EXPORT_BASE.htmlIncludeStyles;
  for (const id of ids) {
    if (id === "T") defaultFolder = "/new";
    if (id === "P") defaultFolder = "/picked";
    if (id === "B") htmlIncludeStyles = false;
  }
  return { defaultFolder, htmlIncludeStyles };
}

const ORDERED_PAIRS: Array<[ActionId, ActionId]> = [
  ["T", "B"],
  ["B", "T"],
  ["T", "P"],
  ["P", "T"],
  ["B", "P"],
  ["P", "B"],
];

beforeEach(() => {
  vi.useFakeTimers();
  installReactTestingLibraryTimerPump();
  setupRecorder();
  useToastStore.getState().clearToast();
  toastMessages = [];
  unsubscribeToast = useToastStore.subscribe((state) => {
    // Record EVERY emission. Deliberately not de-duplicated against the
    // previous message: `showToast` calls `set({ message })` unconditionally
    // (`src/stores/toastStore.ts:13-20`), so two identical "Failed to save
    // preferences" toasts fire two subscriber callbacks. A
    // `state.message !== prev.message` guard collapses them into one, which
    // makes the exact rule 30 §5 duplicate these cases exist to catch
    // invisible. `tests/use-theme-apply-and-persist.test.ts:191-204` already
    // states this; the guard here contradicted it. Corrected 2026-09-24.
    if (state.message !== null) {
      toastMessages.push(state.message);
    }
  });
  // Force the real preferencesService down its Tauri branch so the boundary is
  // observable at all (plan § Framing, point 2).
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(() => {
  unsubscribeToast?.();
  unsubscribeToast = null;
  useToastStore.getState().clearToast();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ExportSettings — last action wins, per field", () => {
  // WI1-A. Exhaustive over the ordered pairs of the three writers. Rows T→B and
  // T→P are the reproducers; the other four are non-regression guards against a
  // one-directional fix, and are expected green before the fix as well.
  it.each(ORDERED_PAIRS)(
    "WI1-A: %s then %s inside one debounce window folds to both latest values",
    async (first, second) => {
      recorder.set("pick_export_folder", "/picked");
      const user = setupUser();
      await mountPanel();

      const actions: UserAction[] = [];
      await runAction(user, first, actions);
      await runAction(user, second, actions);
      await advance(DEBOUNCE_MS);

      expect(recorder.fold().export).toEqual(expectedExport([first, second]));
      // § 0.3.1 supplement: the fold is a final-state oracle, so it cannot see a
      // stale payload that a later write happens to correct. This forbids the
      // defect's per-seq signature. Supplement, never the law.
      assertNoSupersededPayload(recorder.allWrites(), actions);
    },
  );

  it("WI1-B: a three-action sequence loses neither the bool nor the later keystrokes", async () => {
    const user = setupUser();
    await mountPanel();

    await replaceFolder(user, "/a");
    await user.click(stylesCheckbox());
    await settle();
    await user.type(folderInput(), "b");
    await advance(DEBOUNCE_MS);

    expect(recorder.fold().export).toEqual({
      defaultFolder: "/ab",
      htmlIncludeStyles: false,
    });
  });

  it("WI1-C: no-lost-update — an uninterleaved edit still reaches the boundary", async () => {
    const user = setupUser();
    await mountPanel();

    await replaceFolder(user, "/new");
    await advance(DEBOUNCE_MS);

    // The length check is the guard against the degenerate "cancel the timer and
    // never write" fix, which would satisfy every ordering case above.
    expect(recorder.writes().length).toBeGreaterThanOrEqual(1);
    expect(recorder.fold().export.defaultFolder).toBe("/new");
  });

  it.each([
    {
      row: "three keystrokes inside one window coalesce to one write",
      typed: ["abc"] as const,
      expectedWrites: 1,
      expectedFolder: "/oldabc",
    },
    {
      row: "a window elapsing between keystrokes produces two writes",
      typed: ["a", "b"] as const,
      expectedWrites: 2,
      expectedFolder: "/oldab",
    },
  ])("WI1-D: $row", async ({ typed, expectedWrites, expectedFolder }) => {
    const user = setupUser();
    await mountPanel();

    for (const chunk of typed) {
      await user.type(folderInput(), chunk);
      await advance(DEBOUNCE_MS);
    }

    // The count *is* the behaviour under test here (coalescing), which is why
    // pinning it is legitimate; every other case deliberately avoids counts.
    expect(recorder.writes()).toHaveLength(expectedWrites);
    expect(recorder.fold().export.defaultFolder).toBe(expectedFolder);
  });
});

describe("ExportSettings — failure paths keep the panel honest", () => {
  it.each([
    { row: "rejected", fails: true, checked: true, folded: true },
    { row: "resolved", fails: false, checked: false, folded: false },
  ])(
    "WI1-E: the bool rollback is preserved and is a real toggle ($row)",
    async ({ fails, checked, folded }) => {
      const user = setupUser();
      await mountPanel();
      if (fails) recorder.failCommand("set_preferences", new Error("EACCES"));

      await user.click(stylesCheckbox());
      await settle();

      if (checked) expect(stylesCheckbox()).toBeChecked();
      else expect(stylesCheckbox()).not.toBeChecked();
      expect(recorder.fold().export.htmlIncludeStyles).toBe(folded);
    },
  );

  it("WI1-E′: a rollback landing mid-edit must not revert the textbox under the user", async () => {
    const user = setupUser();
    await mountPanel();

    const pending = recorder.defer("set_preferences");
    await user.click(stylesCheckbox());
    await settle();
    await replaceFolder(user, "/new");

    pending.reject(new Error("EACCES"));
    await settle();
    await advance(DEBOUNCE_MS);

    // Load-bearing, not supplementary: the fold alone is green here even with the
    // defect present, because the armed timer does persist "/new". What breaks is
    // that a whole-group rollback snapshot captured before the keystrokes reverts
    // the textbox to "/old" under the cursor — screen and disk then diverge with
    // no further event to reconcile them.
    expect(folderInput()).toHaveValue("/new");
    expect(stylesCheckbox()).toBeChecked();
    expect(recorder.fold().export).toEqual({
      defaultFolder: "/new",
      htmlIncludeStyles: true,
    });
  });

  it("WI1-L: a same-leaf rollback must not revert a newer edit to that same leaf", async () => {
    const user = setupUser();
    await mountPanel();

    // Without this the picker call rejects, `handleBrowse` returns early, and
    // the deferral below would capture the DEBOUNCE write instead — a different
    // test that happens to be green.
    recorder.set("pick_export_folder", "/picked");

    // Browse writes `defaultFolder`, and its write is held open.
    const pending = recorder.defer("set_preferences");
    await user.click(browseButton());
    await settle();

    // The user keeps typing into the SAME field while that write is in flight.
    await replaceFolder(user, "/typed");

    pending.reject(new Error("EACCES"));
    await settle();
    await advance(DEBOUNCE_MS);

    // WI1-E' pins the SIBLING arm: a bool write fails, and the folder edit
    // survives because `rollbackLeaf` rebuilds siblings from the current group.
    // This is the SAME-LEAF arm, which that mechanism does not cover: both
    // `handleBrowse` and the debounce target `defaultFolder`, so restoring the
    // leaf's schedule-time value reverts the textbox under the cursor AND the
    // armed debounce then persists the reverted value. Screen and disk end up
    // agreeing on a folder the user never chose, which is worse than a visible
    // divergence because nothing is left to reconcile.
    expect(folderInput()).toHaveValue("/typed");
    expect(recorder.fold().export).toEqual({
      defaultFolder: "/typed",
      htmlIncludeStyles: true,
    });
  });

  it("WI1-G: a rejected sibling write does not discard the pending text edit", async () => {
    const user = setupUser();
    await mountPanel();

    await replaceFolder(user, "/new");
    recorder.failNext("set_preferences", new Error("EACCES"));
    await user.click(stylesCheckbox());
    await settle();
    await advance(DEBOUNCE_MS);

    // A fix that merely calls clearTimeout in the bool handler folds to "/old"
    // here and fails: a user who typed a folder must not lose it because an
    // unrelated checkbox write failed.
    expect(recorder.fold().export).toEqual({
      defaultFolder: "/new",
      htmlIncludeStyles: true,
    });
    expect(stylesCheckbox()).toBeChecked();
  });

  it("WI1-J: a failed debounced write keeps the controls and reports through the toast alone", async () => {
    const user = setupUser();
    await mountPanel();

    await replaceFolder(user, "/new");
    recorder.failCommand("set_preferences", new Error("EACCES"));
    await advance(DEBOUNCE_MS);

    // The defect: this branch used to replace the entire pane with a dead error
    // paragraph. Every control stays mounted, operable, and holding the value.
    expect(folderInput()).toBeInTheDocument();
    expect(stylesCheckbox()).toBeInTheDocument();
    expect(folderInput()).toHaveValue("/new");

    // One signal per event (rule 30 §5): the service's toast, and nothing else.
    // The absent inline note is the load-bearing half — an inline note *plus*
    // the toast is two signals for one event, which the rule forbids outright.
    expect(inlineNote()).toBeNull();
    expect(toastMessages).toHaveLength(1);
    expect(toastMessages[0]).toMatch(SERVICE_TOAST);

    // Still usable afterwards: the next write succeeds, lands, and — since the
    // failure was never latched into panel state — raises no second toast.
    recorder.clearFailCommand("set_preferences");
    await user.type(folderInput(), "2");
    await advance(DEBOUNCE_MS);

    expect(folderInput()).toHaveValue("/new2");
    expect(toastMessages).toHaveLength(1);
  });

  /**
   * WI1-K — the positive half that makes WI1-J's negative mean something.
   *
   * WI1-J asserts the inline note is absent after a failed *save*. On its own
   * that assertion cannot distinguish "the panel correctly declined to render a
   * second signal" from "this panel has no inline note at all, and never did" —
   * deleting the entire `error` branch from the component would leave WI1-J
   * green. This case pins the other side: the note is reachable, and the *load*
   * failure is what reaches it.
   *
   * It also pins the rule-30-§5 compliance of the load path from the opposite
   * direction. A load failure raises no toast, so the inline note is not a
   * second signal there — it is the only one. If a future change made
   * `getPreferences` raise a toast too, this case's `toHaveLength(0)` turns red,
   * which is the point.
   */
  it("WI1-K: a failed LOAD renders the inline note as the event's only signal", async () => {
    recorder.failCommand("get_preferences", new Error("EACCES reading config"));
    await mountPanel();

    // Present, with the shared copy; the raw reason goes to the log only
    // (WI-4.3b, rule 30 rule 3).
    const note = inlineNote();
    expect(note).not.toBeNull();
    expect(note).toHaveTextContent("Failed to load preferences. Please close and reopen settings.");
    expect(note).not.toHaveTextContent(/EACCES/);

    // Sole signal: nothing else fired for this event.
    expect(toastMessages).toHaveLength(0);

    // A load failure leaves no values, so the controls genuinely cannot render —
    // unlike the save path, where their absence was the defect. The busy note is
    // suppressed too, so the error is not competing with a spinner.
    expect(screen.queryByRole("textbox", { name: /Default Export Folder/i })).toBeNull();
    expect(screen.queryByRole("switch", { name: /Include Styles/i })).toBeNull();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();

    // No write is attempted off a failed load — the panel has nothing to send,
    // and sending defaults here is precisely how a corrupt read becomes a
    // corrupt write (ADR-0031 step 1, same failure shape on the Rust side).
    expect(recorder.calls.filter((c) => c.cmd === "set_preferences")).toHaveLength(0);
  });
});

describe("ExportSettings — conservation and async windows", () => {
  it.each(ORDERED_PAIRS)(
    "WI1-F: %s then %s touches no group but export",
    async (first, second) => {
      recorder.set("pick_export_folder", "/picked");
      const user = setupUser();
      await mountPanel();

      const actions: UserAction[] = [];
      await runAction(user, first, actions);
      await runAction(user, second, actions);
      await advance(DEBOUNCE_MS);

      const { export: _folded, ...foldedRest } = recorder.fold();
      const { export: _base, ...baseRest } = basePrefs;
      expect(foldedRest).toEqual(baseRest);

      // Constrains the key set of every payload, so it is not satisfiable by
      // returning the expected value: a fix that sends a whole cached
      // UserPreferences instead of the export group fails here.
      for (const write of recorder.allWrites()) {
        expect(Object.keys(write.payload)).toEqual(["export"]);
      }
    },
  );

  it.each([
    { row: "Browse… first, then the checkbox", browseFirst: true },
    { row: "the checkbox first, then Browse…", browseFirst: false },
  ])(
    "WI1-I: an action during the picker await is not reverted by its stale snapshot ($row)",
    async ({ browseFirst }) => {
      const user = setupUser();
      await mountPanel();

      const picker = recorder.defer("pick_export_folder");
      if (browseFirst) {
        await user.click(browseButton());
        await settle();
        await user.click(stylesCheckbox());
        await settle();
      } else {
        await user.click(stylesCheckbox());
        await settle();
        await user.click(browseButton());
        await settle();
      }

      picker.resolve("/picked");
      await settle();
      await advance(DEBOUNCE_MS);

      expect(recorder.fold().export).toEqual({
        defaultFolder: "/picked",
        htmlIncludeStyles: false,
      });
      expect(stylesCheckbox()).not.toBeChecked();
    },
  );
});

describe("ExportSettings — WI-5: unmount DISCARDS the pending write", () => {
  it("WI1-H: unmounting inside the window issues no further write and never sends the typed value", async () => {
    const user = setupUser();
    const { unmount } = await mountPanel();

    await replaceFolder(user, "/new");
    const before = recorder.writes().length;

    unmount();
    await advance(DEBOUNCE_MS);

    expect(recorder.writes()).toHaveLength(before);
    // The content scan is what makes the count assertion non-vacuous: a write
    // issued before the unmount would keep the count equal while still having
    // sent the value the user abandoned.
    const carried = recorder
      .allWrites()
      .filter((write) => write.payload.export?.defaultFolder === "/new");
    expect(carried).toEqual([]);
    expect(recorder.fold().export).toEqual(EXPORT_BASE);
  });

  it("WI1-H: that sequence logs no React unmounted-state warning", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = setupUser();
    const { unmount } = await mountPanel();

    await replaceFolder(user, "/new");
    unmount();
    await advance(DEBOUNCE_MS);

    expect(consoleError.mock.calls).toEqual([]);
    consoleError.mockRestore();
  });
});
