/**
 * Boundary recorder for the preference write-path suite.
 *
 * Purpose: stand in for the Tauri `invoke` boundary so a test can ask two
 * questions a spy cannot answer — *what was sent, in what order* and *what would
 * be on disk once everything settled*. The second is answered by `foldWrites`
 * (`./preferenceFold`), the oracle for thirteen S5 cases in the preference
 * write-path matrix.
 *
 * The Tauri package specifier is deliberately not written anywhere in this file
 * or its siblings: property 6 below is asserted against the modules' source
 * text, and a mention in prose is indistinguishable from an import to that
 * check. A guard that errs toward too strict is the right direction here.
 *
 * This module is the documented import surface (matrix § 0.1). Types live in
 * `./preferenceTypes` and the pure fold in `./preferenceFold` under rule 50 §6;
 * both are re-exported here so importers never need to know that.
 *
 * Six properties are load-bearing and must not be simplified away (matrix
 * § 0.2). Each is annotated at its implementation site:
 *
 *  1. Args are JSON-cloned **at call time**. Components hand the boundary a live
 *     object; asserting on that reference later observes its final state, not
 *     what was sent.
 *  2. Outcomes are recorded and `fold()` folds **only resolved writes**. A
 *     rejected `set_preferences` never changed disk state; folding it would model
 *     a backend that does not exist. A pending write folds as neither.
 *  3. An unknown command **rejects loudly** rather than resolving `undefined`, so
 *     a typo'd command name fails instead of silently no-opping.
 *  4. `fold()` runs `assertGroupsComplete` first. Group completeness is therefore
 *     checked by *every* case that folds, not by a per-case discipline nobody
 *     maintains. {@link PreferenceRecorder.foldUnchecked} is the sole bypass and
 *     exists for exactly one case (F-B').
 *  5. A resolved `set_preferences` does **not** update what `get_preferences`
 *     returns — the base is frozen at {@link createRecorder}. Deliberate, with a
 *     named cost: the recorder cannot model a second mount observing the first
 *     mount's writes. Flipping this default would de-fang WI4-B, so a case that
 *     needs it must opt in through a new explicit method instead.
 *  6. A real user-config write is **structurally impossible**. These modules
 *     import no `fs` API and no IPC transport; the base fixture is held in
 *     memory. There is no code path from here to `~/.mdpro/config.json` or
 *     `~/Library/Application Support/mdpro/`.
 *
 * SCOPE WARNING (matrix § 0.6): a green suite built on this recorder does not
 * mean preferences persist in the shipping app. It mocks the transport, and the
 * real transport is unreachable today. See the header of
 * `tests/preference-fold-helper.test.ts`.
 *
 * @module tests/support/preferenceRecorder
 */

import type { LogEntryPayload } from "../../src/types/logging";
import type { UserPreferences } from "../../src/types/preferences";
import { assertGroupsComplete, cloneJson, foldWrites } from "./preferenceFold";
import type {
  DeferredHandle,
  Outcome,
  PreferenceRecorder,
  RecordedCall,
  RecordedWrite,
} from "./preferenceTypes";

export {
  assertGroupsComplete,
  assertNoSupersededPayload,
  cloneJson,
  foldWrites,
} from "./preferenceFold";
export type {
  DeferredHandle,
  Outcome,
  PreferenceRecorder,
  RecordedCall,
  RecordedWrite,
  UserAction,
} from "./preferenceTypes";

interface Deferral {
  promise: Promise<unknown>;
  handle: DeferredHandle;
}

function makeDeferral(): Deferral {
  let resolveFn!: (value: unknown) => void;
  let rejectFn!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, handle: { resolve: resolveFn, reject: rejectFn } };
}

function extractWritePayload(args: unknown, seq: number): Partial<UserPreferences> {
  const record = args as Record<string, unknown> | null | undefined;
  if (
    record === null ||
    record === undefined ||
    !Object.prototype.hasOwnProperty.call(record, "preferences")
  ) {
    // Loud, for the same reason as property 3: the production caller is
    // `invoke("set_preferences", { preferences })`. Any other shape is a bug in
    // the code under test, not a variant to accommodate.
    throw new Error(
      `set_preferences call #${seq} did not pass { preferences: … }; got ${JSON.stringify(args)}.`,
    );
  }
  return record.preferences as Partial<UserPreferences>;
}

