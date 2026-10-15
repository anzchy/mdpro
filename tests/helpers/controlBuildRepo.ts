/**
 * Fixture and fake child-process spawner for the WI-10 (ADR-0047) build-entry
 * tests (`tests/control/control-build-entry.test.ts`).
 *
 * `mkBuildRepo()` is a real tmp git repo inside a `GitSandbox`, laid out like
 * mdpro where the entry looks (ignore rules, `Cargo.lock`, `node_modules`
 * package.json files). `makeFakeRun()` is the only fake: it stands in for
 * cargo, `pnpm tauri build` and codesign, and writes artifacts where the real
 * tools would, so the tests read files back instead of checking call arguments.
 *
 * Knobs (`FakeKnobs`) make one tool fail or misbehave. Two of them succeed but
 * leave an artifact out (WI-15): `omitBuiltSidecar` — cargo exits 0 and writes
 * nothing; `omitMainBinary` — tauri exits 0 and writes `dist/`, but no
 * `Contents/MacOS/tauri-app`. `seedStale()` plants a stale manifest so a test
 * can prove a failed build removed it.
 *
 * The fake `pnpm tauri build` names the bundle the way Tauri does (ADR-0047
 * WI-002): `<productName>.app`, where `productName` is the fixture's
 * `src-tauri/tauri.conf.json` merge-patched (RFC 7396) with each `--config`
 * value in order — inline JSON when it starts with `{`, otherwise a path
 * relative to the call's cwd. `appPath()` uses the same computation, and
 * `mkBuildRepo({ verifyOverlay: true })` copies the real verify overlay.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GitSandbox } from "./controlGitRepo";
import { mergePatch, type Json } from "./jsonMergePatch";

export type Profile = "release" | "verify";

export type RunOpts = { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean };
export type RunResult = { status: number | null; stdout: string; stderr: string };
export type RunCall = {
  cmd: string;
  args: string[];
  env: Record<string, string | undefined>;
  binariesExisted: boolean;
};

export type FakeKnobs = {
  failCargo?: boolean;
  /** cargo exits 0 but writes no `release/mdpro_mcp`. */
  omitBuiltSidecar?: boolean;
  failTauri?: boolean;
  /** tauri exits 0 and writes `dist/`, but no `Contents/MacOS/tauri-app`. */
  omitMainBinary?: boolean;
  omitId?: boolean;
  staleId?: boolean;
  editTrackedDuringTauri?: boolean;
  failCodesign?: boolean;
  codesignNoCdhash?: boolean;
  codesignIdentifier?: string;
};

export type FakeRun = ((cmd: string, args: string[], opts?: RunOpts) => RunResult) & { calls: RunCall[] };

/** A valid 64-hex id that is never a real run's id (the `staleId` knob). */
export const V2 = "fedcba9876543210".repeat(4);

/** Real ad-hoc `codesign -dvvv` output (WI-6 fixture); `Executable=` is set per call. */
export const CODESIGN_LINES = [
  "Identifier=tauri_app-f283913162faab95",
  "Format=app bundle with Mach-O thin (arm64)",
  "CodeDirectory v=20400 size=159160 flags=0x20002(adhoc,linker-signed) hashes=4970+0 location=embedded",
  "Hash type=sha256 size=32",
  "CandidateCDHash sha256=6140cd9271f655c037829fe53d1fc93b80de994e",
  "CandidateCDHashFull sha256=6140cd9271f655c037829fe53d1fc93b80de994e6cb3338db3b24a9789dc85ca",
  "Hash choices=sha256",
  "CMSDigest=6140cd9271f655c037829fe53d1fc93b80de994e6cb3338db3b24a9789dc85ca",
  "CMSDigestType=2",
  "CDHash=6140cd9271f655c037829fe53d1fc93b80de994e",
  "Signature=adhoc",
  "Info.plist=not bound",
  "TeamIdentifier=not set",
  "Sealed Resources=none",
  "Internal requirements=none",
];

/** The codesign text the fake prints for an `.app` at `appPath`. */
export function codesignText(appPath: string, lines: string[] = CODESIGN_LINES): string {
  return `${[`Executable=${appPath}/Contents/MacOS/tauri-app`, ...lines].join("\n")}\n`;
}

