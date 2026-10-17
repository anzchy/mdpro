/**
 * Purpose: The command-line layer of the launcher verbs (ADR-0047 WI-003
 * WI-9): one argv parser per verb (`doctor`, `launch`, `quit`, `clean`) and
 * `main(verb, argv, io)`, which each driver's `pathToFileURL` shim calls.
 *
 * Pipeline: argv → drop one leading `--` (pnpm's separator) → `parse*Args`
 *   → `UsageError` (exit 2: `<verb>: <reason>` on stderr, the usage line
 *   last on stdout) | `run(args, { out: redacted paths, err })` → `r.exit`
 *   | a thrown error → `formatError` (exit 1).
 *
 * Key decisions:
 * - The parsers are pure lookups and throw before any I/O, so a bad command
 *   line touches no file, no lock and no process.
 * - A usage error is the one outcome whose last line is not a verdict: it
 *   is `usage: …`, and the exit is 2 (0 pass, 1 refusal or failure).
 * - A flag's value is never an option token: a missing next token or one
 *   starting with `-` is `<flag> needs a value` (D82 M3), matching the rule
 *   that a positional starting with `-` is an unknown option.
 * - Flags are looked up with `Object.hasOwn`, never `in`, so inherited keys
 *   (`toString`, `constructor`, `__proto__`) are plain positionals (D82 L1).
 * - Value checks that belong to a driver stay there (`--view-mode`, the run
 *   name grammar); the parser only checks shape, `--via` against `open`, and
 *   `--control` against `on|eval` and against `--into` (ADR-0047 WI-009).
 * - Every stdout line passes through `redact` with the repo root and home
 *   (a printed path reads `./…` / `~/…`). Secrets are already redacted by
 *   the drivers, which alone know them. The home here is display-only: the
 *   CLI layer writes no file.
 * - `runIfMain` is the `pathToFileURL(path.resolve(argv[1]))` shim of
 *   `build.mjs`, shared so each verb ends with one line.
 *
 * @module scripts/control/launcherCli
 * @coordinates-with scripts/control/doctor.mjs, launch.mjs, quit.mjs, clean.mjs (shims)
 * @coordinates-with scripts/control/launcherFormat.mjs (redact, formatError)
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isControlMode } from "./controlOptin.mjs";
import { formatError, redact } from "./launcherFormat.mjs";

const PNPM_SEPARATOR = "--";
const EXIT_USAGE = 2;
const EXIT_FAIL = 1;

/** The one-line synopsis per verb; the usage line is `usage: <synopsis>`. */
export const SYNOPSIS = {
  doctor: "pnpm control:doctor",
  launch: "pnpm control:launch [--into <run>] [--via open] [--view-mode source|wysiwyg] [<file>]",
  quit: "pnpm control:quit [<run>]",
  clean: "pnpm control:clean <run>",
};

/** A command line the verb cannot run; `message` is the usage line, `reason` says why. */
export class UsageError extends Error {
  /** @param {keyof typeof SYNOPSIS} verb @param {string} reason */
  constructor(verb, reason) {
    super(`usage: ${SYNOPSIS[verb]}`);
    this.name = "UsageError";
    this.reason = reason;
  }
}

/** @param {string[]} argv */
const tokens = (argv) => (argv[0] === PNPM_SEPARATOR ? argv.slice(1) : [...argv]);

/**
 * Split argv into flags (each taking one non-option value) and positionals.
 * @param {"launch" | "quit" | "clean" | "doctor"} verb
 * @param {string[]} argv
 * @param {Record<string, string>} flags flag → args key
 */
function split(verb, argv, flags) {
  const out = /** @type {Record<string, string>} */ ({});
  const positional = [];
  const list = tokens(argv);
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (Object.hasOwn(flags, t)) {
      const value = list[i + 1];
      if (value === undefined || value.startsWith("-")) throw new UsageError(verb, `${t} needs a value`);
      out[flags[t]] = value;
      i++;
    } else if (t.startsWith("-")) {
      throw new UsageError(verb, `unknown option ${t}`);
    } else {
      positional.push(t);
    }
  }
  return { out, positional };
}

