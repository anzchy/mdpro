/**
 * Purpose: The launcher's `doctor` decisions (ADR-0047 WI-003 WI-5), as one
 * pure function over the facts the driver (`doctor.mjs`) collected: eight
 * blocking checks, the informational lines, and the verdict. No I/O.
 *
 * Pipeline: facts → `evaluate` → `{ lines, exit, verdict }`, where `lines` is
 *   the 8 check lines (`[pass] <label>` | `[FAIL] <label>: <detail>` followed
 *   by `  next: <step>` | `[skip] <label>: manifest unavailable`), then the
 *   `[info]` lines, then `verdict: <pass | fail | NOT VERIFIED>`.
 *
 * Key decisions:
 * - Conjunction: every check runs; `exit` is 0 if and only if none fails.
 * - Unknown blocks: a fact that is not its one good value fails (a scan or
 *   probe of `"unknown"`, a lock whose liveness is unknown).
 * - D2: any `.lock` blocks, live or stale. A stale lock names its run and the
 *   next step `clean <run>`; doctor never cleans anything itself.
 * - A lock leftover that blocks launches (doctorLeftovers `blocksLaunch`: what
 *   the next acquire refuses on and nothing clears) fails `no run lock` when
 *   `.lock` itself is absent, naming every such file; its `[info]` line
 *   carries the `rm`. Other leftovers are `[info]` only (D174).
 * - The verdict is `NOT VERIFIED` if and only if `sourceTree matches` fails;
 *   a manifest that cannot be read skips the three checks that read it.
 * - Leftover run dirs, `.instance.json.*.tmp` files (named against their
 *   run), a stale `si.sock` and the fixed outside-state list are `[info]`
 *   only and never change the exit. Each lock leftover (D174) is one
 *   `[info] lock leftover <name>: …` line, worded by doctorLeftovers.mjs.
 * - The stale-`si.sock` hint names a `clean` that really removes it: `<run>`
 *   when run dirs exist, else the stale lock's run, else any valid run name
 *   (`clean` of an absent run unlinks a stale socket); a corrupt lock is
 *   named as the thing to fix first, because `clean` refuses on it.
 * - Lines carry run names, pids, manifest `buildId` / `profile` and fixed
 *   paths only: never a nonce, a digest or a token, and no home path except
 *   inside a lock leftover's `rm '<absolute path>'`, which must name the
 *   passwd home's realpath to be exact (`~` would expand `$HOME`). The
 *   corrupt-lock step stays home-relative, `~/…`.
 *
 * @module scripts/control/doctorChecks
 * @coordinates-with scripts/control/doctor.mjs (collects the facts, prints the lines)
 * @coordinates-with scripts/control/runDir.mjs (runsParent, layout().siSock)
 * @coordinates-with scripts/control/buildSteps.mjs (buildLayout: the bundle path)
 * @coordinates-with scripts/control/clean.mjs (absent-run clean: the stale-socket hint's command)
 * @coordinates-with scripts/control/doctorLeftovers.mjs (leftoverLine: the lock leftover lines)
 */
import path from "node:path";
import { buildLayout } from "./buildSteps.mjs";
import { blocksLaunch, leftoverLine } from "./doctorLeftovers.mjs";
import { layout, runsParent } from "./runDir.mjs";

const PLACEHOLDER_ROOT = "/r";
const BUNDLE_REL = `./${path.relative(PLACEHOLDER_ROOT, buildLayout(PLACEHOLDER_ROOT, "verify").app)}`;
const ANY_RUN = "0".repeat(25);
const SI_SOCK = layout(runsParent("/"), ANY_RUN).siSock;
const LOCK_HOME_REL = `~${path.join(runsParent("/"), ".lock")}`;

const NEXT_BUILD = "pnpm control:build --profile verify";
const NEXT_QUIT = "pnpm control:quit";
const NEXT_RERUN = "pnpm control:doctor";
const NEXT_LEFTOVERS = `remove the blocking lock leftovers listed below, then ${NEXT_RERUN}`;
const MANIFEST_UNAVAILABLE = "manifest unavailable";
const OUTSIDE_STATE = [
  `outside run dir: ${SI_SOCK}`,
  "outside run dir: WebKit and Caches (measured on macOS 26.3.1; macOS 13 unmeasured)",
  "outside run dir: MCP client configs (4), not touched",
];

/** A check outcome: pass, skip, or fail with its detail and next step. */
const pass = () => ({ kind: "pass" });
const skip = () => ({ kind: "skip" });
const fail = (detail, next) => ({ kind: "fail", detail, next });

/** @param {any} m @returns {boolean} */
const manifestOk = (m) => m !== null && typeof m === "object" && m.ok === true;

/**
 * The run lock can be taken: no `.lock`, and no lock leftover that blocks
 * launches (D174). A failing `.lock` is judged first and keeps its own step.
 * @param {any} lock @param {unknown} leftovers
 */
function lockCheck(lock, leftovers) {
  const state = lock && typeof lock === "object" ? lock.state : undefined;
  if (state === "absent") {
    const all = Array.isArray(leftovers) ? leftovers : [];
    const blocking = all.filter((e) => blocksLaunch(e, all)).map((e) => e.name);
    if (blocking.length === 0) return pass();
    return fail(`lock leftover blocks launches: ${blocking.join(", ")}`, NEXT_LEFTOVERS);
  }
  if (state === "held" && typeof lock.run === "string") {
    if (lock.live === true) return fail(`lock held by run ${lock.run} (live)`, `${NEXT_QUIT} ${lock.run}`);
    if (lock.live === false) return fail(`stale lock names run ${lock.run}`, `pnpm control:clean ${lock.run}`);
    return fail(`lock held by run ${lock.run} (liveness unknown)`, `${NEXT_QUIT} ${lock.run}`);
  }
  return fail("lock unreadable", `inspect ${LOCK_HOME_REL} by hand`);
}

