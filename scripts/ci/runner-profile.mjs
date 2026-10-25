#!/usr/bin/env node
/** Purpose: Name the prerequisites available to one CI frontend matrix leg. */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const os = process.env.RUNNER_OS;
if (os !== "Linux" && os !== "macOS") {
  process.stderr.write(`Unknown CI runner OS: ${os}\n`);
  process.exitCode = 1;
} else {
  const candidates = ["rustfmt", join(homedir(), ".cargo/bin/rustfmt")];
  const hasRustfmt = candidates.some((candidate) => spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0);
  const hasCodex = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;
  process.stdout.write(`${os === "macOS" ? "macos" : "ubuntu"}${hasRustfmt ? "+rustfmt" : ""}${hasCodex ? "+codex-cli" : ""}\n`);
}
