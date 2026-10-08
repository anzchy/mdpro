// @vitest-environment node
/**
 * `scripts/cargo-test-lane.mjs` (WI-2, Q1): cases CL-01..03, FD-01..05,
 * CW-01..18 incl. CW-08b. No mocks. The CW cases spawn the real wrapper with
 * `process.execPath`, and the "cargo" it wraps is a fake `node -e` script.
 *
 * Laws: classifyCargoExit is the identity on the exit code except 101 with a
 * FAILED summary seen → 1, and passes signals through (CL-01, CL-03). The
 * detector is chunk-invariant (FD-02), agrees with an independent oracle
 * (FD-03), and is sticky once true (FD-04).
 */
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { classifyCargoExit, createFailedSummaryDetector } from "../scripts/cargo-test-lane.mjs";

const WRAPPER = fileURLToPath(new URL("../scripts/cargo-test-lane.mjs", import.meta.url));
const CW_TIMEOUT_MS = 10_000;

// Seeded generator (mulberry32). No fast-check by design (plan Deferred).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, 0, xs.length - 1)];

// ---------------------------------------------------------------------------
// classifyCargoExit
// ---------------------------------------------------------------------------
describe("classifyCargoExit", () => {
  it("CL-01 exhaustive: exit = (c === 101 && saw) ? 1 : c over 0..255 × saw", () => {
    for (let c = 0; c <= 255; c++) {
      for (const saw of [false, true]) {
        expect(classifyCargoExit({ code: c, signal: null, sawFailedSummary: saw }), `c=${c} saw=${saw}`).toEqual({
          exit: c === 101 && saw ? 1 : c,
        });
      }
    }
  });

  it.each([
    [0, false, 0],
    [0, true, 0],
    [1, true, 1],
    [100, true, 100],
    [101, true, 1],
    [101, false, 101],
    [102, true, 102],
    [255, true, 255],
  ])("CL-02 boundary: code %i saw %s → exit %i", (code, saw, exit) => {
    expect(classifyCargoExit({ code, signal: null, sawFailedSummary: saw })).toEqual({ exit });
  });

  it("CL-03 every signal passes through regardless of the summary", () => {
    const names = Object.keys(os.constants.signals);
    expect(names).toContain("SIGTERM");
    expect(names).toContain("SIGKILL");
    for (const name of names) {
      for (const saw of [false, true]) {
        expect(classifyCargoExit({ code: null, signal: name, sawFailedSummary: saw }), `${name} saw=${saw}`).toEqual({
          signal: name,
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// createFailedSummaryDetector
// ---------------------------------------------------------------------------
const OK_SUMMARY = "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s";
const FAILED_SUMMARY =
  "test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s";
const COLOURED =
  "test result: \x1b[31mFAILED\x1b[0m. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s";
const WHOLE_SGR = "\x1b[1m\x1b[31mtest result: FAILED.\x1b[0m";
const COMPILE_ERROR = "error: could not compile `mdpro` (lib test) due to 1 previous error";

const CORPUS = [
  OK_SUMMARY,
  FAILED_SUMMARY,
  COLOURED,
  WHOLE_SGR,
  "  test result: FAILED.",
  "note: test result: FAILED.",
  COMPILE_ERROR,
  "test result: failed.",
  "test result: FAILED",
  "running 3 tests",
  "test a::b ... ok",
  "   Compiling mdpro v0.1.0",
  "log é中🙂 test result: FAILED.",
  "",
];

function oracle(stream: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR stripping is the point
  const strip = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r$/, "");
  return stream.split("\n").some((l) => /^test result: FAILED\./.test(strip(l)));
}

function genStream(r: Rng): string {
  const n = int(r, 0, 12);
  let s = "";
  for (let i = 0; i < n; i++) s += pick(r, CORPUS) + (r() < 0.5 ? "\n" : "\r\n");
  return s;
}

function forcedCuts(s: string): number[] {
  const cuts: number[] = [];
  for (const [needle, offset] of [
    ["FAILED.", 3],
    ["\r\n", 1],
    ["\x1b[31m", 1],
  ] as const) {
    for (let i = s.indexOf(needle); i !== -1; i = s.indexOf(needle, i + 1)) cuts.push(i + offset);
  }
  return cuts;
}

function seenAfter(chunks: string[]): boolean {
  const d = createFailedSummaryDetector();
  for (const c of chunks) d.push(c);
  return d.seen();
}

describe("createFailedSummaryDetector", () => {
  it.each([
    [`${OK_SUMMARY}\n`, false],
    [`${FAILED_SUMMARY}\n`, true],
    [`${COLOURED}\n`, true],
    [`${WHOLE_SGR}\n`, true],
    [`${FAILED_SUMMARY}\r\n`, true],
    ["  test result: FAILED.\n", false],
    ["note: test result: FAILED.\n", false],
    [`${COMPILE_ERROR}\n`, false],
    ["test result: failed.\n", false],
    ["test result: FAILED\n", false],
  ])("FD-01 %j → %s", (chunk, expected) => {
    const d = createFailedSummaryDetector();
    d.push(chunk);
    expect(d.seen()).toBe(expected);
  });

  it("FD-01 nothing pushed → false", () => {
    expect(createFailedSummaryDetector().seen()).toBe(false);
  });

  it("FD-02 chunk-split metamorphic (seed 2026100811): any split ≡ one chunk", () => {
    const r = mulberry32(2026100811);
    for (let iter = 0; iter < 300; iter++) {
      const s = genStream(r);
      const cuts = [...forcedCuts(s)];
      const k = int(r, 1, 8);
      for (let j = 0; j < k && s.length > 1; j++) cuts.push(int(r, 1, s.length - 1));
      const sorted = [...new Set(cuts)].filter((c) => c > 0 && c < s.length).sort((a, b) => a - b);
      const chunks: string[] = [];
      let prev = 0;
      for (const c of sorted) {
        chunks.push(s.slice(prev, c));
        prev = c;
      }
      chunks.push(s.slice(prev));
      expect(seenAfter(chunks), `seed 2026100811 iter ${iter} cuts ${JSON.stringify(sorted)}`).toBe(seenAfter([s]));
    }
  });

  it("FD-03 independent oracle (seed 2026100812), domain not vacuous", () => {
    const r = mulberry32(2026100812);
    let trues = 0;
    let falses = 0;
    for (let iter = 0; iter < 300; iter++) {
      const s = genStream(r);
      const want = oracle(s);
      if (want) trues++;
      else falses++;
      expect(seenAfter([s]), `seed 2026100812 iter ${iter} stream ${JSON.stringify(s)}`).toBe(want);
    }
    expect(trues).toBeGreaterThanOrEqual(50);
    expect(falses).toBeGreaterThanOrEqual(50);
  });

  it("FD-04 sticky after true; seen() is pure; empty push is a no-op (seed 2026100813)", () => {
    const fresh = createFailedSummaryDetector();
    expect([fresh.seen(), fresh.seen(), fresh.seen()]).toEqual([false, false, false]);
    fresh.push("");
    expect(fresh.seen()).toBe(false);

    const r = mulberry32(2026100813);
    for (let iter = 0; iter < 100; iter++) {
      const d = createFailedSummaryDetector();
      d.push(`${FAILED_SUMMARY}\n`);
      expect(d.seen(), `seed 2026100813 iter ${iter} step 0`).toBe(true);
      const steps = int(r, 0, 20);
      for (let step = 1; step <= steps; step++) {
        const action = int(r, 0, 2);
        if (action === 0) d.push(pick(r, CORPUS) + (r() < 0.5 ? "\n" : ""));
        else if (action === 1) d.push("");
        else d.seen();
        expect(d.seen(), `seed 2026100813 iter ${iter} step ${step}`).toBe(true);
      }
    }
  });

  it("FD-05 detectors are independent", () => {
    const a = createFailedSummaryDetector();
    const b = createFailedSummaryDetector();
    a.push("test result: ");
    b.push("FAILED. 0 passed; 1 failed; 0 ignored\n");
    a.push("\n");
    expect([a.seen(), b.seen()]).toEqual([false, false]);

    const a2 = createFailedSummaryDetector();
    const b2 = createFailedSummaryDetector();
    a2.push(`${FAILED_SUMMARY}\n`);
    expect([a2.seen(), b2.seen()]).toEqual([true, false]);
  });
});

// ---------------------------------------------------------------------------
// The driver, as a real child process
// ---------------------------------------------------------------------------
type RunResult = { code: number | null; signal: NodeJS.Signals | null; stdout: Buffer; stderr: Buffer };
type Started = { child: ChildProcess; done: Promise<RunResult>; waitFor: (needle: string) => Promise<string> };

function start(args: string[], opts: { env?: NodeJS.ProcessEnv; keepStdin?: boolean } = {}): Started {
  const child = spawn(process.execPath, [WRAPPER, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: opts.env ?? process.env,
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let closed = false;
  const waiters: Array<{ needle: string; resolve: (s: string) => void; reject: (e: Error) => void }> = [];
  const check = () => {
    const text = Buffer.concat(out).toString("utf8");
    for (const w of waiters.splice(0)) {
      if (text.includes(w.needle)) w.resolve(text);
      else if (closed) w.reject(new Error(`wrapper closed before ${JSON.stringify(w.needle)}; stdout ${JSON.stringify(text)}`));
      else waiters.push(w);
    }
  };
  child.stdout?.on("data", (c: Buffer) => {
    out.push(c);
    check();
  });
  child.stderr?.on("data", (c: Buffer) => err.push(c));
  if (!opts.keepStdin) child.stdin?.end();
  const done = new Promise<RunResult>((resolve) => {
    child.on("close", (code, signal) => {
      closed = true;
      check();
      resolve({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
  });
  const waitFor = (needle: string) =>
    new Promise<string>((resolve, reject) => {
      waiters.push({ needle, resolve, reject });
      check();
    });
  return { child, done, waitFor };
}

const run = (args: string[], opts?: { env?: NodeJS.ProcessEnv }) => start(args, opts).done;
const fake = (script: string, ...extra: string[]) => [process.execPath, "-e", script, ...extra];
const lit = (s: string) => JSON.stringify(s);

const CW01_OUT =
  "running 2 tests\ntest a ... FAILED\n\nfailures:\n\ntest result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\n";
const CW01_ERR = "error: test failed, to rerun pass `--lib`\n";
const SHORT_FAILED = "test result: FAILED. 0 passed; 1 failed; 0 ignored\n";

describe("cargo-test-lane driver (real processes)", () => {
  it(
    "CW-01 FAILED summary on stdout + 101 → 1, output byte-identical",
    async () => {
      const r = await run(
        fake(`process.stdout.write(${lit(CW01_OUT)}); process.stderr.write(${lit(CW01_ERR)}); process.exit(101);`),
      );
      expect([r.code, r.signal]).toEqual([1, null]);
      expect(r.stdout.equals(Buffer.from(CW01_OUT))).toBe(true);
      expect(r.stderr.equals(Buffer.from(CW01_ERR))).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-02 summary on stderr only + 101 → 1",
    async () => {
      const r = await run(fake(`process.stderr.write(${lit(CW01_OUT)}); process.exit(101);`));
      expect(r.code).toBe(1);
      expect(r.stderr.equals(Buffer.from(CW01_OUT))).toBe(true);
      expect(r.stdout.length).toBe(0);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-03 compile error + 101 stays 101",
    async () => {
      const err =
        "error[E0425]: cannot find value `x`\nerror: could not compile `mdpro` (lib test) due to 1 previous error\n";
      const r = await run(fake(`process.stderr.write(${lit(err)}); process.exit(101);`));
      expect(r.code).toBe(101);
      expect(r.stderr.equals(Buffer.from(err))).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it.each([
    ["exit 0 with an ok summary", `process.stdout.write(${lit(`${OK_SUMMARY}\n`)}); process.exit(0);`, 0],
    ["exit 3 with no output", "process.exit(3);", 3],
    ["FAILED summary then exit 0", `process.stdout.write(${lit(SHORT_FAILED)}); process.exit(0);`, 0],
  ])(
    "CW-04 pass-through: %s",
    async (_name, script, expected) => {
      const r = await run(fake(script));
      expect(r.code).toBe(expected);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-05 several targets, FAILED in the middle → 1",
    async () => {
      const out = `${OK_SUMMARY}\n${FAILED_SUMMARY}\n${OK_SUMMARY}\n`;
      const r = await run(fake(`process.stdout.write(${lit(out)}); process.exit(101);`));
      expect(r.code).toBe(1);
      expect(r.stdout.equals(Buffer.from(out))).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-06 a summary split across stdout and stderr is not a summary",
    async () => {
      const script = `process.stdout.write("test result: ");
        setTimeout(() => {
          process.stderr.write(${lit("FAILED. 0 passed; 1 failed; 0 ignored\n")});
          process.stdout.write("\\n");
          process.exit(101);
        }, 20);`;
      const r = await run(fake(script));
      expect(r.code).toBe(101);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-07 summary written in two timed pieces → 1",
    async () => {
      const rest = "LED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";
      const script = `process.stdout.write("test result: FAI");
        setTimeout(() => { process.stdout.write(${lit(rest)}); process.exit(101); }, 30);`;
      const r = await run(fake(script));
      expect(r.code).toBe(1);
      expect(r.stdout.equals(Buffer.from(`test result: FAI${rest}`))).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-08 multi-byte UTF-8 split across writes stays byte-identical",
    async () => {
      const text = "é中🙂 ok\n";
      const script = `const b = Buffer.from(${lit(text)}); let i = 0;
        const step = () => { if (i < b.length) { process.stdout.write(b.subarray(i, i + 1)); i++; setImmediate(step); } };
        step();`;
      const r = await run(fake(script));
      expect(r.code).toBe(0);
      expect(r.stdout.equals(Buffer.from(text))).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-08b (i) invalid UTF-8 on both streams passes through byte-identical",
    async () => {
      const bytes = Buffer.from([0x68, 0xff, 0xfe, 0x0a]);
      const script = `const b = Buffer.from([0x68, 0xff, 0xfe, 0x0a]); process.stdout.write(b); process.stderr.write(b);`;
      const r = await run(fake(script));
      expect(r.code).toBe(0);
      expect(r.stdout.equals(bytes)).toBe(true);
      expect(r.stderr.equals(bytes)).toBe(true);
      expect(r.stdout.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
      expect(r.stderr.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-08b (ii) invalid bytes before the summary do not blind the detector",
    async () => {
      const script = `process.stdout.write(Buffer.from([0xff, 0xfe, 0x0a]));
        process.stdout.write(${lit(SHORT_FAILED)}); process.exitCode = 101;`;
      const r = await run(fake(script));
      expect(r.code).toBe(1);
      expect(r.stdout.equals(Buffer.concat([Buffer.from([0xff, 0xfe, 0x0a]), Buffer.from(SHORT_FAILED)]))).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-08b (iii) a UTF-8 sequence split across writes, then the summary → 1",
    async () => {
      const script = `process.stdout.write(Buffer.from([0x78, 0xc3]));
        setTimeout(() => {
          process.stdout.write(Buffer.concat([Buffer.from([0xa9, 0x0a]), Buffer.from(${lit(SHORT_FAILED)})]));
          process.exitCode = 101;
        }, 30);`;
      const r = await run(fake(script));
      expect(r.code).toBe(1);
      const expected = Buffer.concat([Buffer.from([0x78, 0xc3]), Buffer.from([0xa9, 0x0a]), Buffer.from(SHORT_FAILED)]);
      expect(r.stdout.equals(expected)).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-09 live streaming and stdin inheritance",
    async () => {
      const script = `process.stdout.write("ready\\n");
        process.stdin.once("data", (d) => { process.stdout.write("got " + d); process.exit(0); });`;
      const s = start(fake(script), { keepStdin: true });
      await s.waitFor("ready");
      s.child.stdin?.write("go\n");
      const r = await s.done;
      expect(r.code).toBe(0);
      expect(r.stdout.toString("utf8")).toBe("ready\ngot go\n");
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-10 SIGTERM to the wrapper kills the child; the wrapper dies by SIGTERM",
    async () => {
      const s = start(fake(`process.stdout.write(process.pid + " ready\\n"); setInterval(() => {}, 1e3);`));
      const text = await s.waitFor(" ready");
      const childPid = Number(/(\d+) ready/.exec(text)?.[1]);
      expect(childPid).toBeGreaterThan(0);
      s.child.kill("SIGTERM");
      const r = await s.done;
      expect([r.code, r.signal]).toEqual([null, "SIGTERM"]);
      const gone = () => {
        try {
          process.kill(childPid, 0);
          return false;
        } catch (e) {
          return (e as NodeJS.ErrnoException).code === "ESRCH";
        }
      };
      for (let i = 0; i < 20 && !gone(); i++) await new Promise((res) => setTimeout(res, 50));
      expect(() => process.kill(childPid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    },
    CW_TIMEOUT_MS,
  );

  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "CW-11 %s is forwarded to the child as itself",
    async (sig) => {
      const script = `const sig = process.argv[1];
        process.on(sig, () => { process.stdout.write("got " + sig + "\\n"); process.exit(7); });
        process.stdout.write("ready\\n"); setInterval(() => {}, 1e3);`;
      const s = start(fake(script, sig));
      await s.waitFor("ready");
      s.child.kill(sig);
      const r = await s.done;
      expect(r.code).toBe(7);
      expect(r.stdout.toString("utf8")).toContain(`got ${sig}`);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-12 arguments reach the child verbatim (no shell)",
    async () => {
      const r = await run(
        fake("process.stdout.write(JSON.stringify(process.argv.slice(1)))", "a b", '"q"', "$HOME", "--", "*"),
      );
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout.toString("utf8"))).toEqual(["a b", '"q"', "$HOME", "--", "*"]);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-13 a missing command exits 127 and names it",
    async () => {
      const r = await run(["definitely-not-a-cmd-0f3a", "test"]);
      expect(r.code).toBe(127);
      expect(r.stderr.toString("utf8")).toMatch(/^definitely-not-a-cmd-0f3a: .*ENOENT/m);
      expect(r.stdout.length).toBe(0);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-14 no arguments exits 64 with usage",
    async () => {
      const r = await run([]);
      expect(r.code).toBe(64);
      expect(r.stderr.toString("utf8")).toMatch(/usage/i);
      expect(r.stdout.length).toBe(0);
    },
    CW_TIMEOUT_MS,
  );

  it("CW-15 importing the module runs nothing (main guard)", async () => {
    // @ts-expect-error -- plain ESM script, no .d.ts by design
    const mod = await import("../scripts/cargo-test-lane.mjs");
    expect(typeof mod.classifyCargoExit).toBe("function");
    expect(typeof mod.createFailedSummaryDetector).toBe("function");
    expect(process.exitCode).toBeUndefined();
  });

  it(
    "CW-16 2 MiB before the summary: decided on close, nothing truncated",
    async () => {
      const summary = "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";
      const body = "test x ... ok\n".repeat(Math.ceil((2 * 1024 * 1024) / 14));
      const expected = Buffer.from(body + summary);
      const script = `const body = "test x ... ok\\n".repeat(Math.ceil(2 * 1024 * 1024 / 14));
        process.stdout.write(body + ${lit(summary)}); process.exitCode = 101;`;
      const r = await run(fake(script));
      expect([r.code, r.signal]).toEqual([1, null]);
      expect(r.stdout.length).toBe(expected.length);
      let firstDiff = -1;
      for (let i = 0; i < expected.length; i++) {
        if (r.stdout[i] !== expected[i]) {
          firstDiff = i;
          break;
        }
      }
      expect(firstDiff, "first differing offset").toBe(-1);
      expect(r.stdout.equals(expected)).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it.each(["SIGKILL", "SIGUSR2"] as const)(
    "CW-17 a child that dies by %s (not forwarded) never reads as success",
    async (sig) => {
      const script = `process.stdout.write("ready\\n", () => process.kill(process.pid, ${lit(sig)}));`;
      const r = await run(fake(script));
      const n = os.constants.signals[sig];
      expect(r.signal === sig || r.code === 128 + n, `code=${r.code} signal=${r.signal}`).toBe(true);
      expect(r.code).not.toBe(0);
      expect(r.code === null && r.signal === null).toBe(false);
      expect(r.stdout.equals(Buffer.from("ready\n"))).toBe(true);
    },
    CW_TIMEOUT_MS,
  );

  it(
    "CW-18 the parent environment reaches the child",
    async () => {
      const script =
        "process.stdout.write(JSON.stringify({ p: process.env.MDPRO_PROBE ?? null, h: process.env.HOME ?? null }))";
      const r = await run(fake(script), { env: { ...process.env, MDPRO_PROBE: "k=v" } });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout.toString("utf8"))).toEqual({ p: "k=v", h: process.env.HOME ?? null });
    },
    CW_TIMEOUT_MS,
  );
});
