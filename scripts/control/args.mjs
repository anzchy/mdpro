/**
 * Purpose: Parse the command line of `pnpm control:build` into the build
 * profile and the cargo feature list, or a request for help. Pure: no
 * filesystem, no process access; the entry (`build.mjs`) prints `USAGE` and
 * sets the exit code.
 *
 * Pipeline: argv → `--help`/`-h` anywhere? → `{ help: true }`
 *   → drop one leading `--` (pnpm's separator) → walk flags
 *   → `{ profile, features: sorted unique }`
 *
 * Key decisions (ADR-0047 plan, WI-9 and decision O9):
 * - `--help` / `-h` anywhere wins and nothing else is validated, so a user
 *   with a broken command line can still ask how to fix it.
 * - Both spellings are accepted: `--profile verify` / `--profile=verify` and
 *   `--features a,b` / `--features=a,b`. `--features` may repeat; the result is
 *   sorted (code-unit order) and de-duplicated, the same canonical form
 *   `computeBuildId` hashes.
 * - The space form always takes the next token as the value, even when it
 *   looks like a flag; only a missing token is "no value". This keeps feature
 *   validity exactly `isValidFeatureName` from `buildId.mjs` (shared, not
 *   copied); `--profile --features` is still rejected because `--features` is
 *   not a profile, and the message names `--profile`. A feature name may not
 *   start with `-` (WI-19), so `--features --x` is an invalid name, not a flag.
 * - `--profile` given twice is an error rather than last-wins: two profiles on
 *   one command line is a mistake, not an override.
 * - Every error is a `BuildArgsError` whose message names the offending token
 *   and ends with `USAGE`.
 *
 * @module scripts/control/args
 * @coordinates-with scripts/control/buildId.mjs (isValidFeatureName)
 * @coordinates-with scripts/control/build.mjs (prints USAGE, maps errors to exit 1)
 */
import { isValidFeatureName } from "./buildId.mjs";

const PROFILES = ["release", "verify"];
const DEFAULT_PROFILE = "release";
const HELP_TOKENS = ["--help", "-h"];
const PNPM_SEPARATOR = "--";

/** The help text the entry prints for `--help` and after every argument error. */
export const USAGE = [
  "Usage: pnpm control:build [--profile release|verify] [--features a,b] [--help]",
  "",
  "  --profile <name>   release (default) or verify; also --profile=<name>",
  "  --features <list>  comma-separated cargo features, may repeat; also --features=<list>",
  "                     each name: letters, digits, _ and -, not starting with -",
  "  -h, --help         print this text",
].join("\n");

/** Thrown for any invalid argument; the message names the token and carries `USAGE`. */
export class BuildArgsError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(`${reason}\n\n${USAGE}`);
    this.name = "BuildArgsError";
  }
}

/**
 * Split `--flag=value` into its parts; a token without `=` has no inline value.
 * @param {string} token
 * @returns {{ flag: string, inline: string | undefined }}
 */
function splitToken(token) {
  const eq = token.indexOf("=");
  if (!token.startsWith("--") || eq < 0) return { flag: token, inline: undefined };
  return { flag: token.slice(0, eq), inline: token.slice(eq + 1) };
}

/**
 * Validate one `--features` value and return its feature names.
 * @param {string} value
 * @returns {string[]}
 */
function parseFeatureList(value) {
  if (value === "") throw new BuildArgsError("--features needs a non-empty value");
  const names = value.split(",");
  if (names.includes("")) {
    throw new BuildArgsError(`--features value ${JSON.stringify(value)} contains an empty feature name`);
  }
  for (const name of names) {
    if (!isValidFeatureName(name)) {
      throw new BuildArgsError(
        `--features: invalid feature name "${name}" (allowed: letters, digits, _ and -, not starting with -)`,
      );
    }
  }
  return names;
}

/**
 * Parse the `pnpm control:build` arguments.
 *
 * @param {string[]} argv the arguments after the script name (`process.argv.slice(2)`)
 * @returns {{ help: true } | { profile: "release" | "verify", features: string[] }}
 * @throws {BuildArgsError} for an unexpected token, a missing or invalid value,
 *   or a repeated `--profile`; the message names the token and includes `USAGE`
 */
export function parseBuildArgs(argv) {
  if (argv.some((t) => HELP_TOKENS.includes(t))) return { help: true };

  const tokens = argv[0] === PNPM_SEPARATOR ? argv.slice(1) : [...argv];
  /** @type {string | undefined} */
  let profile;
  /** @type {string[]} */
  const features = [];

  for (let i = 0; i < tokens.length; i++) {
    const { flag, inline } = splitToken(tokens[i]);
    if (flag !== "--profile" && flag !== "--features") {
      throw new BuildArgsError(`unexpected token "${tokens[i]}"`);
    }
    let value = inline;
    if (value === undefined) {
      if (i + 1 >= tokens.length) throw new BuildArgsError(`${flag} needs a value`);
      value = tokens[++i];
    }
    if (flag === "--features") {
      features.push(...parseFeatureList(value));
      continue;
    }
    if (profile !== undefined) throw new BuildArgsError("--profile given more than once");
    if (value === "") throw new BuildArgsError("--profile needs a non-empty value");
    if (!PROFILES.includes(value)) {
      throw new BuildArgsError(`--profile: invalid profile "${value}" (expected ${PROFILES.join(" or ")})`);
    }
    profile = value;
  }

  return { profile: profile ?? DEFAULT_PROFILE, features: [...new Set(features)].sort() };
}
