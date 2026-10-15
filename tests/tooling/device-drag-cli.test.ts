// @vitest-environment node
/**
 * D113-WI-2: the device drag driver's process layer — the `drag.mjs` CLI, the
 * `drag.sh` wrapper (precompiled executor only; `drag.sh install` is the one
 * path that compiles), and static checks on `drag.swift`.
 *
 * Real child processes throughout. The Swift executor is never run here (it
 * posts real HID events); a fake `drag-bin` in a tmp `MDPRO_DRAG_BIN_DIR`
 * records what it receives, and a fake `swiftc` on PATH stands in for the
 * compiler in the install case. Messages are pinned as literals.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildDragPlan, parseDragArgs } from "../../scripts/device/dragPlan.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEVICE = path.join(REPO_ROOT, "scripts/device");
const DRAG_MJS = path.join(DEVICE, "drag.mjs");
const DRAG_SH = path.join(DEVICE, "drag.sh");
const DRAG_SWIFT = path.join(DEVICE, "drag.swift");

const tmps: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "d113-drag-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function runSh(args: string[], env: Record<string, string>) {
  return spawnSync("/bin/sh", [DRAG_SH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** A fake executor that copies its stdin to `stdin.txt` and exits `code`. */
function fakeBin(dir: string, code = 0): string {
  const bin = path.join(dir, "drag-bin");
  fs.writeFileSync(bin, `#!/bin/sh\ncat > "${dir}/stdin.txt"\necho ran > "${dir}/ran.txt"\nexit ${code}\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

describe("drag.mjs CLI", () => {
  it("prints the plan as JSON and exits 0 on valid arguments", () => {
    const argv = ["10", "20", "300", "400", "--copy", "--steps", "4"];
    const r = spawnSync(process.execPath, [DRAG_MJS, ...argv], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    const printed = JSON.parse(r.stdout);
    expect(printed).toEqual(buildDragPlan(parseDragArgs(argv).opts));
    expect(printed[0]).toEqual({ type: "altDown" });
    expect(printed[1]).toEqual({ type: "down", x: 10, y: 20, alt: true });
    expect(printed.filter((e: { type: string }) => e.type === "dragged")).toHaveLength(4);
  });

  it("exits 64 with a drag: message and usage, and prints nothing to stdout, on invalid arguments", () => {
    const r = spawnSync(process.execPath, [DRAG_MJS, "1", "2", "3"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.status).toBe(64);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("drag: expected 4 coordinates, got 3");
    expect(r.stderr).toContain("usage: drag.sh x1 y1 x2 y2 [--copy] [--steps N]");
  });

  it("exits 64 on a too-short drag", () => {
    const r = spawnSync(process.execPath, [DRAG_MJS, "0", "0", "2", "2"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.status).toBe(64);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("drag: drag distance below 5 points");
  });
});

describe("drag.sh — drag path never compiles", () => {
  it("exits 3 with the install hint when the executor is missing, and creates no binary", () => {
    const binDir = tmpDir();
    const r = runSh(["0", "0", "100", "100"], { MDPRO_DRAG_BIN_DIR: binDir });
    const bin = path.join(binDir, "drag-bin");
    expect(r.status).toBe(3);
    expect(r.stderr).toContain(
      `drag: executor missing or stale at ${bin}; run 'drag.sh install' first (not during a device run)`,
    );
    expect(r.stdout).toBe("");
    expect(fs.existsSync(bin)).toBe(false);
    expect(fs.readdirSync(binDir)).toEqual([]);
  });

  it("exits 3 without running the executor when it is older than drag.swift", () => {
    const binDir = tmpDir();
    const bin = fakeBin(binDir);
    const old = new Date("2001-01-01T00:00:00Z");
    fs.utimesSync(bin, old, old);
    const r = runSh(["0", "0", "100", "100"], { MDPRO_DRAG_BIN_DIR: binDir });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain(`drag: executor missing or stale at ${bin}`);
    expect(fs.existsSync(path.join(binDir, "ran.txt"))).toBe(false);
    expect(fs.statSync(bin).mtime.getTime()).toBe(old.getTime());
  });

  it("pipes exactly the drag.mjs plan to a fresh executor and exits with its status", () => {
    const binDir = tmpDir();
    fakeBin(binDir, 0);
    const argv = ["5", "6", "50", "60", "--steps", "3"];
    const r = runSh(argv, { MDPRO_DRAG_BIN_DIR: binDir });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(binDir, "stdin.txt"))).toBe(true);
    const received = fs.readFileSync(path.join(binDir, "stdin.txt"), "utf8");
    expect(JSON.parse(received)).toEqual(buildDragPlan(parseDragArgs(argv).opts));
  });

  it("propagates the executor's failure status (e.g. 2, no Accessibility)", () => {
    const binDir = tmpDir();
    fakeBin(binDir, 2);
    const r = runSh(["0", "0", "100", "100"], { MDPRO_DRAG_BIN_DIR: binDir });
    expect(r.status).toBe(2);
  });

  it("exits 64 on a parse error and never starts the executor", () => {
    const binDir = tmpDir();
    fakeBin(binDir, 0);
    const r = runSh(["0", "0", "100"], { MDPRO_DRAG_BIN_DIR: binDir });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("drag: expected 4 coordinates, got 3");
    expect(fs.existsSync(path.join(binDir, "ran.txt"))).toBe(false);
    expect(fs.existsSync(path.join(binDir, "stdin.txt"))).toBe(false);
  });

  it("has no swiftc anywhere on the drag path (after the install branch)", () => {
    const text = fs.readFileSync(DRAG_SH, "utf8");
    const marker = "# --- drag path: nothing below this line compiles ---";
    expect(text).toContain(marker);
    const dragPath = text.slice(text.indexOf(marker));
    expect(dragPath).not.toMatch(/swiftc/);
    expect(text.slice(0, text.indexOf(marker))).toMatch(/swiftc -O -o "\$BIN"/);
    expect(text).toMatch(/^set -eu$/m);
  });
});

describe("drag.sh install", () => {
  it("compiles with swiftc -O -o BIN drag.swift and prints the binary's sha256", () => {
    const binDir = path.join(tmpDir(), "tools");
    const fakeTools = tmpDir();
    const argsLog = path.join(fakeTools, "args.txt");
    fs.writeFileSync(
      path.join(fakeTools, "swiftc"),
      `#!/bin/sh\necho "$@" > "${argsLog}"\nwhile [ $# -gt 0 ]; do\n  if [ "$1" = "-o" ]; then printf 'fake-binary' > "$2"; fi\n  shift\ndone\n`,
    );
    fs.chmodSync(path.join(fakeTools, "swiftc"), 0o755);
    const r = runSh(["install"], { MDPRO_DRAG_BIN_DIR: binDir, PATH: `${fakeTools}:${process.env.PATH}` });
    const bin = path.join(binDir, "drag-bin");
    expect(r.status).toBe(0);
    expect(fs.existsSync(argsLog)).toBe(true);
    expect(fs.readFileSync(argsLog, "utf8").trim()).toBe(`-O -o ${bin} ${DRAG_SWIFT}`);
    const hex = createHash("sha256").update("fake-binary").digest("hex");
    expect(r.stdout.trim()).toBe(`drag: installed ${bin} sha256 ${hex}`);
  });

  it("fails non-zero when swiftc fails", () => {
    const binDir = tmpDir();
    const fakeTools = tmpDir();
    fs.writeFileSync(path.join(fakeTools, "swiftc"), "#!/bin/sh\nexit 1\n");
    fs.chmodSync(path.join(fakeTools, "swiftc"), 0o755);
    const r = runSh(["install"], { MDPRO_DRAG_BIN_DIR: binDir, PATH: `${fakeTools}:${process.env.PATH}` });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("drag: installed");
  });
});

