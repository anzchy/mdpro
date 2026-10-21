#!/usr/bin/env node
/** Purpose: Name the prerequisites available to one CI frontend matrix leg. */
const os = process.env.RUNNER_OS;
if (os !== "Linux" && os !== "macOS") {
  process.stderr.write(`Unknown CI runner OS: ${os}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${os === "macOS" ? "macos" : "ubuntu"}\n`);
}