const TAURI_LOCK = ["version = 4", "", "[[package]]", 'name = "tauri"', 'version = "2.9.5"', ""].join("\n");

export const binFile = (repo: string) =>
  path.join(repo, "src-tauri", "binaries", "mdpro_mcp-aarch64-apple-darwin");
export const targetDir = (repo: string, profile: Profile) =>
  profile === "verify" ? path.join(repo, "src-tauri", "target", "verify") : path.join(repo, "src-tauri", "target");
export const bundleDir = (repo: string, profile: Profile) =>
  path.join(targetDir(repo, profile), "release", "bundle", "macos");
export const manifestPath = (repo: string, profile: Profile) =>
  path.join(bundleDir(repo, profile), "build-manifest.json");

/** The real verify overlay, copied into fixtures by `mkBuildRepo({ verifyOverlay: true })`. */
export const REAL_VERIFY_OVERLAY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src-tauri",
  "tauri.verify.conf.json",
);
/** The overlay's `--config` value, repo-relative posix (what the entry passes). */
export const VERIFY_OVERLAY_ARG = "src-tauri/tauri.verify.conf.json";
const DEFAULT_PRODUCT_NAME = "mdpro";

/** Read a JSON file, or `{}` when it is absent. */
function readJsonOrEmpty(p: string): Json {
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Json) : {};
}

/**
 * The `productName` Tauri would build under: the fixture's base config merged
 * with each `--config` value in order (inline JSON, or a path relative to `cwd`).
 */
export function mergedProductName(repo: string, configs: string[], cwd: string = repo): string {
  let merged = readJsonOrEmpty(path.join(repo, "src-tauri", "tauri.conf.json"));
  for (const value of configs) {
    const patch = value.startsWith("{") ? (JSON.parse(value) as Json) : readJsonOrEmpty(path.resolve(cwd, value));
    merged = mergePatch(merged, patch);
  }
  const name = typeof merged === "object" && merged !== null && !Array.isArray(merged) ? merged.productName : null;
  return typeof name === "string" ? name : DEFAULT_PRODUCT_NAME;
}

/** The `.app` the fake writes for `profile` (verify adds the overlay, when present). */
export const appPath = (repo: string, profile: Profile) => {
  const configs = profile === "verify" ? [VERIFY_OVERLAY_ARG] : [];
  return path.join(bundleDir(repo, profile), `${mergedProductName(repo, configs)}.app`);
};
export const mainBinary = (repo: string, profile: Profile) =>
  path.join(appPath(repo, profile), "Contents", "MacOS", "tauri-app");
export const builtSidecar = (repo: string, profile: Profile) =>
  path.join(targetDir(repo, profile), "release", "mdpro_mcp");

/** Plant a stale `{"stale":true}` manifest for `profile`. */
export function seedStale(repo: string, profile: Profile): void {
  const p = manifestPath(repo, profile);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{"stale":true}\n');
}

/** The bytes the fake cargo writes (`tgtName` is the target dir's last segment). */
export function sidecarBytes(tgtName: string, buildId: string | undefined, features: string | undefined): string {
  return `sidecar|tgt=${tgtName}|build=${buildId ?? "<unset>"}|features=${features ?? ""}`;
}

export type BuildRepoOptions = { commit?: boolean; cliVersion?: string; verifyOverlay?: boolean };

