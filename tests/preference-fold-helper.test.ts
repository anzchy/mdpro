// @vitest-environment node
/**
 * WI-0 — the shared harness for the preference write-path run.
 *
 * Matrix cases F-A, F-B, F-B' and F-C (test matrix
 * `.claude/tdd-guardian/tests-20260923-preference-write-path.md`, lines
 * 117-173). The fold implemented in `tests/support/preferenceRecorder.ts` is
 * the oracle for thirteen downstream S5 cases, so it is specified here in its
 * own right rather than trusted because it is short.
 *
 * SCOPE (matrix § 0.6). These cases pin the *merge model* the frontend
 * assumes; the backend half of the same claim is pinned in the `rust` lane by
 * F-D (`src-tauri/src/services/preferences_fold_contract_tests.rs`). Neither
 * covers the transport. Since ADR-0031 step 5b `preferencesService` selects the
 * transport with `isTauri()`, so the running app does reach `set_preferences`;
 * whether the packaged WebView carries that marker is verified only by the
 * ADR-0032 GUI run, not by any unit test.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXPORT_E1,
  EXPORT_E2,
  EXPORT_OLD,
  IMAGE_I1,
  makePreferences,
} from "./support/preferenceFixtures";
import {
  assertGroupsComplete,
  assertNoSupersededPayload,
  createRecorder,
  foldWrites,
} from "./support/preferenceRecorder";

import type { UserPreferences } from "../src/types/preferences";

type Write = Partial<UserPreferences>;

/**
 * The oracle for F-A: a *different* algorithm from `foldWrites`. `foldWrites`
 * folds left with a spread; this scans each key's occurrences in reverse and
 * takes the first hit. If both are wrong they have to be wrong in the same way,
 * which a left-fold and a reverse scan are not structurally able to be.
 */
function expectedByIndependentScan(base: UserPreferences, ws: Write[]): UserPreferences {
  const result = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  const touched = new Set<string>();
  for (const w of ws) {
    for (const k of Object.keys(w)) touched.add(k);
  }
  for (const k of touched) {
    for (let i = ws.length - 1; i >= 0; i--) {
      const candidate = ws[i] as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(candidate, k)) {
        result[k] = candidate[k];
        break;
      }
    }
  }
  return result as unknown as UserPreferences;
}

/** The five write alphabet symbols of F-A. */
const ALPHABET: Write[] = [
  {},
  { themeMode: "dark" },
  { export: EXPORT_E1 },
  { export: EXPORT_E2 },
  { image: IMAGE_I1 },
];

/** All sequences of length 0..3 over `ALPHABET` — 1 + 5 + 25 + 125 = 156. */
function enumerateSequences(): Write[][] {
  const out: Write[][] = [[]];
  for (const a of ALPHABET) {
    out.push([a]);
    for (const b of ALPHABET) {
      out.push([a, b]);
      for (const c of ALPHABET) out.push([a, b, c]);
    }
  }
  return out;
}

describe("F-A — fold is a left-fold with identity and last-write-wins", () => {
  const base = makePreferences({ export: EXPORT_OLD });
  const sequences = enumerateSequences();

  it("enumerates the full 156-sequence domain (exhaustive, not sampled)", () => {
    expect(sequences).toHaveLength(156);
  });

  it("(a) folds the empty sequence to the base", () => {
    expect(foldWrites(base, [])).toEqual(base);
  });

  it("(b) is associative across every split point of every sequence", () => {
    for (const ws of sequences) {
      for (let i = 0; i <= ws.length; i++) {
        const split = foldWrites(foldWrites(base, ws.slice(0, i)), ws.slice(i));
        expect(split).toEqual(foldWrites(base, ws));
      }
    }
  });

  it("(c)+(d) matches an independent reverse-scan oracle on all 156 sequences", () => {
    for (const ws of sequences) {
      expect(foldWrites(base, ws)).toEqual(expectedByIndependentScan(base, ws));
    }
  });

  it("(c) each touched key equals the last write that carried it", () => {
    for (const ws of sequences) {
      const folded = foldWrites(base, ws) as unknown as Record<string, unknown>;
      for (const key of ["themeMode", "export", "image"]) {
        const last = [...ws].reverse().find((w) =>
          Object.prototype.hasOwnProperty.call(w, key),
        ) as Record<string, unknown> | undefined;
        if (last) expect(folded[key]).toEqual(last[key]);
      }
    }
  });

  it("(d) every key absent from all writes is the base value", () => {
    for (const ws of sequences) {
      const folded = foldWrites(base, ws) as unknown as Record<string, unknown>;
      const asBase = base as unknown as Record<string, unknown>;
      const touched = new Set(ws.flatMap((w) => Object.keys(w)));
      for (const key of Object.keys(asBase)) {
        if (!touched.has(key)) expect(folded[key]).toEqual(asBase[key]);
      }
    }
  });

  it("does not mutate the base it folds over", () => {
    const snapshot = JSON.parse(JSON.stringify(base)) as UserPreferences;
    for (const ws of sequences) foldWrites(base, ws);
    expect(base).toEqual(snapshot);
  });
});

