/**
 * WI-2 / WI-5: ImageSettings last action wins per leaf, and unrelated stored
 * image leaves survive every patch. The local recorder folds each patch into
 * the latest resolved fake disk group, while allWrites exposes the actual
 * narrow payload to the stale-value assertions. Unmount discards unsaved typing.
 * The only mocked boundary is Tauri invoke; services and component are real.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { ImageSettings } from "../src/components/common/settings/ImageSettings";
import { preferencesService } from "../src/services/preferencesService";
import { useToastStore } from "../src/stores/toastStore";
import { DEFAULT_IMAGE_CONFIG } from "../src/types/preferences";
import type { ImageConfig, UserPreferences } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";
import { assertNoSupersededPayload, createRecorder } from "./support/preferenceRecorder";
import type { PreferenceRecorder, RecordedWrite, UserAction } from "./support/preferenceRecorder";

/** Mirrors `SAVE_DEBOUNCE_MS` in the component; a magic 500 here would drift. */
const SAVE_DEBOUNCE_MS = 500;

/** The stored image group every case but WI2-C / WI2-J starts from. */
const IMAGE_BASE: ImageConfig = {
  assetFolder: "assets",
  copyExternalImages: false,
  showPastePreview: true,
  maxDimension: null,
};

/** Adapt the old disk fold to the new command while exposing actual patch payloads. */
function createPatchRecorder(base: UserPreferences): PreferenceRecorder {
  const disk = createRecorder(base);
  const patches = new Map<number, Partial<UserPreferences>>();
  const writes = (): RecordedWrite[] => disk.allWrites().map((write) => ({
    ...write, payload: patches.get(write.seq) ?? write.payload,
  }));
  return {
    ...disk,
    invoke(cmd, args) {
      if (cmd !== "patch_settings_group") return disk.invoke(cmd, args);
      const { group, patch } = args as { group: string; patch: Partial<ImageConfig> };
      if (group !== "image" || Object.keys(patch).some((key) => !["assetFolder", "copyExternalImages"].includes(key))) {
        return Promise.reject(new Error("image patch contains an unrelated leaf"));
      }
      const seq = disk.calls.length;
      patches.set(seq, { image: structuredClone(patch) as ImageConfig });
      const next = { ...DEFAULT_IMAGE_CONFIG, ...disk.foldUnchecked().image, ...patch };
      return disk.invoke("set_preferences", { preferences: { image: next } }).then(() => next);
    },
    allWrites: writes,
    writes: () => writes().filter((write) => write.outcome === "resolved").map((write) => write.payload),
  };
}

const FOLDER_NAME = /Image Folder/i;
const COPY_NAME = /Copy Images to Folder on Paste/i;

type Harness = {
  recorder: PreferenceRecorder;
  user: ReturnType<typeof userEvent.setup>;
  unmount: () => void;
};

function folderInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: FOLDER_NAME }) as HTMLInputElement;
}

function copyCheckbox(): HTMLInputElement {
  return screen.getByRole("switch", { name: COPY_NAME }) as HTMLInputElement;
}

/** RTL's fake-timer pump checks for `jest`; Vitest needs this shim to drain userEvent. */
function installTimerPump(): void {
  vi.stubGlobal("jest", {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  });
}

/** Drain the invoke → service → component promise chain inside `act`. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
  });
  await flush();
}

/** Mount the panel against a recorder and wait out the initial `get_preferences`. */
async function mount(base: UserPreferences): Promise<Harness> {
  const recorder = createPatchRecorder(base);
  invokeMock.mockImplementation((cmd: string, args?: unknown) => recorder.invoke(cmd, args));
  // `advanceTimers` is mandatory under fake timers (userEvent deadlocks without
  // it); `delay: null` keeps the coalescing cases from firing the debounce
  // mid-word (matrix § 0.4).
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
  const view = render(<ImageSettings />);
  await flush();
  return { recorder, user, unmount: view.unmount };
}

