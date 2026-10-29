/**
 * Purpose: Rust spec files for the entry's `rust` lane (ADR-0145 d1, d8): validate the
 * selection, and refuse any file rustfmt would rewrite before the lane runs, because the
 * receipt fingerprints the file's bytes and a later `cargo fmt` would break it (D187).
 *
 * Key decisions:
 * - Paths are canonical, under `src-tauri/`, `.rs`, regular files, no symlinked component;
 *   one to four, as for the frontend lane.
 * - The check feeds each file's bytes to `rustfmt --edition <crate edition> --emit stdout`
 *   and compares bytes: `rustfmt --check` on stdin exits 0 even when it prints a diff
 *   (receipt_rustfmt_guard.py). The edition comes from `src-tauri/Cargo.toml`, else 2021.
 * - rustfmt is found on PATH, in CARGO_HOME or ~/.cargo, or in a rustup toolchain; not
 *   finding it refuses the record.
 * @coordinates-with scripts/tdd/red-receipt.mjs, .claude/hooks/receipt_rustfmt_guard.py (the same byte check)
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { usageError } from "./unit-red-lane.mjs";

const RUST_FILE = /^src-tauri\/(?:[^/]+\/)*[^/]+\.rs$/;
const RUSTFMT_TIMEOUT_MS = 10_000;

export function validateRustFiles(cwd, input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 4) throw usageError("Give one to four --test files under src-tauri/.");
  const files = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !RUST_FILE.test(raw) || raw.split("/").some((part) => part === "." || part === ".." || part === "") ||
        /[\u0000-\u001f\u007f-\u009f*?[\]{},\\]/.test(raw)) throw usageError(`Invalid Rust test path: ${JSON.stringify(raw)}.`);
    let current = cwd;
    for (const component of raw.split("/")) {
      let names;
      try { names = readdirSync(current); } catch { throw usageError(`Rust test path does not exist: ${raw}.`); }
      if (!names.includes(component)) throw usageError(`Rust test path is not canonical or does not exist: ${raw}.`);
      current = join(current, component);
      if (lstatSync(current).isSymbolicLink()) throw usageError(`Symlinked Rust test path is not supported: ${raw}.`);
    }
    if (!lstatSync(current).isFile()) throw usageError(`Rust test path is not a file: ${raw}.`);
    if (files.includes(raw)) throw usageError(`Duplicate Rust test path: ${raw}.`);
    files.push(raw);
  }
  return files;
}

function findRustfmt() {
  const toolchains = join(homedir(), ".rustup/toolchains");
  const candidates = [
    ...(process.env.PATH || "").split(":").filter(Boolean).map((dir) => join(dir, "rustfmt")),
    ...[process.env.CARGO_HOME, join(homedir(), ".cargo")].filter(Boolean).map((home) => join(home, "bin/rustfmt")),
    ...(existsSync(toolchains) ? readdirSync(toolchains).sort().reverse().map((name) => join(toolchains, name, "bin/rustfmt")) : []),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw usageError("rustfmt not found; install it (rustup component add rustfmt) before recording .rs files.");
  return found;
}

function edition(cwd) {
  try {
    const match = /^\s*edition\s*=\s*"(\d{4})"/m.exec(readFileSync(join(cwd, "src-tauri/Cargo.toml"), "utf8"));
    if (match) return match[1];
  } catch {}
  return "2021";
}

/** Refuse (usage error) when any file is not byte-identical to rustfmt's output. */
export function requireRustfmtClean(cwd, files) {
  const rustfmt = findRustfmt(), ed = edition(cwd), dirty = [];
  for (const file of files) {
    const bytes = readFileSync(join(cwd, file));
    const run = spawnSync(rustfmt, ["--edition", ed, "--emit", "stdout"], { input: bytes, cwd: dirname(join(cwd, file)), timeout: RUSTFMT_TIMEOUT_MS });
    if (run.status !== 0 || !Buffer.from(run.stdout || "").equals(bytes)) dirty.push(file);
  }
  if (dirty.length) throw usageError(`Not rustfmt-clean at edition ${ed}: ${dirty.join(", ")}. Run cargo fmt before recording (rule 10).`);
}
