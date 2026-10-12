/**
 * Runs a python3 snippet against scripts/device/hooks/receiver_spool.py for the
 * D177-H-4 tests: receiver_spool is imported as `rs` with bytecode writing off
 * (no __pycache__ in the repo), and the snippet prints one JSON value, which is
 * parsed and returned. A snippet that prints nothing returns its exit status and
 * stderr's last line, so a crash fails as an assertion, not as a parse error.
 */
import { spawnSync } from "node:child_process";
import { HOOKS_DIR } from "./d177Hooks";

export function pySpool(body: string): unknown {
  const code = [
    "import json, os, sys, tempfile",
    "sys.dont_write_bytecode = True",
    `sys.path.insert(0, ${JSON.stringify(HOOKS_DIR)})`,
    "import receiver_spool as rs",
    "def ev(seq, epoch='epochAAAA1111', source='s'):",
    "    return {'spool_source': source, 'spool_epoch': epoch, 'spool_seq': seq, 'spool_dead': 0}",
    body,
  ].join("\n");
  const r = spawnSync("python3", ["-c", code], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  const out = (r.stdout ?? "").trim();
  if (out === "") {
    const errLines = (r.stderr ?? "").trim().split("\n");
    return { status: r.status, signal: r.signal, stderr: errLines[errLines.length - 1] };
  }
  return JSON.parse(out);
}