describe("F-B — a complete group in a payload replaces the stored group", () => {
  it("replaces export wholesale when the payload carries a complete export group", async () => {
    const base = makePreferences({ export: EXPORT_OLD });
    const recorder = createRecorder(base);

    await recorder.invoke("set_preferences", {
      preferences: { export: { defaultFolder: "/new", htmlIncludeStyles: true } },
    });

    expect(recorder.fold().export).toEqual({
      defaultFolder: "/new",
      htmlIncludeStyles: true,
    });
  });

  it("leaves export at the stored value when the payload omits the group", async () => {
    const base = makePreferences({ export: EXPORT_OLD });
    const recorder = createRecorder(base);

    await recorder.invoke("set_preferences", { preferences: { themeMode: "dark" } });

    // By value. Object identity is not part of the contract.
    expect(recorder.fold().export).toEqual(EXPORT_OLD);
    expect(recorder.fold().themeMode).toBe("dark");
  });
});

describe("F-B' — a partial group REPLACES rather than merges (the deep-merge kill)", () => {
  const partialExport = { export: { defaultFolder: "/new" } } as unknown as Write;

  it("drops the leaf the partial payload omitted (free foldWrites)", () => {
    const base = makePreferences({ export: EXPORT_OLD });

    const result = foldWrites(base, [partialExport]);

    expect(result.export).toEqual({ defaultFolder: "/new" });
    // Not decoration: toEqual treats {a:1} and {a:1, b:undefined} as equal, so a
    // deep merge that spread an undefined would slip past toEqual alone.
    expect("htmlIncludeStyles" in result.export).toBe(false);
  });

  it("drops the omitted leaf through recorder.foldUnchecked() too", async () => {
    const base = makePreferences({ export: EXPORT_OLD });
    const recorder = createRecorder(base);

    await recorder.invoke("set_preferences", { preferences: partialExport });
    const result = recorder.foldUnchecked();

    expect(result.export).toEqual({ defaultFolder: "/new" });
    expect("htmlIncludeStyles" in result.export).toBe(false);
  });

  it("throws on the same input through the checked fold() — the bypass is opt-in", async () => {
    const base = makePreferences({ export: EXPORT_OLD });
    const recorder = createRecorder(base);

    await recorder.invoke("set_preferences", { preferences: partialExport });

    expect(() => recorder.fold()).toThrow(/export.*htmlIncludeStyles/);
  });
});