/**
 * The loaded value, expressed as the seq-0 "action" the user's later edits
 * supersede. It makes the § 0.3.1 supplement bite from the first payload: before
 * the user touches a field, every payload must still carry what was loaded.
 */
function loadedActions(image: ImageConfig): UserAction[] {
  return [
    { seq: 0, field: "image.assetFolder", value: image.assetFolder },
    { seq: 0, field: "image.copyExternalImages", value: image.copyExternalImages },
  ];
}

/**
 * Log a user action, then perform it.
 *
 * The seq is captured **before** the action runs, because `UserAction.seq` means
 * "this action precedes every call whose seq is at least this value". Capturing
 * it afterwards would exclude the action's own write from the check — measured:
 * it silently turned the mirror row's supplement into a no-op.
 */
async function logAndRun(
  recorder: PreferenceRecorder,
  actions: UserAction[],
  field: string,
  value: unknown,
  run: () => Promise<void>,
): Promise<void> {
  actions.push({ seq: recorder.calls.length, field, value });
  await run();
}

/**
 * Every toast emission, so a duplicated signal is detectable.
 *
 * NOT de-duplicated against the previous message. `showToast` calls
 * `set({ message })` unconditionally (`src/stores/toastStore.ts:13-20`), so two
 * identical "Failed to save preferences" toasts fire two subscriber callbacks,
 * and a `state.message !== prev.message` guard would record them as one —
 * hiding the exact rule 30 §5 duplicate these cases exist to catch. Corrected
 * 2026-09-24; see the twin in `settings-export-write-ordering.test.tsx`.
 */
function collectToasts(): { messages: string[]; stop: () => void } {
  const messages: string[] = [];
  const stop = useToastStore.subscribe((state) => {
    if (state.message !== null) messages.push(state.message);
  });
  return { messages, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  installTimerPump();
  invokeMock.mockReset();
  useToastStore.setState({ message: null });
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ImageSettings — last action wins across both writers (WI2-A)", () => {
  it("type folder → toggle copy: the fold carries the typed folder and the new bool", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));
    const actions = loadedActions(IMAGE_BASE);

    await logAndRun(recorder, actions, "image.assetFolder", "assetsx", () =>
      user.type(folderInput(), "x"),
    );
    await logAndRun(recorder, actions, "image.copyExternalImages", true, () =>
      user.click(copyCheckbox()),
    );
    await flush();
    await advanceDebounce();

    expect(recorder.fold().image).toEqual({
      assetFolder: "assetsx",
      copyExternalImages: true,
      showPastePreview: true,
      maxDimension: null,
    });
    assertNoSupersededPayload(recorder.allWrites(), actions);
  });

  it("toggle copy → type folder: the fold carries both new values (mirror)", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));
    const actions = loadedActions(IMAGE_BASE);

    await logAndRun(recorder, actions, "image.copyExternalImages", true, () =>
      user.click(copyCheckbox()),
    );
    await flush();
    await logAndRun(recorder, actions, "image.assetFolder", "assetsx", () =>
      user.type(folderInput(), "x"),
    );
    await advanceDebounce();

    expect(recorder.fold().image).toEqual({
      assetFolder: "assetsx",
      copyExternalImages: true,
      showPastePreview: true,
      maxDimension: null,
    });
    assertNoSupersededPayload(recorder.allWrites(), actions);
  });

  it("type → toggle → type keeps the bool and the later keystrokes (WI2-B)", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));

    await user.type(folderInput(), "x");
    await user.click(copyCheckbox());
    await flush();
    await user.type(folderInput(), "y");
    await advanceDebounce();

    const folded = recorder.fold().image;
    expect(folded.assetFolder).toBe("assetsxy");
    expect(folded.copyExternalImages).toBe(true);
  });
});

