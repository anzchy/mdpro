// @vitest-environment node
/**
 * ADR-0047 WI-003 review fix WI-R2: the pure `launchCore` helpers on inputs
 * the drivers never hand them (a null stderr capture, a non-object
 * handshake, odd error values). Characterization, written after the WI-R2
 * red record; the driver-level effects of the same branches are pinned in
 * `control-launcher-launch-paths.test.ts` (LP-R2, LP-R6, LP-R7, LP-R8).
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 4 changes
 * (review fixes, WI-R2)", LC-R1.
 */
import { describe, expect, it } from "vitest";
import {
  checkHandshake,
  errCode,
  errMessage,
  openArgv,
  parseGuardReason,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/launchCore.mjs";

const EXPECTED = { nonce: "n", buildId: "b1" };

describe("WI-R2 launchCore (pure)", () => {
  it("LC-R1 defensive inputs: unknown reason, no trailing file, unreadable handshake, `error` code, string message", () => {
    const argv = (file?: string) => openArgv({ runDirReal: "/r", nonce: "n", bundle: "/B.app", file });
    expect({
      guardNull: parseGuardReason(null),
      guardUndefined: parseGuardReason(undefined),
      argvEmpty: argv("").slice(-2),
      argvMissing: argv().slice(-2),
      hsNull: checkHandshake("null", EXPECTED),
      hsNumber: checkHandshake("5", EXPECTED),
      codes: [errCode({}), errCode({ code: 7 }), errCode({ code: "" }), errCode(null)],
      message: errMessage("x"),
    }).toEqual({
      guardNull: "unknown",
      guardUndefined: "unknown",
      argvEmpty: ["-a", "/B.app"],
      argvMissing: ["-a", "/B.app"],
      hsNull: { ok: false, reason: "instance.json unreadable" },
      hsNumber: { ok: false, reason: "instance.json unreadable" },
      codes: ["error", "error", "error", "error"],
      message: "x",
    });
  });
});
