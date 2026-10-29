// Stands in for the `cargo` process only. Every run touches fake-cargo/ran and, when the
// receipt sidecar exists, copies it to fake-cargo/seen.json (what a lane could read mid-run).
// With fake-cargo/judge.json it derives libtest text from the real bytes of the Rust files
// it names: a case whose file lacks `testMarker` is not compiled in; one whose file holds
// `prodMarker` passes; otherwise it fails at `file:line` with `message`. Without judge.json
// it prints fake-cargo/stdout.txt and stderr.txt and exits with fake-cargo/code.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const read = (name) => (existsSync(`fake-cargo/${name}`) ? readFileSync(`fake-cargo/${name}`, "utf8") : "");
writeFileSync("fake-cargo/ran", "ran");
if (existsSync(".claude/tdd-guardian/evidence.json")) copyFileSync(".claude/tdd-guardian/evidence.json", "fake-cargo/seen.json");
if (existsSync("fake-cargo/judge.json")) {
  const cases = JSON.parse(read("judge.json"));
  const targets = [...new Set(cases.map((c) => c.target))];
  let failedAny = false;
  for (const target of targets) {
    process.stderr.write(`     Running unittests src/lib.rs (target/debug/deps/${target}-0123456789abcdef)\n`);
    const live = cases.filter((c) => c.target === target).filter((c) => {
      const path = `src-tauri/${c.file}`;
      return existsSync(path) && readFileSync(path, "utf8").includes(c.testMarker);
    });
    const failed = live.filter((c) => !readFileSync(`src-tauri/${c.file}`, "utf8").includes(c.prodMarker));
    failedAny ||= failed.length > 0;
    let out = `\nrunning ${live.length} tests\n`;
    for (const c of live) out += `test ${c.name} ... ${failed.includes(c) ? "FAILED" : "ok"}\n`;
    if (failed.length) {
      out += "\nfailures:\n\n";
      for (const c of failed) out += `---- ${c.name} stdout ----\n\nthread '${c.name}' (7) panicked at ${c.file}:${c.line}:9:\n${c.message}\nnote: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace\n\n`;
      out += `failures:\n${failed.map((c) => `    ${c.name}\n`).join("")}\n`;
    }
    out += `test result: ${failed.length ? "FAILED" : "ok"}. ${live.length - failed.length} passed; ${failed.length} failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\n`;
    process.stdout.write(out);
  }
  process.exitCode = failedAny ? 101 : 0;
} else {
  process.stderr.write(read("stderr.txt"));
  process.stdout.write(read("stdout.txt"));
  process.exitCode = Number(read("code").trim() || "0");
}