describe("F-C — a partial-group payload is rejected by the checked fold", () => {
  it("throws naming the export group and its missing leaf", () => {
    expect(() =>
      assertGroupsComplete([{ export: { defaultFolder: "/x" } } as unknown as Write]),
    ).toThrow(/export.*htmlIncludeStyles/);
  });

  it("throws naming the image group and its missing leaf", () => {
    expect(() =>
      assertGroupsComplete([
        { image: { assetFolder: "a", copyExternalImages: true } } as unknown as Write,
      ]),
    ).toThrow(/image.*showPastePreview/);
  });

  it("accepts a complete group (positive control)", () => {
    expect(() => assertGroupsComplete([{ export: EXPORT_E1 }])).not.toThrow();
    expect(() => assertGroupsComplete([{ image: IMAGE_I1 }])).not.toThrow();
  });

  it("accepts a payload with no group at all (positive control)", () => {
    expect(() => assertGroupsComplete([{ themeMode: "dark" }])).not.toThrow();
    expect(() => assertGroupsComplete([])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Recorder properties § 0.2. Not numbered cases in the matrix, but every one of
// these six properties is load-bearing for a downstream case, and an unexercised
// harness property is a harness property that silently rots.
// ---------------------------------------------------------------------------

describe("recorder § 0.2 load-bearing properties", () => {
  it("property 1 — clones args at call time, not at assert time", async () => {
    const recorder = createRecorder(makePreferences({ export: EXPORT_OLD }));
    const live = { export: { defaultFolder: "/new", htmlIncludeStyles: true } };

    await recorder.invoke("set_preferences", { preferences: live });
    live.export.defaultFolder = "/mutated-after-the-fact";

    expect(recorder.writes()[0]).toEqual({
      export: { defaultFolder: "/new", htmlIncludeStyles: true },
    });
  });

  it("property 2 — fold() folds only resolved writes; rejected and pending are excluded", async () => {
    const recorder = createRecorder(makePreferences({ export: EXPORT_OLD }));

    recorder.failNext("set_preferences", new Error("disk full"));
    await expect(
      recorder.invoke("set_preferences", { preferences: { export: EXPORT_E1 } }),
    ).rejects.toThrow(/disk full/);

    const pending = recorder.defer("set_preferences");
    void recorder.invoke("set_preferences", { preferences: { export: EXPORT_E2 } });

    expect(recorder.fold().export).toEqual(EXPORT_OLD);
    expect(recorder.writes()).toEqual([]);
    expect(recorder.allWrites().map((w) => w.outcome)).toEqual(["rejected", "pending"]);

    pending.resolve(undefined);
    await Promise.resolve();
    expect(recorder.writes()).toEqual([{ export: EXPORT_E2 }]);
  });

  it("property 3 — an unstubbed command rejects loudly instead of resolving undefined", async () => {
    const recorder = createRecorder(makePreferences());

    await expect(recorder.invoke("set_prefrences", {})).rejects.toThrow(
      /unstubbed command: set_prefrences/,
    );
  });

  it("property 5 — a resolved write does NOT update what get_preferences returns", async () => {
    const recorder = createRecorder(makePreferences({ export: EXPORT_OLD }));

    await recorder.invoke("set_preferences", { preferences: { export: EXPORT_E1 } });
    const reread = (await recorder.invoke("get_preferences", {})) as UserPreferences;

    expect(reread.export).toEqual(EXPORT_OLD);
  });

  it("property 6 — the module has no fs or IPC path at all", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./support/preferenceRecorder.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/@tauri-apps\/api/);
    expect(source).not.toMatch(/from\s+["']node:fs["']/);
    expect(source).not.toMatch(/require\(["']fs["']\)/);

    // Added after the red: `preferenceRecorder.ts` was split under rule 50 §6,
    // and a guard that covered only one of the three modules would have a hole
    // exactly where new code goes.
    for (const sibling of ["preferenceFold.ts", "preferenceTypes.ts"]) {
      const siblingSource = readFileSync(
        path.resolve(__dirname, "./support", sibling),
        "utf8",
      );
      expect(siblingSource, sibling).not.toMatch(/@tauri-apps\/api/);
      expect(siblingSource, sibling).not.toMatch(/from\s+["']node:fs["']/);
      expect(siblingSource, sibling).not.toMatch(/require\(["']fs["']\)/);
    }
  });

  it("set() stubs a non-preference command; logs() exposes log_event payloads", async () => {
    const recorder = createRecorder(makePreferences());
    recorder.set("pick_export_folder", "/picked");

    expect(await recorder.invoke("pick_export_folder", {})).toBe("/picked");

    // CORRECTED AFTER THE RED WAS RECORDED. The first draft of this line sent
    // `{ entry: … }`. That key does not exist: the production caller is
    // `safeInvoke("log_event", { payload })` (src/services/loggingService.ts:56).
    // Implementing `logs()` to read `args.entry` would have made this pass while
    // returning an empty array for every real component, silently blinding the
    // logging assertions of thirteen downstream cases. The *expectation* below
    // is unchanged; only the stimulus was wrong.
    await recorder.invoke("log_event", {
      payload: { level: "info", event: "ui.export.pick", status: "success" },
    });
    expect(recorder.logs()).toEqual([
      { level: "info", event: "ui.export.pick", status: "success" },
    ]);
  });

  it("failCommand() fails every call until cleared", async () => {
    const recorder = createRecorder(makePreferences());
    recorder.failCommand("set_preferences", new Error("nope"));

    await expect(
      recorder.invoke("set_preferences", { preferences: { themeMode: "dark" } }),
    ).rejects.toThrow(/nope/);
    await expect(
      recorder.invoke("set_preferences", { preferences: { themeMode: "light" } }),
    ).rejects.toThrow(/nope/);

    recorder.clearFailCommand("set_preferences");
    await expect(
      recorder.invoke("set_preferences", { preferences: { themeMode: "light" } }),
    ).resolves.toBeUndefined();
  });
});

describe("assertNoSupersededPayload — the § 0.3.1 per-seq supplement", () => {
  it("rejects a payload carrying a value an earlier action already superseded", () => {
    const recorder = createRecorder(makePreferences({ export: EXPORT_OLD }));
    void recorder.invoke("set_preferences", {
      preferences: { export: { defaultFolder: "/stale", htmlIncludeStyles: false } },
    });

    // The user typed "/stale" (action 0) then "/fresh" (action 1) before the
    // write at seq 0 was issued, so "/stale" was already superseded.
    expect(() =>
      assertNoSupersededPayload(recorder.allWrites(), [
        { seq: 0, field: "export.defaultFolder", value: "/stale" },
        { seq: 0, field: "export.defaultFolder", value: "/fresh" },
      ]),
    ).toThrow(/export\.defaultFolder/);
  });

  it("accepts a payload carrying the most recent value for every field", () => {
    const recorder = createRecorder(makePreferences({ export: EXPORT_OLD }));
    void recorder.invoke("set_preferences", {
      preferences: { export: { defaultFolder: "/fresh", htmlIncludeStyles: false } },
    });

    expect(() =>
      assertNoSupersededPayload(recorder.allWrites(), [
        { seq: 0, field: "export.defaultFolder", value: "/stale" },
        { seq: 0, field: "export.defaultFolder", value: "/fresh" },
      ]),
    ).not.toThrow();
  });

  /*
   * Added 2026-09-23 with WI-1, the helper's first real consumer, alongside the
   * strengthening documented on `assertNoSupersededPayload`. The two cases above
   * are unchanged: both still hold under the stronger predicate.
   */
  it("rejects a payload that re-sends the value the user acted *away* from, even though that value was never itself an action", () => {
    const recorder = createRecorder(
      makePreferences({ export: { defaultFolder: "/old", htmlIncludeStyles: true } }),
    );
    void recorder.invoke("set_preferences", {
      preferences: { export: { defaultFolder: "/old", htmlIncludeStyles: true } },
    });

    // This is WI-1's reproducer in miniature: `true` came from disk, not from a
    // user action, so a predicate that only knows about prior *action* values
    // cannot see that the stale payload reverts the toggle.
    expect(() =>
      assertNoSupersededPayload(recorder.allWrites(), [
        { seq: 0, field: "export.htmlIncludeStyles", value: false },
      ]),
    ).toThrow(/export\.htmlIncludeStyles/);
  });

  it("leaves a field the user never acted on before the write unconstrained", () => {
    const recorder = createRecorder(makePreferences({ export: EXPORT_OLD }));
    void recorder.invoke("set_preferences", {
      preferences: { export: { defaultFolder: "/old", htmlIncludeStyles: false } },
    });

    expect(() =>
      assertNoSupersededPayload(recorder.allWrites(), [
        // Acts on a different field entirely...
        { seq: 0, field: "export.htmlIncludeStyles", value: false },
        // ...and on this one only *after* the write was issued.
        { seq: 1, field: "export.defaultFolder", value: "/later" },
      ]),
    ).not.toThrow();
  });
});
