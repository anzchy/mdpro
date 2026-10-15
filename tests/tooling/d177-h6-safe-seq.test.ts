// @vitest-environment node
/**
 * D177 hardening H-6 (audit b92): seq values stay safe integers.
 *
 * Push side: the `seq` file's seq must be a safe integer below
 * `Number.MAX_SAFE_INTEGER - 1`; at or beyond that it is corrupt and takes
 * today's corrupt path (renamed to `seq.corrupt-*`, "seq state corrupt"
 * logged, new epoch at seq 1, the event spooled). One below is still valid,
 * so seqs never repeat and never pass 2^53 − 1.
 *
 * Receiver side: `spool_fields` rejects a spool_seq above 2^53 − 1, and
 * accepting a large seq must not build a missing-seq list proportional to the
 * jump (`SeqState.apply` stays bounded by MAX_MISSING). Both are checked on
 * receiver_spool.py directly in a python child: posting a huge seq to the
 * unfixed receiver would make it allocate billions of list entries.
 *
 * Boundaries: real fs in a temp dir with an injected clock, pid probe and
 * poster (push); a python3 child importing receiver_spool.py, bytecode off.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { HOOKS_DIR } from "../support/d177Hooks";
import { EPOCH_RE, hook, useCore } from "../support/d177CoreFixture";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { enqueue } from "../../scripts/device/hooks/pushCore.mjs";

const MAX = Number.MAX_SAFE_INTEGER;
const OLD_EPOCH = "goodEpoch01";

describe("D177-H6 push seq stays safe", () => {
  const fx = useCore();
  const asides = () => fs.readdirSync(fx.dir).filter((n) => n.startsWith("seq.corrupt-"));

  it.each([
    ["MAX_SAFE_INTEGER - 1", String(MAX - 1)],
    ["MAX_SAFE_INTEGER", String(MAX)],
    ["2^53", "9007199254740992"],
    ["2^53 + 1 (reads back as 2^53)", "9007199254740993"],
    ["1e300", "1e300"],
  ])("h6a: a seq of %s is corrupt → renamed aside, new epoch, seq 1, event kept", (_n, literal) => {
    const content = `{"epoch":"${OLD_EPOCH}","seq":${literal}}`;
    fs.writeFileSync(fx.path("seq"), content);
    const r = enqueue(fx.ctx(), hook(1));
    expect(r.seq).toBe(1);
    const now = fx.seqFile();
    expect(now).toEqual({ epoch: now.epoch, seq: 1 });
    expect(now.epoch).toMatch(EPOCH_RE);
    expect(now.epoch).not.toBe(OLD_EPOCH);
    expect(fx.spool()).toEqual([expect.objectContaining({ spool_epoch: now.epoch, spool_seq: 1, n: 1 })]);
    expect(asides()).toHaveLength(1);
    expect(fs.readFileSync(fx.path(asides()[0]), "utf8")).toBe(content);
    expect(fx.pushLog()).toMatch(/seq state corrupt/);
  });

  it("h6b: two below MAX_SAFE_INTEGER is valid; the next seq is MAX_SAFE_INTEGER - 1, then a new epoch", () => {
    fs.writeFileSync(fx.path("seq"), JSON.stringify({ epoch: OLD_EPOCH, seq: MAX - 2 }));
    expect(enqueue(fx.ctx(), hook(1)).seq).toBe(MAX - 1);
    expect(fx.seqFile()).toEqual({ epoch: OLD_EPOCH, seq: MAX - 1 });
    expect(asides()).toEqual([]);
    expect(enqueue(fx.ctx(), hook(2)).seq).toBe(1);
    expect(fx.seqFile().epoch).not.toBe(OLD_EPOCH);
    const seqs = fx.spool().map((e) => e.spool_seq as number);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs.every((s) => Number.isSafeInteger(s))).toBe(true);
  });
});

/** Runs `body` (python) with receiver_spool imported; returns its JSON stdout. */
function py(body: string): unknown {
  const code = [
    "import json, sys",
    "sys.dont_write_bytecode = True",
    `sys.path.insert(0, ${JSON.stringify(HOOKS_DIR)})`,
    "import receiver_spool as rs",
    body,
  ].join("\n");
  const r = spawnSync("python3", ["-c", code], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  const out = (r.stdout ?? "").trim();
  return out === "" ? { status: r.status, signal: r.signal } : JSON.parse(out);
}

const VERDICT = `
def verdict(seq):
    body = {"spool_source": "dtrack-mini", "spool_epoch": "epochAAAA1111", "spool_seq": seq,
            "spool_ts": "2026-10-12T08:00:00Z", "spool_dead": 0}
    try:
        rs.spool_fields(body)
        return "accepted"
    except ValueError as e:
        return "rejected " + str(e)
`;

describe("D177-H6 receiver spool_seq bound", () => {
  it("h6c: spool_seq up to 2^53 - 1 is accepted, above it rejected as spool_seq", () => {
    const seqs = ["2**53 - 2", "2**53 - 1", "2**53", "2**53 + 1", "10**20"];
    const out = py(`${VERDICT}\nprint(json.dumps([verdict(eval(s)) for s in ${JSON.stringify(seqs)}]))`);
    expect(out).toEqual(["accepted", "accepted", "rejected spool_seq", "rejected spool_seq", "rejected spool_seq"]);
  });

  it("h6d: a jump to 2^53 - 1 keeps at most MAX_MISSING missing seqs and never builds a list the size of the jump", () => {
    const out = py(`
import builtins
real_range = builtins.range
def guarded_range(*a):
    r = real_range(*a)
    if len(r) > 10 * rs.MAX_MISSING:
        raise MemoryError("unbounded range of %d" % len(r))
    return r
rs.range = guarded_range
st = rs.SeqState()
f = {"spool_source": "s", "spool_epoch": "epochAAAA1111", "spool_seq": 1, "spool_dead": 0}
st.apply(f)
try:
    outcome = st.apply(dict(f, spool_seq=2**53 - 1))
except MemoryError as e:
    print(json.dumps({"error": str(e).split(" of ")[0]})); sys.exit(0)
e = st.sources["s"]
print(json.dumps({"outcome": outcome, "max": e["max"], "n": len(e["missing"]),
                  "first": e["missing"][0], "last": e["missing"][-1], "cap": rs.MAX_MISSING}))
`);
    const cap = 10_000;
    expect(out).toEqual({ outcome: "new", max: MAX, n: cap, first: MAX - cap, last: MAX - 1, cap });
  });
});