/** The commands the recorder answers without an explicit `set()`. */
const BUILTIN_COMMANDS = new Set(["get_preferences", "set_preferences", "log_event"]);

export function createRecorder(base: UserPreferences): PreferenceRecorder {
  // Property 5: frozen at construction. A resolved write never updates it.
  const frozenBase = cloneJson(base);

  const calls: RecordedCall[] = [];
  const stubs = new Map<string, unknown>();
  const oneShotFailures = new Map<string, Error[]>();
  const persistentFailures = new Map<string, Error>();
  const deferrals = new Map<string, Deferral[]>();

  function invoke(cmd: string, args?: unknown): Promise<unknown> {
    // Property 1: clone now, not at assert time.
    const record: RecordedCall = {
      seq: calls.length,
      cmd,
      args: cloneJson(args),
      outcome: "pending" satisfies Outcome,
    };
    calls.push(record);

    const oneShot = oneShotFailures.get(cmd);
    if (oneShot && oneShot.length > 0) {
      record.outcome = "rejected";
      return Promise.reject(oneShot.shift());
    }

    const persistent = persistentFailures.get(cmd);
    if (persistent) {
      record.outcome = "rejected";
      return Promise.reject(persistent);
    }

    const queued = deferrals.get(cmd);
    if (queued && queued.length > 0) {
      const deferral = queued.shift() as Deferral;
      // Outcome stays "pending" until the test settles it by hand.
      return deferral.promise.then(
        (value) => {
          record.outcome = "resolved";
          return value;
        },
        (error) => {
          record.outcome = "rejected";
          throw error;
        },
      );
    }

    if (stubs.has(cmd)) {
      record.outcome = "resolved";
      return Promise.resolve(cloneJson(stubs.get(cmd)));
    }

    if (cmd === "get_preferences") {
      record.outcome = "resolved";
      return Promise.resolve(cloneJson(frozenBase));
    }

    if (BUILTIN_COMMANDS.has(cmd)) {
      record.outcome = "resolved";
      return Promise.resolve(undefined);
    }

    // Property 3.
    record.outcome = "rejected";
    return Promise.reject(new Error(`unstubbed command: ${cmd}`));
  }

  function allWrites(): RecordedWrite[] {
    return calls
      .filter((call) => call.cmd === "set_preferences")
      .map((call) => ({
        seq: call.seq,
        payload: extractWritePayload(call.args, call.seq),
        outcome: call.outcome,
      }));
  }

  function writes(): Array<Partial<UserPreferences>> {
    // Property 2: resolved only.
    return allWrites()
      .filter((write) => write.outcome === "resolved")
      .map((write) => write.payload);
  }

  function foldUnchecked(): UserPreferences {
    return foldWrites(frozenBase, writes());
  }

  function fold(): UserPreferences {
    // Property 4.
    assertGroupsComplete(writes());
    return foldWrites(frozenBase, writes());
  }

  function logs(): LogEntryPayload[] {
    return calls
      .filter((call) => call.cmd === "log_event")
      .map((call) => (call.args as { payload: LogEntryPayload }).payload);
  }

  return {
    invoke,
    calls,
    writes,
    allWrites,
    fold,
    foldUnchecked,
    logs,
    failNext(cmd: string, err: Error) {
      const queue = oneShotFailures.get(cmd) ?? [];
      queue.push(err);
      oneShotFailures.set(cmd, queue);
    },
    failCommand(cmd: string, err: Error) {
      persistentFailures.set(cmd, err);
    },
    clearFailCommand(cmd: string) {
      persistentFailures.delete(cmd);
    },
    set(cmd: string, value: unknown) {
      stubs.set(cmd, value);
    },
    defer(cmd: string): DeferredHandle {
      const deferral = makeDeferral();
      const queue = deferrals.get(cmd) ?? [];
      queue.push(deferral);
      deferrals.set(cmd, queue);
      return deferral.handle;
    },
  };
}
