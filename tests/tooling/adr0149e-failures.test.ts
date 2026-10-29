// @vitest-environment node
/**
 * ADR0149E-1a (AC-1, ADR-0149 d1): the failure parsers turn a Vitest JSON report and
 * libtest text into per-test outcomes with id, kind, assertion location and message.
 * Shapes follow real runs (vitest 3.2.4, rustc 1.99), recorded in the prep notes.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { failuresOf, libtestOutcomes, vitestOutcomes } from "../../scripts/tdd/receipt-failures.mjs";

const cwd = "/work/repo";
const frame = (file: string, line: number, col = 5) => `    at ${cwd}/${file}:${line}:${col}`;
const vendor = "    at file:///work/repo/node_modules/.pnpm/@vitest+runner@3.2.4/node_modules/@vitest/runner/dist/chunk-hooks.js:155:11";
type Case = { ancestorTitles: string[]; title: string; status: string; failureMessages?: string[] };
const report = (file: string, cases: Case[], message = "") => ({
  testResults: [{ name: `${cwd}/${file}`, message, assertionResults: cases.map((c) => ({ ...c, fullName: [...c.ancestorTitles, c.title].join(" "), failureMessages: c.failureMessages ?? [] })) }],
});
const id = (...parts: string[]) => JSON.stringify(parts);

describe("ADR0149E-1a vitest outcomes", () => {
  it("records an assertion failure with its spec-file location and message", () => {
    const outcomes = vitestOutcomes(report("tests/a.test.ts", [
      { ancestorTitles: ["save"], title: "keeps the dirty flag", status: "failed", failureMessages: [`AssertionError: expected false to be true // Object.is equality\n    at Proxy.<anonymous> (file:///work/repo/node_modules/.pnpm/@vitest+expect@3.2.4/node_modules/@vitest/expect/dist/index.js:1155:10)\n${frame("tests/a.test.ts", 4, 19)}\n${vendor}`] },
    ]), cwd);
    expect(outcomes.get(id("tests/a.test.ts", "save", "keeps the dirty flag"))).toEqual({
      status: "failed", kind: "assertion", location: { file: "tests/a.test.ts", line: 4 }, message: "AssertionError: expected false to be true // Object.is equality",
    });
  });

  it("classifies a throw outside expect as panic and expect.assertions as assertion", () => {
    const outcomes = vitestOutcomes(report("tests/a.test.ts", [
      { ancestorTitles: [], title: "throws", status: "failed", failureMessages: [`TypeError: cannot read x of undefined\n${frame("tests/a.test.ts", 7, 11)}`] },
      { ancestorTitles: [], title: "counts", status: "failed", failureMessages: [`Error: expected number of assertions to be 2, but got 1\n${vendor}`] },
    ]), cwd);
    expect(outcomes.get(id("tests/a.test.ts", "throws"))).toMatchObject({ kind: "panic", location: { file: "tests/a.test.ts", line: 7 } });
    expect(outcomes.get(id("tests/a.test.ts", "counts"))).toMatchObject({ kind: "assertion", location: null, message: "Error: expected number of assertions to be 2, but got 1" });
  });

  it("takes the first frame under tests/ when the assertion is in a support helper", () => {
    const outcomes = vitestOutcomes(report("tests/a.test.ts", [
      { ancestorTitles: [], title: "helper", status: "failed", failureMessages: [`AssertionError: expected 1 to be 2\n${frame("tests/support/h.ts", 3)}\n${frame("tests/a.test.ts", 9)}`] },
    ]), cwd);
    expect(outcomes.get(id("tests/a.test.ts", "helper")).location).toEqual({ file: "tests/support/h.ts", line: 3 });
  });

  it("keeps ancestor boundaries, CJK titles, and passing and skipped states", () => {
    const outcomes = vitestOutcomes(report("tests/a.test.ts", [
      { ancestorTitles: ["a b"], title: "c", status: "passed" },
      { ancestorTitles: ["a"], title: "b c", status: "skipped" },
      { ancestorTitles: ["保存"], title: "中文", status: "todo" },
    ]), cwd);
    expect([...outcomes.keys()].sort()).toEqual([id("tests/a.test.ts", "a b", "c"), id("tests/a.test.ts", "a", "b c"), id("tests/a.test.ts", "保存", "中文")].sort());
    expect(outcomes.get(id("tests/a.test.ts", "a b", "c")).status).toBe("passed");
    expect(outcomes.get(id("tests/a.test.ts", "a", "b c")).status).toBe("skipped");
    expect(outcomes.get(id("tests/a.test.ts", "保存", "中文")).status).toBe("skipped");
    expect(failuresOf(outcomes)).toEqual([]);
  });

  it("reads a plain Error that starts with expected, and a timeout, as panic", () => {
    const outcomes = vitestOutcomes(report("tests/a.test.ts", [
      { ancestorTitles: [], title: "plain", status: "failed", failureMessages: [`Error: expected a file\n${frame("tests/a.test.ts", 3)}`] },
      { ancestorTitles: [], title: "slow", status: "failed", failureMessages: ["Error: Test timed out in 5000ms.\nIf this is a long-running test, pass a timeout value as the last argument or configure it globally with \"testTimeout\"."] },
    ]), cwd);
    expect(outcomes.get(id("tests/a.test.ts", "plain")).kind).toBe("panic");
    expect(outcomes.get(id("tests/a.test.ts", "slow")).kind).toBe("panic");
  });

  it("refuses duplicate test ids, whatever their status", () => {
    const failed = { ancestorTitles: ["s"], title: "same", status: "failed", failureMessages: ["AssertionError: x"] };
    expect(() => vitestOutcomes(report("tests/a.test.ts", [failed, failed]), cwd)).toThrow(/duplicate/i);
    expect(() => vitestOutcomes(report("tests/a.test.ts", [failed, { ...failed, status: "passed", failureMessages: [] }]), cwd)).toThrow(/duplicate/i);
  });

  it("reports a suite that failed to collect as a collect outcome for the file", () => {
    const outcomes = vitestOutcomes(report("tests/a.test.ts", [], "Error: Cannot find module '../src/new.mjs'"), cwd);
    expect(outcomes.get(id("tests/a.test.ts"))).toMatchObject({ status: "failed", kind: "collect" });
  });

  it("strips ANSI, makes absolute repo paths relative and caps the message", () => {
    const long = "y".repeat(5000);
    const outcomes = vitestOutcomes(report("tests/a.test.ts", [
      { ancestorTitles: [], title: "ansi", status: "failed", failureMessages: [`\u001b[31mAssertionError: expected '${cwd}/tests/x' to be 'b'\u001b[39m\n${frame("tests/a.test.ts", 2)}`] },
      { ancestorTitles: [], title: "long", status: "failed", failureMessages: [`AssertionError: ${long}`] },
    ]), cwd);
    expect(outcomes.get(id("tests/a.test.ts", "ansi")).message).toBe("AssertionError: expected 'tests/x' to be 'b'");
    expect(outcomes.get(id("tests/a.test.ts", "long")).message).toHaveLength(2000);
  });

  it("lists failures sorted by id with their kind, location and message", () => {
    const outcomes = vitestOutcomes(report("tests/a.test.ts", [
      { ancestorTitles: [], title: "z", status: "failed", failureMessages: [`AssertionError: z\n${frame("tests/a.test.ts", 5)}`] },
      { ancestorTitles: [], title: "a", status: "failed", failureMessages: [`TypeError: a\n${frame("tests/a.test.ts", 3)}`] },
      { ancestorTitles: [], title: "ok", status: "passed" },
    ]), cwd);
    expect(failuresOf(outcomes)).toEqual([
      { id: id("tests/a.test.ts", "a"), kind: "panic", location: { file: "tests/a.test.ts", line: 3 }, message: "TypeError: a" },
      { id: id("tests/a.test.ts", "z"), kind: "assertion", location: { file: "tests/a.test.ts", line: 5 }, message: "AssertionError: z" },
    ]);
  });
});

const failingStdout = `
running 5 tests
test save_tests::eq_fails ... FAILED
test save_tests::ignored ... ignored
test save_tests::panics_plain ... FAILED
test save_tests::passes ... ok
test save_tests::should_panic_wrong - should panic ... FAILED

failures:

---- save_tests::eq_fails stdout ----

thread 'save_tests::eq_fails' (1506809) panicked at src/commands/x.rs:4:38:
assertion \`left == right\` failed: sum of 2+2
  left: 4
 right: 5
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace

---- save_tests::panics_plain stdout ----

thread 'save_tests::panics_plain' (1506810) panicked at src/commands/x.rs:6:59:
index out of bounds: the len is 0 but the index is 3

---- save_tests::should_panic_wrong stdout ----

thread 'save_tests::should_panic_wrong' (1506812) panicked at src/commands/x.rs:9:31:
bang
note: panic did not contain expected string
      panic message: "bang"
 expected substring: "boom"

failures:
    save_tests::eq_fails
    save_tests::panics_plain
    save_tests::should_panic_wrong

test result: FAILED. 1 passed; 3 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s

`;
const lib = "     Running unittests src/lib.rs (target/debug/deps/tauri_app_lib-1934a56ef6a1f0f6)\n";
const rid = (target: string, name: string) => `${target}::${name}`;

describe("ADR0149E-1a libtest outcomes", () => {
  it("parses assertion, panic and should_panic failures with location and message", () => {
    const { outcomes, compileError } = libtestOutcomes(failingStdout, `   Compiling tauri-app v0.3.6\n${lib}`, cwd);
    expect(compileError).toBe(false);
    expect(outcomes.get(rid("tauri_app_lib", "save_tests::eq_fails"))).toEqual({
      status: "failed", kind: "assertion", location: { file: "src-tauri/src/commands/x.rs", line: 4 },
      message: "assertion `left == right` failed: sum of 2+2\n  left: 4\n right: 5",
    });
    expect(outcomes.get(rid("tauri_app_lib", "save_tests::panics_plain"))).toMatchObject({ kind: "panic", location: { file: "src-tauri/src/commands/x.rs", line: 6 } });
    expect(outcomes.get(rid("tauri_app_lib", "save_tests::should_panic_wrong"))).toMatchObject({ kind: "assertion", location: { file: "src-tauri/src/commands/x.rs", line: 9 } });
    expect(outcomes.get(rid("tauri_app_lib", "save_tests::passes")).status).toBe("passed");
    expect(outcomes.get(rid("tauri_app_lib", "save_tests::ignored")).status).toBe("skipped");
  });

  it("classifies assert! and did-not-panic as assertion", () => {
    const stdout = "\nrunning 2 tests\ntest t::a ... FAILED\ntest t::b - should panic ... FAILED\n\nfailures:\n\n---- t::a stdout ----\n\nthread 't::a' (1) panicked at src/a.rs:3:5:\nassertion failed: v.is_empty()\n\n---- t::b stdout ----\nnote: test did not panic as expected at src/a.rs:8:4\n\nfailures:\n    t::a\n    t::b\n\ntest result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";
    const { outcomes } = libtestOutcomes(stdout, lib, cwd);
    expect(outcomes.get(rid("tauri_app_lib", "t::a"))).toMatchObject({ kind: "assertion", message: "assertion failed: v.is_empty()" });
    expect(outcomes.get(rid("tauri_app_lib", "t::b"))).toMatchObject({ kind: "assertion", status: "failed" });
  });

  it("pairs each binary's block with its Running line, so one name in two targets is two ids", () => {
    const block = "\nrunning 1 test\ntest same::name ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";
    const stderr = `${lib}     Running tests/render_golden.rs (target/debug/deps/render_golden-2e02c06f860a7ab0)\n   Doc-tests tauri_app_lib\n`;
    const { outcomes } = libtestOutcomes(block + block + block.replace("same::name", "src/lib.rs - f (line 3)"), stderr, cwd);
    expect([...outcomes.keys()].sort()).toEqual([rid("doctest:tauri_app_lib", "src/lib.rs - f (line 3)"), rid("render_golden", "same::name"), rid("tauri_app_lib", "same::name")]);
  });

  it("refuses when blocks and Running lines do not pair", () => {
    const block = "\nrunning 1 test\ntest a ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";
    expect(() => libtestOutcomes(block + block, lib, cwd)).toThrow(/pair/i);
  });

  it("reads exit-101 output with no test result as a compile error", () => {
    const { outcomes, compileError } = libtestOutcomes("", "error[E0425]: cannot find value `x` in this scope\nerror: could not compile `tauri-app` (lib test) due to 1 previous error\n", cwd);
    expect(compileError).toBe(true);
    expect(outcomes.size).toBe(0);
  });

  it("strips ANSI colour from libtest output and keeps absolute panic paths relative", () => {
    const stdout = `\nrunning 1 test\ntest t::a ... \u001b[31mFAILED\u001b[0m\n\nfailures:\n\n---- t::a stdout ----\n\nthread 't::a' (9) panicked at ${cwd}/src-tauri/src/a.rs:3:5:\nassertion failed: ok\n\nfailures:\n    t::a\n\ntest result: \u001b[31mFAILED\u001b[0m. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n`;
    const { outcomes } = libtestOutcomes(stdout, lib, cwd);
    expect(outcomes.get(rid("tauri_app_lib", "t::a"))).toEqual({ status: "failed", kind: "assertion", location: { file: "src-tauri/src/a.rs", line: 3 }, message: "assertion failed: ok" });
  });
});