/** @param {unknown} pids */
function pidsCheck(pids) {
  if (!Array.isArray(pids)) return fail("process scan unknown", NEXT_RERUN);
  if (pids.length === 0) return pass();
  return fail(`${pids.map((p) => `pid ${p}`).join(", ")} running`, NEXT_QUIT);
}

/** @param {unknown} sock @param {string} sockPath */
function sockCheck(sock, sockPath) {
  if (sock === "absent" || sock === "stale") return pass();
  if (sock === "live") return fail(`live listener at ${sockPath}`, NEXT_QUIT);
  return fail("probe unknown", NEXT_RERUN);
}

/** @param {any} f @param {string} sockPath @returns {[string, ReturnType<typeof pass | typeof fail>][]} */
function checks(f, sockPath) {
  const m = f.manifest;
  const ok = manifestOk(m);
  const tree = () => {
    if (f.sourceTreeMatches === true) return pass();
    if (f.sourceTreeMatches === false) return fail("tree differs from the manifest", NEXT_BUILD);
    return fail("source tree unknown", NEXT_BUILD);
  };
  return [
    ["bundle present", f.bundlePresent === true ? pass() : fail(`missing ${BUNDLE_REL}`, NEXT_BUILD)],
    ["manifest readable", ok ? pass() : fail(String(m?.why ?? "unreadable"), NEXT_BUILD)],
    [
      "buildId known",
      !ok ? skip() : typeof m.buildId === "string" && m.buildId !== "" && m.buildId !== "unknown"
        ? pass()
        : fail(`buildId is ${JSON.stringify(m.buildId ?? null)}`, NEXT_BUILD),
    ],
    [
      "profile is verify",
      !ok ? skip() : m.profile === "verify" ? pass() : fail(`profile is ${JSON.stringify(m.profile ?? null)}`, NEXT_BUILD),
    ],
    ["sourceTree matches", ok ? tree() : skip()],
    ["no run lock", lockCheck(f.lock, f.lockLeftovers)],
    ["no verify binary running", pidsCheck(f.verifyPids)],
    ["si.sock not live", sockCheck(f.siSock, sockPath)],
  ];
}

/**
 * How to remove a stale `si.sock`. With run dirs, `clean <run>` of one of
 * them; with none, `clean` of an absent run removes it, so name the stale
 * lock's run when there is one (it is released too) and any valid name
 * otherwise. A corrupt lock makes `clean` refuse, so it comes first.
 * @param {any} f @returns {string}
 */
function sockHint(f) {
  if (Array.isArray(f.leftoverRuns) && f.leftoverRuns.length > 0) return "pnpm control:clean <run> removes it";
  const lock = f.lock && typeof f.lock === "object" ? f.lock : {};
  if (lock.state === "held" && typeof lock.run === "string") return `pnpm control:clean ${lock.run} removes it`;
  if (lock.state === "absent") return `pnpm control:clean ${ANY_RUN} removes it; any absent run name works`;
  return `fix the lock first, then pnpm control:clean ${ANY_RUN} removes it`;
}

/** @param {any} f @param {string} sockPath @returns {string[]} */
function infoLines(f, sockPath) {
  const out = [];
  for (const run of Array.isArray(f.leftoverRuns) ? f.leftoverRuns : []) out.push(`leftover run ${run}`);
  for (const t of Array.isArray(f.leftoverTmps) ? f.leftoverTmps : []) out.push(`leftover tmp ${t.run}/${t.file}`);
  const leftovers = Array.isArray(f.lockLeftovers) ? f.lockLeftovers : [];
  for (const e of leftovers) out.push(leftoverLine(e, leftovers));
  if (f.siSock === "stale") out.push(`stale si.sock ${sockPath} (${sockHint(f)})`);
  return [...out, ...OUTSIDE_STATE].map((l) => `[info] ${l}`);
}

/**
 * Judge the collected facts.
 * @param {{ bundlePresent: boolean,
 *   manifest: { ok: true, buildId: unknown, profile: unknown } | { ok: false, why: string },
 *   sourceTreeMatches: boolean | "unknown",
 *   lock: { state: "absent" } | { state: "corrupt" } | { state: "held", run: string, live: boolean | "unknown" },
 *   lockLeftovers?: import("./doctorLeftovers.mjs").Leftover[],
 *   verifyPids: number[] | "unknown", siSock: "live" | "stale" | "absent" | "unknown",
 *   leftoverRuns: string[], leftoverTmps: { run: string, file: string }[],
 *   siSockPath?: string }} facts `siSockPath` defaults to the app's fixed path
 * @returns {{ lines: string[], exit: 0 | 1, verdict: "pass" | "fail" | "NOT VERIFIED" }}
 */
export function evaluate(facts) {
  const f = facts ?? {};
  const sockPath = typeof f.siSockPath === "string" ? f.siSockPath : SI_SOCK;
  const lines = [];
  let failed = false;
  let treeFailed = false;
  for (const [label, r] of checks(f, sockPath)) {
    if (r.kind === "pass") lines.push(`[pass] ${label}`);
    else if (r.kind === "skip") lines.push(`[skip] ${label}: ${MANIFEST_UNAVAILABLE}`);
    else {
      failed = true;
      if (label === "sourceTree matches") treeFailed = true;
      lines.push(`[FAIL] ${label}: ${r.detail}`, `  next: ${r.next}`);
    }
  }
  lines.push(...infoLines(f, sockPath));
  const verdict = treeFailed ? "NOT VERIFIED" : failed ? "fail" : "pass";
  lines.push(`verdict: ${verdict}`);
  return { lines, exit: failed ? 1 : 0, verdict };
}