/** The matrix's `mkBuildRepo()`: a real committed tmp repo shaped like mdpro. */
export function mkBuildRepo(sb: GitSandbox, name: string, options: BuildRepoOptions = {}): string {
  const repo = sb.init(name);
  sb.write(repo, "src/a.ts", "A0\n");
  sb.write(repo, "src-tauri/src/main.rs", "fn main() {}\n");
  sb.write(repo, "src-tauri/tauri.conf.json", '{ "productName": "mdpro" }\n');
  sb.write(repo, ".gitignore", "dist\n");
  sb.write(repo, "src-tauri/.gitignore", "/target/\n/gen/schemas\n");
  sb.write(repo, "src-tauri/binaries/.gitignore", "*\n!.gitignore\n");
  sb.write(repo, "src-tauri/Cargo.lock", TAURI_LOCK);
  sb.write(repo, "node_modules/@tauri-apps/api/package.json", '{ "name": "@tauri-apps/api", "version": "2.12.1" }\n');
  const cli = JSON.stringify({ name: "@tauri-apps/cli", version: options.cliVersion ?? "2.12.1" });
  sb.write(repo, "node_modules/@tauri-apps/cli/package.json", `${cli}\n`);
  if (options.verifyOverlay) sb.write(repo, VERIFY_OVERLAY_ARG, fs.readFileSync(REAL_VERIFY_OVERLAY, "utf8"));
  if (options.commit ?? true) sb.commitAll(repo, "base");
  return repo;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Every value following `flag` in `args`, in order. */
function valuesAfter(args: string[], flag: string): string[] {
  return args.flatMap((a, i) => (a === flag && i + 1 < args.length ? [args[i + 1]] : []));
}

function writeFile(p: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** The matrix's fake `run(cmd, args, opts)`, recording every call. */
export function makeFakeRun(repo: string, knobs: FakeKnobs = {}): FakeRun {
  const calls: RunCall[] = [];
  const ok = (stderr = ""): RunResult => ({ status: 0, stdout: "", stderr });
  const run = (cmd: string, args: string[], opts: RunOpts = {}): RunResult => {
    const env = opts.env ?? process.env;
    const tgt = env.CARGO_TARGET_DIR ?? path.join(repo, "src-tauri", "target");
    const tgtName = path.basename(path.dirname(`${tgt}/x`));
    calls.push({ cmd, args: [...args], env: { ...env }, binariesExisted: fs.existsSync(binFile(repo)) });
    const features = valueAfter(args, "--features");

    if (cmd === "cargo") {
      if (knobs.failCargo) return { status: 101, stdout: "", stderr: "fake cargo: build failed" };
      if (knobs.omitBuiltSidecar) return ok();
      writeFile(path.join(tgt, "release", "mdpro_mcp"), sidecarBytes(tgtName, env.MDPRO_BUILD_ID, features));
      return ok();
    }
    if (cmd === "pnpm") {
      if (knobs.failTauri) return { status: 1, stdout: "", stderr: "fake tauri: build failed" };
      if (knobs.editTrackedDuringTauri) fs.appendFileSync(path.join(repo, "src/a.ts"), "edited during build\n");
      writeFile(path.join(repo, "dist", "index.html"), `dist|${features ?? ""}`);
      const id = knobs.omitId ? "" : knobs.staleId ? V2 : (env.MDPRO_BUILD_ID ?? "");
      const appName = `${mergedProductName(repo, valuesAfter(args, "--config"), opts.cwd ?? repo)}.app`;
      const app = path.join(tgt, "release", "bundle", "macos", appName);
      if (!knobs.omitMainBinary) writeFile(path.join(app, "Contents", "MacOS", "tauri-app"), `BIN\0${id}\0`);
      if (fs.existsSync(binFile(repo))) {
        writeFile(path.join(app, "Contents", "MacOS", "mdpro_mcp"), fs.readFileSync(binFile(repo)));
      }
      return ok();
    }
    if (cmd === "codesign") {
      const target = path.resolve(opts.cwd ?? repo, args[args.length - 1] ?? "");
      if (knobs.failCodesign || !target.endsWith(".app") || !fs.existsSync(target)) {
        return { status: 1, stdout: "", stderr: "fake codesign: not a signed app bundle" };
      }
      let lines = CODESIGN_LINES;
      if (knobs.codesignNoCdhash) lines = lines.filter((l) => !l.startsWith("CDHash="));
      if (knobs.codesignIdentifier !== undefined) {
        lines = lines.map((l) => (l.startsWith("Identifier=") ? `Identifier=${knobs.codesignIdentifier}` : l));
      }
      return ok(codesignText(target, lines));
    }
    return { status: 127, stdout: "", stderr: `fake run: unexpected command ${cmd}` };
  };
  return Object.assign(run, { calls });
}