describe("ImageSettings — the folder validator's equivalence classes (WI2-C)", () => {
  const rejected = ["/etc", "../x", "a/../b", "a\u0000b", "a\u0001b"];
  // Deviation from the matrix, stated rather than glossed: the matrix delivers
  // every row by pasting into an input whose base value is `""`. Pasting `""`
  // into an already-empty input produces no value change and therefore no input
  // event, so that row would assert "one write" against a keystroke that never
  // happened. The empty-string class is delivered by clearing a non-empty input
  // instead — same single input event, same accepted value.
  const accepted = ["assets", "a/b/c", "..foo"];

  it.each(rejected)("rejects %j: no write, and the textbox is unchanged", async (value) => {
    const { recorder, user } = await mount(
      makePreferences({ image: { ...IMAGE_BASE, assetFolder: "" } }),
    );

    await user.click(folderInput());
    await user.paste(value);
    await advanceDebounce();

    expect(recorder.writes()).toHaveLength(0);
    expect(folderInput()).toHaveValue("");
  });

  it.each(accepted)("accepts %j: exactly one write carrying it", async (value) => {
    const { recorder, user } = await mount(
      makePreferences({ image: { ...IMAGE_BASE, assetFolder: "" } }),
    );

    await user.click(folderInput());
    await user.paste(value);
    await advanceDebounce();

    expect(recorder.writes()).toHaveLength(1);
    expect(recorder.fold().image.assetFolder).toBe(value);
  });

  it("accepts the empty folder: exactly one write carrying it", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));

    await user.clear(folderInput());
    await advanceDebounce();

    expect(recorder.writes()).toHaveLength(1);
    expect(recorder.fold().image.assetFolder).toBe("");
  });
});

describe("ImageSettings — a rejected keystroke neither writes nor cancels (WI2-D)", () => {
  it("keeps the pending valid write and never emits the rejected value", async () => {
    const { recorder, user } = await mount(
      makePreferences({ image: { ...IMAGE_BASE, assetFolder: "" } }),
    );

    await user.type(folderInput(), "img");
    await user.paste("/../x");
    await advanceDebounce();

    expect(recorder.writes()).toHaveLength(1);
    expect(recorder.fold().image.assetFolder).toBe("img");
    const emitted = JSON.stringify(recorder.allWrites());
    expect(emitted).not.toContain("..");
    expect(emitted).not.toContain("img/../x");
    expect(folderInput()).toHaveValue("img");
  });
});

describe("ImageSettings — same-leaf rollback (WI2-L)", () => {
  it("a late failure must not restore its own stale value over a newer landed write", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));

    // Three toggles of the SAME leaf. The first write is held open; the two
    // that follow land normally.
    const pending = recorder.defer("set_preferences");
    await user.click(copyCheckbox()); // -> true,  rollback target false
    await flush();
    await user.click(copyCheckbox()); // -> false, lands
    await flush();
    await user.click(copyCheckbox()); // -> true,  lands
    await flush();

    pending.reject(new Error("EACCES"));
    await flush();

    // `rollbackLeaf` restores the value the leaf held when the FAILING call was
    // scheduled. That is only the persisted value if nothing else wrote the
    // leaf in the meantime — here two writes did, and both landed. Restoring
    // `false` would put the checkbox at a value the boundary has already
    // superseded, with no further event to correct it. (Case id WI2-L: WI2-J
    // was already taken by the no-image-group case below.)
    expect(copyCheckbox()).toBeChecked();
    expect(recorder.fold().image.copyExternalImages).toBe(true);
  });
});

describe("ImageSettings — cross-group conservation (WI2-E)", () => {
  it("does not resurrect a themeMode another surface superseded", async () => {
    const { recorder, user } = await mount(
      makePreferences({ image: IMAGE_BASE, themeMode: "system" }),
    );

    await user.type(folderInput(), "x");
    const themeWriteSeq = recorder.calls.length;
    await act(async () => {
      await preferencesService.setPreferences({ themeMode: "dark" });
    });
    await advanceDebounce();

    expect(recorder.fold().themeMode).toBe("dark");
    expect(recorder.fold().image.assetFolder).toBe("assetsx");
    for (const write of recorder.allWrites()) {
      if (write.seq === themeWriteSeq) continue;
      expect(Object.keys(write.payload)).toEqual(["image"]);
    }
  });
});

