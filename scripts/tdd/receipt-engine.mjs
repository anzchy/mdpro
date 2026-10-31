/**
 * Purpose: Load the vendored tdd-guardian receipt engine (#566) for the receipt entry, and
 * refuse to run when it is incomplete or does not load.
 *
 * Key decisions:
 * - The engine directory comes from the caller (`red-receipt.mjs` names the pinned version);
 *   nothing here reads a plugin cache, and there is no fallback to one.
 * - Every closure file must exist, `receipt.js` must compile (it is spawned, so a syntax error
 *   would otherwise surface only as a refused record), and each lib module must export the
 *   function the entry uses. That last check catches the CommonJS shim being lost: under the
 *   repo's `"type": "module"` the lib files load as empty ES namespaces instead of throwing.
 * - The SHA-256 pin is checked by tests/tooling/t566-vendor-manifest.test.ts, not at runtime.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/vendor/tdd-guardian-0.10.2/README.md
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Script } from "node:vm";
import { usageError } from "./unit-red-lane.mjs";
const require = createRequire(import.meta.url);

/** Each lib module, with the export the entry calls (`coverage` is only required by `lanes`). */
const EXPORTS = { config: "load", coverage: null, exec: "parseCounts", lanes: "runLane", verification: "verifyAll" };

/**
 * The engine's lib modules, keyed by name.
 * @param {string} dir the vendored engine directory
 * @throws usage error (code 64) naming `dir` and the file, when any closure file is missing or does not load
 */
export function loadEngine(dir) {
  const fail = (file, why) => usageError(`The vendored receipt engine at ${dir} is unusable: ${file} ${why}.`);
  for (const file of ["package.json", "receipt.js", ...Object.keys(EXPORTS).map((name) => `lib/${name}.js`)]) {
    if (!existsSync(join(dir, file))) throw fail(file, "is missing");
  }
  try { new Script(readFileSync(join(dir, "receipt.js"), "utf8"), { filename: join(dir, "receipt.js") }); }
  catch (error) { throw fail("receipt.js", `does not compile (${error instanceof Error ? error.message : String(error)})`); }
  const modules = {};
  for (const [name, used] of Object.entries(EXPORTS)) {
    const file = `lib/${name}.js`;
    try { modules[name] = require(join(dir, file)); }
    catch (error) { throw fail(file, `does not load (${error instanceof Error ? error.message : String(error)})`); }
    if (used && typeof modules[name]?.[used] !== "function") throw fail(file, `does not export ${used}; check that package.json declares "type": "commonjs"`);
  }
  return modules;
}