/** `doctor` takes no arguments. @param {string[]} argv */
export function parseDoctorArgs(argv) {
  const { positional } = split("doctor", argv, {});
  if (positional.length > 0) throw new UsageError("doctor", "takes no arguments");
  return {};
}

/** @param {string[]} argv @returns {{ into?: string, via?: string, viewMode?: string, control?: string, file?: string }} */
export function parseLaunchArgs(argv) {
  const flags = { "--into": "into", "--via": "via", "--view-mode": "viewMode", "--control": "control" };
  const { out, positional } = split("launch", argv, flags);
  if (out.via !== undefined && out.via !== "open") throw new UsageError("launch", `unknown --via ${out.via}`);
  if (out.control !== undefined && out.into !== undefined) {
    throw new UsageError("launch", "--control applies only to a new run");
  }
  if (out.control !== undefined && !isControlMode(out.control)) {
    throw new UsageError("launch", `unknown --control ${out.control}`);
  }
  if (positional.length > 1) throw new UsageError("launch", "at most one file");
  return positional.length === 1 ? { ...out, file: positional[0] } : out;
}

/** @param {string[]} argv @returns {{ run?: string }} */
export function parseQuitArgs(argv) {
  const { positional } = split("quit", argv, {});
  if (positional.length > 1) throw new UsageError("quit", "at most one run");
  return positional.length === 1 ? { run: positional[0] } : {};
}

/** @param {string[]} argv @returns {{ run: string }} */
export function parseCleanArgs(argv) {
  const { positional } = split("clean", argv, {});
  if (positional.length !== 1) throw new UsageError("clean", "needs exactly one run");
  return { run: positional[0] };
}

const PARSERS = { doctor: parseDoctorArgs, launch: parseLaunchArgs, quit: parseQuitArgs, clean: parseCleanArgs };

/** The process-bound io a shim passes to `main`: real stdout / stderr, the repo root and home for redaction. */
export function processIo() {
  return {
    out: (/** @type {string} */ l) => process.stdout.write(`${l}\n`),
    err: (/** @type {string} */ l) => process.stderr.write(`${l}\n`),
    repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
    homeDir: os.homedir(),
  };
}

/**
 * Parse, run, map to an exit code.
 * @param {keyof typeof SYNOPSIS} verb
 * @param {string[]} argv
 * @param {{ run: (args: any, deps: any) => Promise<{ exit: number }>, out: (l: string) => void, err: (l: string) => void, repoRoot: string, homeDir: string }} io
 * @returns {Promise<number>} 0 pass, 1 refusal or failure, 2 usage error
 */
export async function main(verb, argv, io) {
  const paths = { repoRoot: io.repoRoot, homeDir: io.homeDir };
  const out = (/** @type {string} */ line) => io.out(redact(line, paths));
  let args;
  try {
    args = PARSERS[verb](argv);
  } catch (e) {
    const usage = /** @type {UsageError} */ (e);
    io.err(`${verb}: ${usage.reason}`);
    out(usage.message);
    return EXIT_USAGE;
  }
  try {
    const r = await io.run(args, { out, err: io.err });
    return r.exit;
  } catch (e) {
    out(formatError(e, paths));
    return EXIT_FAIL;
  }
}

/**
 * The shim body every verb ends with: run `main` when the file is the entry.
 * @param {string} metaUrl the verb module's `import.meta.url`
 * @param {keyof typeof SYNOPSIS} verb
 * @param {(args: any, deps: any) => Promise<{ exit: number }>} run
 * @returns {boolean} whether this module was the entry point
 */
export function runIfMain(metaUrl, verb, run) {
  if (pathToFileURL(path.resolve(String(process.argv[1]))).href !== metaUrl) return false;
  /* v8 ignore start -- only reached in a real `node scripts/control/<verb>.mjs` process (RX-07 spawns one) */
  main(verb, process.argv.slice(2), { run, ...processIo() }).then((code) => {
    process.exitCode = code;
  });
  return true;
  /* v8 ignore stop */
}