describe("ImageSettings — no lost update and coalescing (WI2-F)", () => {
  it("a single edit reaches the boundary with its final value", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));

    await user.type(folderInput(), "x");
    await advanceDebounce();

    expect(recorder.writes().length).toBeGreaterThanOrEqual(1);
    expect(recorder.fold().image.assetFolder).toBe("assetsx");
  });

  it("three keystrokes in one window coalesce to a single write", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));

    await user.type(folderInput(), "xyz");
    await advanceDebounce();

    expect(recorder.writes()).toHaveLength(1);
    expect(recorder.fold().image.assetFolder).toBe("assetsxyz");
  });

  it("two edits in two windows produce two writes", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));

    await user.type(folderInput(), "x");
    await advanceDebounce();
    await user.type(folderInput(), "y");
    await advanceDebounce();

    expect(recorder.writes()).toHaveLength(2);
    expect(recorder.fold().image.assetFolder).toBe("assetsxy");
  });
});

describe("ImageSettings — rollback on a rejected bool write (WI2-G)", () => {
  it("restores the checkbox and the next write carries the rolled-back value", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));
    recorder.failNext("set_preferences", new Error("EACCES"));

    await user.click(copyCheckbox());
    await flush();
    await user.type(folderInput(), "x");
    await advanceDebounce();

    expect(copyCheckbox()).not.toBeChecked();
    expect(recorder.fold().image).toEqual({
      assetFolder: "assetsx",
      copyExternalImages: false,
      showPastePreview: true,
      maxDimension: null,
    });
  });

  it("a rollback landing mid-edit does not revert the textbox under the user (WI2-G′)", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));
    const pending = recorder.defer("set_preferences");

    await user.click(copyCheckbox());
    await flush();
    await user.type(folderInput(), "x");
    await act(async () => {
      pending.reject(new Error("EACCES"));
    });
    await flush();
    await advanceDebounce();

    expect(folderInput()).toHaveValue("assetsx");
    expect(copyCheckbox()).not.toBeChecked();
    expect(recorder.fold().image).toEqual({
      assetFolder: "assetsx",
      copyExternalImages: false,
      showPastePreview: true,
      maxDimension: null,
    });
  });
});

describe("ImageSettings — unmount discards the pending write (WI2-H / WI-5)", () => {
  it("issues no payload after teardown, and none ever carried the pending value", async () => {
    const { recorder, user, unmount } = await mount(makePreferences({ image: IMAGE_BASE }));

    await user.type(folderInput(), "x");
    const before = recorder.writes().length;
    unmount();
    await advanceDebounce();

    expect(recorder.writes()).toHaveLength(before);
    expect(JSON.stringify(recorder.allWrites())).not.toContain("assetsx");
    expect(recorder.fold().image).toEqual(IMAGE_BASE);
  });
});

