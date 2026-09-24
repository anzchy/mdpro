/**
 * The fold and its guards — the oracle for thirteen S5 cases.
 *
 * Extracted from `preferenceRecorder.ts` under rule 50 §6 (pure helpers → their
 * own module). Everything here is re-exported by `preferenceRecorder.ts`, so the
 * single-module import surface the test matrix § 0.2 documents is unchanged.
 *
 * Nothing in this module performs IO of any kind. That is asserted structurally
 * by `tests/preference-fold-helper.test.ts` ("property 6"), because a harness
 * that could reach `~/.mdpro/config.json` would eventually reach it.
 *
 * @module tests/support/preferenceFold
 */

import type { UserPreferences } from "../../src/types/preferences";
import type { RecordedWrite, UserAction } from "./preferenceTypes";

/**
 * The leaves each group must carry to be a legal whole-group payload.
 *
 * Mirrors `ExportConfig` / `ImageConfig` in `src/types/preferences.ts`. The
 * backend replaces a group wholesale (`src-tauri/src/services/preferences.rs`
 * `merge_preferences`), so a payload carrying only some leaves of a group is not
 * a smaller write — it is a write that drops the others.
 */
const REQUIRED_LEAVES: Record<string, readonly string[]> = {
  export: ["defaultFolder", "htmlIncludeStyles"],
  image: ["assetFolder", "copyExternalImages", "showPastePreview", "maxDimension"],
};

/**
 * JSON round-trip clone.
 *
 * JSON rather than `structuredClone` is deliberate: every payload crosses a real
 * IPC boundary in production and is therefore JSON-serializable by construction,
 * so this clone cannot lose information the real boundary would have preserved.
 * A `structuredClone` would preserve more than the real boundary does, which
 * would let a test pass on a value the app could never actually send.
 */
export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Left-fold with identity and last-write-wins per **top-level** key.
 *
 * A top-level replace, not a deep merge. That is not a convenience choice — it
 * is what `merge_preferences` does (`updates.export.unwrap_or(current.export)`
 * for every top-level key), pinned from the Rust side by F-D in
 * `src-tauri/src/services/preferences_fold_contract_tests.rs`.
 *
 * This is a **final-state** oracle: it answers "what would be on disk once
 * everything settled" and says nothing about intermediate states. See
 * {@link assertNoSupersededPayload} for the per-seq supplement.
 */
export function foldWrites(
  base: UserPreferences,
  writes: Array<Partial<UserPreferences>>,
): UserPreferences {
  return writes.reduce<UserPreferences>((acc, w) => ({ ...acc, ...w }), { ...base });
}

/**
 * Throw if any payload carries a group with some, but not all, of its leaves.
 *
 * Such a payload cannot be modelled: against today's backend a partial `export`
 * payload silently resurrects the serde default for the missing leaf, and a
 * partial `image` payload fails to deserialize outright. Modelling either as a
 * merge would quietly describe a backend that does not exist. Both facts are
 * pinned in the `rust` lane by F-D.
 */
export function assertGroupsComplete(writes: Array<Partial<UserPreferences>>): void {
  writes.forEach((write, index) => {
    const asRecord = write as Record<string, unknown>;
    for (const [group, leaves] of Object.entries(REQUIRED_LEAVES)) {
      if (!Object.prototype.hasOwnProperty.call(asRecord, group)) continue;

      const value = asRecord[group];
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(
          `set_preferences payload #${index}: group "${group}" must be an object, got ${JSON.stringify(value)}.`,
        );
      }

      const missing = leaves.filter(
        (leaf) => !Object.prototype.hasOwnProperty.call(value, leaf),
      );
      if (missing.length > 0) {
        throw new Error(
          `set_preferences payload #${index}: group "${group}" is incomplete — missing ${missing.join(", ")}. ` +
            `The backend replaces a group wholesale, so a partial group drops the omitted leaves. Write the whole group.`,
        );
      }
    }
  });
}

/** Flatten a payload one level into dotted field paths. */
function flattenPayload(payload: Partial<UserPreferences>): Map<string, unknown> {
  const flat = new Map<string, unknown>();
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [leaf, leafValue] of Object.entries(value as Record<string, unknown>)) {
        flat.set(`${key}.${leaf}`, leafValue);
      }
      continue;
    }
    flat.set(key, value);
  }
  return flat;
}

/**
 * The § 0.3.1 per-seq supplement to the fold.
 *
 * {@link foldWrites} is a final-state oracle: a sequence that writes a stale
 * value and then the correct one folds identically to one that never wrote the
 * stale value. The two differ for a user whose second write fails, or who loses
 * power between them. This forbids that signature: no payload issued at `seq`
 * may carry, for any field, a value that a strictly earlier user action had
 * already superseded by the time that `seq` was reached.
 *
 * It constrains no legitimate fix — both mechanisms the plan names (cancel the
 * timer; read current state at fire time) satisfy it. It only forbids the
 * defect's signature.
 *
 * It is a **supplement, not the law**. If it and the fold ever disagree about
 * whether a fix is acceptable, the fold wins and this is rewritten with a stated
 * reason.
 *
 * `actions` must be in issue order. A field the user never acted on before the
 * write is unconstrained — a whole-group payload legitimately carries the loaded
 * value for every leaf nobody touched.
 *
 * STRENGTHENED 2026-09-23, by WI-1, its first real consumer.
 *
 * The original predicate only flagged a value that had *itself* been an earlier
 * action's value. That made it **vacuous against the defect it was written for**.
 * WI-1's reproducer is: the export group loads with `htmlIncludeStyles: true`,
 * the user toggles it to `false`, and a stale debounced payload then re-sends
 * `true`. `true` was never a user action — it was the loaded baseline — so the
 * old predicate saw nothing, and the whole supplement rested on the one
 * `defaultFolder` row where the stale value happened to have been typed.
 *
 * The rule is now stated positively and matches § 0.3.1's prose directly: a
 * payload must carry, for every field the user acted on before it was issued,
 * the value of the **most recent** such action. Any other value is superseded,
 * whether the user chose it earlier or merely inherited it from disk. Both fix
 * mechanisms the plan names still satisfy it, so it still constrains no
 * legitimate fix.
 */
export function assertNoSupersededPayload(
  writes: RecordedWrite[],
  actions: UserAction[],
): void {
  for (const write of writes) {
    for (const [field, value] of flattenPayload(write.payload)) {
      let latest: UserAction | undefined;
      for (const action of actions) {
        if (action.field !== field) continue;
        if (action.seq > write.seq) continue;
        latest = action;
      }

      if (latest === undefined) continue;
      if (sameValue(latest.value, value)) continue;

      throw new Error(
        `set_preferences payload at seq ${write.seq} carries a superseded value for "${field}": ` +
          `${JSON.stringify(value)}, but the most recent user action on that field before this write ` +
          `set it to ${JSON.stringify(latest.value)}.`,
      );
    }
  }
}
