#!/usr/bin/env node
/**
 * Purpose: The command a dtrack Claude Code hook runs (D177-WI-2). With the
 * hook JSON on stdin it spools the event (`pushCore.enqueue`), starts a
 * detached `push.mjs --flush` and exits 0 at once; `--flush` replays the
 * spool to the receiver (`pushCore.flush`). It always exits 0, so the hook
 * can never block or fail the session.
 *
 * Pipeline: stdin → JSON object → enqueue → spawn(node, [self, "--flush"],
 *   { detached, stdio: "ignore" }).unref() → exit 0 | `--flush` → flush → exit 0.
 *
 * Key decisions:
 * - The hook dir is `$MDPRO_HOOK_DIR`, else `~/.mdpro-redesign/hooks`.
 * - The fast path waits at most 500 ms for its locks, less if reading stdin
 *   already used part of the `HOOK_BUDGET_MS`; past that the payload goes to
 *   orphan.jsonl without a seq, so the hook stays < 1 s. A stdin that never
 *   closes is cut off after `STDIN_LIMIT_MS`.
 * - Malformed stdin (not JSON, not an object, empty) is logged and dropped.
 * - The request goes through node's fetch, never curl, so the token is not on
 *   any argv visible in `ps`. Errors are logged by name only.
 *
 * @module scripts/device/hooks/push
 * @coordinates-with scripts/device/hooks/pushCore.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enqueue, flush, hookPaths } from "./pushCore.mjs";
import { logLine } from "./pushStore.mjs";

const STARTED = Date.now();
const STDIN_LIMIT_MS = 400;
const HOOK_BUDGET_MS = 850; // stdin + lock waits; node start-up comes on top
const LOCK_WAIT_MS = 500;
const MAX_STDIN_BYTES = 4 * 1024 * 1024;
const dir = process.env.MDPRO_HOOK_DIR || path.join(os.homedir(), ".mdpro-redesign", "hooks");
const logCtx = { fs, now: () => new Date() };
const log = (msg) => logLine(logCtx, hookPaths(dir), msg);
const errName = (e) => (e && typeof e.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "Error");

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    const done = (why) => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve({ text: Buffer.concat(chunks).toString("utf8"), why });
    };
    const timer = setTimeout(() => done("timeout"), STDIN_LIMIT_MS);
    process.stdin.on("data", (c) => {
      size += c.length;
      if (size > MAX_STDIN_BYTES) return done("too large");
      chunks.push(c);
    });
    process.stdin.on("end", () => done(null));
    process.stdin.on("error", () => done("error"));
  });
}

function parsePayload({ text, why }) {
  if (why) return { error: `stdin ${why}` };
  if (text.trim() === "") return { error: "stdin empty" };
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return { payload: v };
    return { error: "stdin is not a JSON object" };
  } catch {
    return { error: "stdin is not JSON" };
  }
}

function spawnFlusher() {
  const self = fileURLToPath(import.meta.url);
  spawn(process.execPath, [self, "--flush"], { detached: true, stdio: "ignore", env: process.env }).unref();
}

async function main() {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.argv.includes("--flush")) {
    await flush({ dir });
    return;
  }
  const parsed = parsePayload(await readStdin());
  if (parsed.error) {
    log(`malformed hook input: ${parsed.error}`);
    return;
  }
  const lockWaitMs = Math.max(0, Math.min(LOCK_WAIT_MS, HOOK_BUDGET_MS - (Date.now() - STARTED)));
  const r = enqueue({ dir, lockWaitMs }, parsed.payload);
  if (r.seq !== null) spawnFlusher();
}

main()
  .catch((e) => log(`push failed: ${errName(e)}`))
  .finally(() => process.exit(0));