describe("ImageSettings — a failed debounced write must not destroy the panel (WI2-I)", () => {
  it("keeps every control mounted and operable, and emits exactly one toast", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));
    const toasts = collectToasts();

    await user.type(folderInput(), "x");
    recorder.failCommand("set_preferences", new Error("EACCES"));
    await advanceDebounce();
    toasts.stop();

    // The defect: this branch used to replace the entire pane with a dead error
    // paragraph. Every control stays mounted, operable, and holding the value.
    expect(folderInput()).toBeInTheDocument();
    expect(copyCheckbox()).toBeInTheDocument();
    expect(folderInput()).toHaveValue("assetsx");

    // One signal per event (rule 30 §5): the service's toast, and nothing else.
    // The absent inline note is the load-bearing half — an inline note *plus*
    // the toast is two signals for one event, which the rule forbids outright.
    // Identical to ExportSettings' WI1-J by design; the twins must not drift.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(toasts.messages).toHaveLength(1);
    expect(toasts.messages[0]).toMatch(/failed to save preferences/i);
  });

  it("a later successful write lands, and raises no second toast", async () => {
    const { recorder, user } = await mount(makePreferences({ image: IMAGE_BASE }));
    const toasts = collectToasts();

    await user.type(folderInput(), "x");
    recorder.failCommand("set_preferences", new Error("EACCES"));
    await advanceDebounce();
    expect(toasts.messages).toHaveLength(1);

    recorder.clearFailCommand("set_preferences");
    await user.type(folderInput(), "y");
    await advanceDebounce();
    toasts.stop();

    // Nothing was latched into panel state, so there is no inline note to clear
    // and no second signal for the success.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(toasts.messages).toHaveLength(1);
    expect(folderInput()).toHaveValue("assetsxy");
  });

  /**
   * WI2-K — the positive half that makes the two negatives above mean something.
   * `ExportSettings`' WI1-K twin; the panels must not drift.
   *
   * Both cases above assert `queryByRole("alert")` is null after a failed
   * *save*. Alone, neither can tell "the panel correctly declined to render a
   * second signal" apart from "this panel has no inline note at all" — deleting
   * the `error` branch outright would leave both green. This pins the other
   * side: the alert is reachable, and the *load* failure is what reaches it.
   *
   * Mounted inline rather than through `mount()` because the failure has to be
   * armed before `get_preferences` is issued, and `mount()` owns the recorder.
   */
  it("WI2-K: a failed LOAD renders the inline alert as the event's only signal", async () => {
    const recorder = createRecorder(makePreferences({ image: IMAGE_BASE }));
    recorder.failCommand("get_preferences", new Error("EACCES reading config"));
    invokeMock.mockImplementation((cmd: string, args?: unknown) => recorder.invoke(cmd, args));
    const toasts = collectToasts();

    render(<ImageSettings />);
    await flush();
    toasts.stop();

    const alert = screen.queryByRole("alert");
    expect(alert).not.toBeNull();
    // The shared copy; the raw reason goes to the log only (WI-4.3b).
    expect(alert).toHaveTextContent("Failed to load preferences. Please close and reopen settings.");
    expect(alert).not.toHaveTextContent(/EACCES/);

    // Sole signal: nothing else fired for this event, so the inline note here is
    // compliant with rule 30 §5 for exactly the reason it is forbidden on the
    // save path. If `getPreferences` ever starts raising a toast of its own,
    // this length-0 assertion is what turns red.
    expect(toasts.messages).toHaveLength(0);

    // No values loaded, so the controls genuinely cannot render — unlike the
    // save path, where their absence was the defect. The busy note is suppressed
    // too, so the error is not competing with a spinner.
    expect(screen.queryByRole("textbox", { name: /Image Folder/i })).toBeNull();
    expect(screen.queryByRole("switch", { name: /Copy Images/i })).toBeNull();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();

    // Nothing is written off a failed load. Sending defaults here is precisely
    // how a corrupt read becomes a corrupt write — the frontend mirror of the
    // `unwrap_or_default` hazard ADR-0031 step 1 removes from the Rust side.
    expect(recorder.calls.filter((c) => c.cmd === "set_preferences")).toHaveLength(0);
  });
});

describe("ImageSettings — preferences with no image group (WI2-J)", () => {
  it("sends only the edited leaf and preserves the complete stored image group", async () => {
    const base = makePreferences();
    delete (base as Partial<UserPreferences>).image;
    const { recorder, user } = await mount(base as UserPreferences);

    await user.type(folderInput(), "x");
    await advanceDebounce();

    expect(recorder.allWrites()[0].payload).toEqual({ image: { assetFolder: `${DEFAULT_IMAGE_CONFIG.assetFolder}x` } });
    expect(() => recorder.fold()).not.toThrow();
    expect(recorder.fold().image).toEqual({
      ...DEFAULT_IMAGE_CONFIG,
      assetFolder: `${DEFAULT_IMAGE_CONFIG.assetFolder}x`,
    });
  });
});
