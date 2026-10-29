// @vitest-environment node
/**
 * ADR0149E-2b (AC-2, regression found on the real tree): test-path classification over
 * the shapes `src-tauri/src` actually uses. `cfg(all(test, …))` gates a test module,
 * `cfg(not(test))` is production, a test module may sit inside a production module, and
 * a file the scanner cannot settle is pinned whole and marked unspliceable instead of
 * refusing every record in the repository.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { classifyTestPaths } from "../../scripts/tdd/receipt-tree.mjs";

const classify = (files: Record<string, string>) => classifyTestPaths(new Set(Object.keys(files)), (path: string) => files[path]);

describe("ADR0149E-2b classification of real Rust shapes", () => {
  it("follows cfg(all(test, …)) declarations and ignores cfg(not(test)) ones", () => {
    const result = classify({
      "src-tauri/src/commands/mod.rs": '#[cfg(all(test, unix))]\n#[path = "a_tests.rs"]\nmod a_tests;\n#[cfg(all(target_os = "macos", test))]\nmod b_tests;\n#[cfg(not(test))]\nmod real;\n',
      "src-tauri/src/commands/a_tests.rs": "#[test]\nfn a() {}\n",
      "src-tauri/src/commands/b_tests.rs": "#[test]\nfn b() {}\n",
      "src-tauri/src/commands/real.rs": "pub fn r() {}\n",
    });
    expect(result.tests).toEqual(["src-tauri/src/commands/a_tests.rs", "src-tauri/src/commands/b_tests.rs", "src-tauri/src/commands/mod.rs"]);
    expect(result.holders).toEqual(["src-tauri/src/commands/mod.rs"]);
    expect(result.unspliceable).toEqual([]);
  });

  it("finds a test module inside a production module, and its out-of-line target", () => {
    const result = classify({
      "src-tauri/src/services/window_focus.rs": '#[cfg(target_os = "macos")]\nmod menu_capture {\n    #[cfg(test)]\n    mod mapping_tests {}\n}\n#[cfg(test)]\n#[path = "window_focus_tests.rs"]\nmod tests;\n',
      "src-tauri/src/services/window_focus_tests.rs": "#[test]\nfn t() {}\n",
    });
    expect(result.tests).toEqual(["src-tauri/src/services/window_focus.rs", "src-tauri/src/services/window_focus_tests.rs"]);
    expect(result.unspliceable).toEqual([]);
  });

  it("pins a file it cannot settle whole and marks it unspliceable, without refusing", () => {
    const result = classify({
      "src-tauri/src/odd.rs": "#[cfg(any(test, feature = \"x\"))]\nmod helpers;\n",
      "src-tauri/src/broken.rs": "pub fn f() {\n",
      "src-tauri/src/plain.rs": "pub fn p() {}\n",
      "tests/a.test.ts": "",
    });
    expect(result.tests).toEqual(["src-tauri/src/broken.rs", "src-tauri/src/odd.rs", "tests/a.test.ts"]);
    expect(result.unspliceable).toEqual(["src-tauri/src/broken.rs", "src-tauri/src/odd.rs"]);
  });
});
