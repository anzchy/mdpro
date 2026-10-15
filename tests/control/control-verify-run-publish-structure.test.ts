// @vitest-environment node
/**
 * ADR-0047 WI-002 fix / WI-1: the source shape of exclusive `instance.json`
 * publication. Matrix `.claude/tdd-guardian/tests-20261007-230837.md`, WI1-S01
 * (round 1, extended in rounds 2 and 3) and WI1-S02.
 *
 * Structural on purpose: a dropped `sync_all`, a check-then-rename, or an
 * error mapping that sends a non-EEXIST link failure to `InstanceExists` is
 * not reachable behaviourally without a fault-injection seam (policy rule 13).
 * The publication body is located by content (the one fn holding
 * `hard_link(`), not by name. Sources are read comment-blanked.
 */
import { describe, expect, it } from "vitest";
import {
  allFns,
  blockAfter,
  depthAt,
  fnBody,
  fnContaining,
  readBlankedRust,
} from "../support/rustSource";

const FILES = ["src/services/verify_run_instance.rs", "src/services/verify_run.rs"];
const TEXTS = FILES.map(readBlankedRust);
const BOTH = TEXTS.join("\n");
const count = (s: string, needle: string) => s.split(needle).length - 1;
/** The publication body; `fnContaining` asserts exactly one fn holds `hard_link(`. */
const body = () => fnContaining(BOTH, "hard_link(");

describe("WI1-S01: publication is temp, mode, write, sync, link, and nothing else", () => {
  it("uses create_new, INSTANCE_MODE, write_all, sync_all, hard_link in that order", () => {
    const b = body();
    const order = ["create_new(true)", "INSTANCE_MODE", "write_all(", "sync_all()", "hard_link("];
    const at = order.map((t) => b.indexOf(t));
    order.forEach((t, i) => expect(at[i], `${t} present`).toBeGreaterThanOrEqual(0));
    expect(at).toEqual([...at].sort((x, y) => x - y));
    expect(count(b, "hard_link(")).toBe(1);
  });

  it("neither file renames, truncates, or creates over a path", () => {
    for (const [i, text] of TEXTS.entries()) {
      for (const bad of ["rename(", ".truncate(", "fs::write(", "File::create(", ".create(true)"]) {
        expect(count(text, bad), `${FILES[i]}: ${bad}`).toBe(0);
      }
    }
  });

  it("links from the temp, never from instance.json", () => {
    const b = body();
    const at = b.indexOf("hard_link(");
    const firstArg = b.slice(at + "hard_link(".length, b.indexOf(",", at));
    expect(firstArg).not.toContain("instance.json");
  });

  it("propagates the write and sync results, never discards them", () => {
    const b = body();
    expect(b).toMatch(/write_all\([^;]*\)\s*(\.map_err\([^;]*\))?\s*\?/);
    expect(b).toMatch(/sync_all\(\)\s*(\.map_err\([^;]*\))?\s*\?/);
    const io = b.split(";").filter((s) => s.includes("write_all(") || s.includes("sync_all("));
    expect(io.length).toBeGreaterThanOrEqual(2);
    for (const stmt of io) {
      for (const bad of ["let _ =", ".ok()", ".unwrap_or"]) {
        expect(stmt, bad).not.toContain(bad);
      }
    }
  });
});

describe("WI1-S02: only AlreadyExists reaches InstanceExists; the temp is always removed", () => {
  it("maps ErrorKind::AlreadyExists, and only it, to InstanceExists in one expression", () => {
    const b = body();
    expect(count(b, "InstanceExists")).toBe(1);
    expect(count(b, "ErrorKind::AlreadyExists")).toBe(1);
    const already = b.indexOf("ErrorKind::AlreadyExists");
    const exists = b.indexOf("InstanceExists");
    expect(already).toBeLessThan(exists);
    expect(b.slice(already, exists)).not.toContain(";");
    expect(count(b, "InstanceWrite")).toBeGreaterThanOrEqual(1);
  });

  it("names InstanceExists only in the publication body, rejection_line and the enum", () => {
    const b = body();
    const rejection = fnBody(BOTH, "rejection_line");
    const decl = blockAfter(BOTH, /\benum GuardError\b/);
    for (const f of allFns(BOTH)) {
      if (f.body === b || f.name === "rejection_line") continue;
      expect(count(f.body, "InstanceExists"), `fn ${f.name}`).toBe(0);
    }
    expect(count(rejection, "InstanceExists")).toBe(1);
    expect(count(decl, "InstanceExists")).toBe(1);
    expect(count(BOTH, "InstanceExists")).toBe(
      count(b, "InstanceExists") + count(rejection, "InstanceExists") + count(decl, "InstanceExists"),
    );
  });

  it("removes the temp at depth 0, after the binding that holds the link result", () => {
    const b = body();
    const link = b.indexOf("hard_link(");
    const lets = [...b.matchAll(/\blet\s+(?:mut\s+)?[a-z_]\w*\s*(?::[^=;]*)?=/g)]
      .map((m) => m.index ?? -1)
      .filter((i) => i < link && depthAt(b, i) === 0);
    expect(lets.length, "a depth-0 binding holds the fallible result").toBeGreaterThan(0);
    const removes = [...b.matchAll(/remove_file\(/g)]
      .map((m) => m.index ?? -1)
      .filter((i) => i > link && depthAt(b, i) === 0);
    expect(removes.length, "an unconditional remove_file after the link").toBeGreaterThan(0);
  });
});
