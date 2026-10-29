// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, python, sleeper } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("never signals copied agent bytes at a Cargo-looking path even with a forged depfile", async () => {
  const h = fixture("guard-copied-agent-");
  const child = sleeper();
  try {
    fs.writeFileSync(path.join(h.dir, "Cargo.toml"), '[package]\nname="fixture"\nversion="0.0.0"\n');
    const copied = path.join(h.dir, "target/debug/deps/mdpro_tests-0123456789abcdef");
    fs.mkdirSync(path.dirname(copied), { recursive: true });
    fs.copyFileSync(fs.realpathSync("/opt/homebrew/bin/codex"), copied);
    fs.writeFileSync(copied + ".d", `${copied}: ${h.dir}/lib.rs\n`);
    fs.writeFileSync(path.join(h.dir, "lib.rs"), "// not a built test\n");
    const row = { pid: child.pid, ppid: process.pid, pgid: child.pid, uid: process.getuid!(), cwd: h.dir, executable: copied, command: `${copied} --nocapture` };
    const processFile = path.join(h.dir, "processes");
    const parent = { pid: process.pid, ppid: 1, pgid: child.pid, uid: process.getuid!(), cwd: h.dir,
      executable: path.join(process.env.HOME!, ".rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo"),
      command: "cargo test" };
    fs.writeFileSync(processFile, JSON.stringify([row, parent]));
    const env = { ...h.env, MDPRO_LOAD_GUARD_PROCESSES: processFile };
    expect(await python(`print(json.dumps(backstop.allowlisted(${JSON.stringify(row)})))`, env)).toBe(false);
    expect(await python(`print(json.dumps(list(backstop.candidate_groups(backstop.inventory()))))`, env)).toEqual([]);
    fs.writeFileSync(h.sampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
    for (let tick = 0; tick < 2; tick++) expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env })).status).toBe(0);
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
    // Merely spelling an outside binary beneath a known target via symlink
    // cannot confer cargo provenance either.
    fs.unlinkSync(copied);
    fs.symlinkSync(process.execPath, copied);
    expect(await python(`print(json.dumps(backstop.allowlisted(${JSON.stringify(row)})))`, env)).toBe(false);
  } finally { await cleanup(child); fs.rmSync(h.dir, { recursive: true, force: true }); }
}, 15000);
