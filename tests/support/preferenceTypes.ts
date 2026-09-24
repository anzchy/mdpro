/**
 * Types for the preference write-path harness.
 *
 * Extracted from `preferenceRecorder.ts` under rule 50 §6 (types/interfaces →
 * their own module). Every name here is re-exported by `preferenceRecorder.ts`,
 * so the single-module import surface the test matrix § 0.2 documents is
 * unchanged — importers do not need to know this split happened.
 *
 * @module tests/support/preferenceTypes
 */

import type { LogEntryPayload } from "../../src/types/logging";
import type { UserPreferences } from "../../src/types/preferences";

/**
 * How a recorded call settled.
 *
 * Load-bearing: a rejected `set_preferences` never changed disk state, and a
 * still-pending one has not changed it yet. The fold must be able to tell the
 * three apart or it models a backend that does not exist.
 */
export type Outcome = "resolved" | "rejected" | "pending";

export interface RecordedCall {
  /** Issue order, monotonically increasing from 0. */
  seq: number;
  cmd: string;
  /** JSON-cloned at call time, not at assert time. */
  args: unknown;
  outcome: Outcome;
}

export interface RecordedWrite {
  seq: number;
  payload: Partial<UserPreferences>;
  outcome: Outcome;
}

/**
 * One user action, for the § 0.3.1 per-seq supplement.
 *
 * `field` is a dotted path into the preference shape (`"export.defaultFolder"`,
 * `"themeMode"`). `seq` is the recorder's call counter at the moment the action
 * happened — i.e. the action is known to precede every call whose `seq` is at
 * least this value.
 */
export interface UserAction {
  seq: number;
  field: string;
  value: unknown;
}

/** Manual settlement controls for a call held in flight by `defer(cmd)`. */
export interface DeferredHandle {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

export interface PreferenceRecorder {
  invoke(cmd: string, args?: unknown): Promise<unknown>;
  calls: RecordedCall[];
  /** Resolved `set_preferences` payloads, in issue order. */
  writes(): Array<Partial<UserPreferences>>;
  /** Every `set_preferences` payload with its seq and outcome. */
  allWrites(): RecordedWrite[];
  /** `assertGroupsComplete` then `foldWrites` (§ 0.2 property 4). */
  fold(): UserPreferences;
  /** The sole bypass of the completeness guard. F-B' only. */
  foldUnchecked(): UserPreferences;
  logs(): LogEntryPayload[];
  /** Fail the next call to `cmd` only. */
  failNext(cmd: string, err: Error): void;
  /** Fail every call to `cmd` until `clearFailCommand`. */
  failCommand(cmd: string, err: Error): void;
  clearFailCommand(cmd: string): void;
  /** Stub a command's resolved value (e.g. `pick_export_folder`). */
  set(cmd: string, value: unknown): void;
  /** Hold the next call to `cmd` un-settled; the test settles it by hand. */
  defer(cmd: string): DeferredHandle;
}