describe("drag.swift — static checks", () => {
  const src = (): string => fs.readFileSync(DRAG_SWIFT, "utf8");

  it("posts only leftMouseDown, leftMouseDragged and leftMouseUp mouse types", () => {
    const s = src();
    const types = new Set([...s.matchAll(/\.(leftMouse\w+|rightMouse\w+|otherMouse\w+|mouseMoved)\b/g)].map((m) => m[1]));
    expect([...types].sort()).toEqual(["leftMouseDown", "leftMouseDragged", "leftMouseUp"]);
    expect(s).toMatch(/mouseEventSource:/);
    expect(s).toMatch(/\.cghidEventTap/);
  });

  it("never posts a plain mouse move", () => {
    expect(src()).not.toMatch(/mouseMoved/);
  });

  it("checks AXIsProcessTrusted and exits 2 with the permission message", () => {
    const s = src();
    expect(s).toMatch(/AXIsProcessTrusted\(\)/);
    expect(s).toContain(
      "drag: this process lacks Accessibility permission; run it from a terminal that has it (System Settings → Privacy & Security → Accessibility)",
    );
    expect(s).toMatch(/exit\(2\)/);
  });

  it("holds Option with virtual key 58 and the alternate mask, and stays under 150 lines", () => {
    const s = src();
    expect(s).toMatch(/virtualKey:\s*58/);
    expect(s).toMatch(/\.maskAlternate/);
    expect(s).toMatch(/mouseEventClickState/);
    expect(s.split("\n").length).toBeLessThan(150);
  });
});
