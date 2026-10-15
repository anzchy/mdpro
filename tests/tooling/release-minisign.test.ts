// @vitest-environment node
/**
 * D76-WI-4: signature validity, not just non-emptiness. `minisign.mjs` checks
 * a Tauri `.sig` (base64 of a minisign signature file) against the
 * tauri.conf.json `pubkey` with node:crypto only; `verify-assets` runs it on
 * every signed file. Plan cases M1..M6, plus the CLI wiring.
 *
 * Law: verifyFile accepts exactly the (bytes, sig, key) triples the matching
 * private key produced; any single-byte change to the file, the trusted
 * comment or the key makes it reject with a typed reason, and nothing throws.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { joinSig, makeMinisignKey, signParts, signTauri } from "../support/minisignFixture";
import { REPO, completeSet, replace, windowsFiles, writeRepoFiles, writeSet, type AssetFile } from "../support/releaseSet";
import { int, mulberry32 } from "../support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { REASONS, parsePublicKey, parseSignature, verifyFile } from "../../scripts/release/minisign.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main as verifyAssetsMain } from "../../scripts/release/verify-assets.mjs";

type Verdict = { ok: boolean; reason?: string };
const key = makeMinisignKey();
const other = makeMinisignKey();
const DATA = Buffer.from("\u001f\u008b the updater archive bytes");
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

describe("verifyFile (M1..M5)", () => {
  it("REASONS is the closed set of typed failures", () => {
    expect([...REASONS].sort()).toEqual(
      ["bad-algorithm", "bad-base64", "bad-global-signature", "bad-signature", "key-id-mismatch"].sort(),
    );
  });

  it("M1 a valid prehashed (ED) signature over the bytes → ok", () => {
    expect(verifyFile(DATA, signTauri(key, DATA), key.tauriPubkey)).toEqual({ ok: true });
  });

  it("M1 a legacy (Ed) signature → ok", () => {
    expect(verifyFile(DATA, signTauri(key, DATA, { alg: "Ed" }), key.tauriPubkey)).toEqual({ ok: true });
  });

  it("M1 a trailing newline after the .sig text is tolerated", () => {
    expect(verifyFile(DATA, `${signTauri(key, DATA)}\n`, key.tauriPubkey).ok).toBe(true);
  });

  it("M2 one flipped byte in the file → bad-signature", () => {
    const flipped = Buffer.from(DATA);
    flipped[3] ^= 0x01;
    expect(verifyFile(flipped, signTauri(key, DATA), key.tauriPubkey)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("M2 property (seed 7604): flipping any one byte at a random offset → bad-signature", () => {
    const r = mulberry32(7604);
    const sig = signTauri(key, DATA);
    for (let i = 0; i < 40; i++) {
      const b = Buffer.from(DATA);
      b[int(r, 0, b.length - 1)] ^= 1 << int(r, 0, 7);
      expect(verifyFile(b, sig, key.tauriPubkey).reason).toBe("bad-signature");
    }
  });

  it("M3 signed with a second key → key-id-mismatch", () => {
    expect(verifyFile(DATA, signTauri(other, DATA), key.tauriPubkey)).toEqual({ ok: false, reason: "key-id-mismatch" });
  });

  it("M3b a second key stamped with the expected key id → bad-signature", () => {
    const forged = signTauri(other, DATA, { stampKeyId: key.keyId });
    expect(verifyFile(DATA, forged, key.tauriPubkey).reason).toBe("bad-signature");
  });

  it("M4 trusted comment altered → bad-global-signature", () => {
    const parts = signParts(key, DATA);
    const sig = joinSig({ ...parts, trusted: `${parts.trusted}x` });
    expect(verifyFile(DATA, sig, key.tauriPubkey)).toEqual({ ok: false, reason: "bad-global-signature" });
  });

  it("M4b global signature line from another signature → bad-global-signature", () => {
    const a = signParts(key, DATA);
    const b = signParts(key, DATA, { trustedComment: "timestamp:1\tfile:other" });
    expect(verifyFile(DATA, joinSig({ ...a, globalLine: b.globalLine }), key.tauriPubkey).reason).toBe("bad-global-signature");
  });

  it("an unknown algorithm in the signature → bad-algorithm", () => {
    const parts = signParts(key, DATA);
    const raw = Buffer.from(parts.sigLine, "base64");
    raw.write("XX", 0, "latin1");
    expect(verifyFile(DATA, joinSig({ ...parts, sigLine: raw.toString("base64") }), key.tauriPubkey).reason).toBe(
      "bad-algorithm",
    );
  });

  it.each([
    ["empty", ""],
    ["garbage", "not base64 at all!!"],
    ["base64 of junk", b64("hello")],
    ["three lines only", b64("untrusted comment: x\nAAAA\ntrusted comment: y\n")],
    ["sig line too short", b64(`untrusted comment: x\n${b64("EDshort")}\ntrusted comment: y\n${b64("g")}\n`)],
    ["no trusted-comment prefix", joinSig({ ...signParts(key, DATA), trusted: "comment: nope" })],
  ])("M5 %s signature → bad-base64, no throw", (_l, sig) => {
    expect(verifyFile(DATA, sig, key.tauriPubkey)).toEqual({ ok: false, reason: "bad-base64" });
  });

  it.each([null, undefined, 42, {}])("M5 non-string signature %j → bad-base64, no throw", (sig) => {
    expect(verifyFile(DATA, sig, key.tauriPubkey).reason).toBe("bad-base64");
  });

  it.each([["empty", ""], ["garbage", "%%%"], ["junk", b64("untrusted comment: k\nAAAA\n")]])(
    "M5 %s public key → bad-base64, no throw",
    (_l, pub) => {
      expect(verifyFile(DATA, signTauri(key, DATA), pub).reason).toBe("bad-base64");
    },
  );

  it("non-buffer file bytes → not ok, no throw", () => {
    const v: Verdict = verifyFile(undefined, signTauri(key, DATA), key.tauriPubkey);
    expect(v.ok).toBe(false);
  });
});

describe("parsePublicKey / parseSignature (M6)", () => {
  it("M6 the real tauri.conf.json pubkey parses: key id 08058EFE2F4419D7, algorithm Ed", () => {
    const conf = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
    const p = parsePublicKey(conf.plugins.updater.pubkey);
    expect(p).toMatchObject({ ok: true, algorithm: "Ed", keyIdHex: "08058EFE2F4419D7" });
    expect(p.publicKey).toHaveLength(32);
  });

  it("a generated key parses back to its own id and raw key", () => {
    const p = parsePublicKey(key.tauriPubkey);
    expect(p).toMatchObject({ ok: true, algorithm: "Ed", keyIdHex: key.keyIdHex });
    expect(Buffer.compare(p.keyId, key.keyId)).toBe(0);
    expect(Buffer.compare(p.publicKey, key.rawPublic)).toBe(0);
  });

  it("a public key with algorithm other than Ed → bad-algorithm", () => {
    const raw = Buffer.concat([Buffer.from("ED"), key.keyId, key.rawPublic]);
    const pub = b64(`untrusted comment: minisign public key: ${key.keyIdHex}\n${b64(raw)}\n`);
    expect(parsePublicKey(pub)).toEqual({ ok: false, reason: "bad-algorithm" });
  });

  it("parseSignature returns algorithm, key id and trusted comment", () => {
    const s = parseSignature(signTauri(key, DATA, { trustedComment: "timestamp:5\tfile:a" }));
    expect(s).toMatchObject({ ok: true, algorithm: "ED", trustedComment: "timestamp:5\tfile:a" });
    expect(Buffer.compare(s.keyId, key.keyId)).toBe(0);
    expect(s.signature).toHaveLength(64);
    expect(s.globalSignature).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
describe("verify-assets runs the signature check on every signed file", () => {
  let root: string;
  let dir: string;
  let outDir: string;
  let err: string[];
  const run = (files: AssetFile[], extra: string[] = []): number => {
    writeSet(dir, files);
    return verifyAssetsMain(
      ["--dir", dir, "--version", "0.3.1", "--repo", REPO, "--pub-date", "2026-10-10T00:00:00Z", "--out", outDir, ...extra],
      { cwd: root, out: () => {}, err: (s: string) => err.push(s) },
    );
  };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "d76-minisign-")));
    dir = path.join(root, "artifacts");
    outDir = path.join(root, "release-set");
    err = [];
    writeRepoFiles(root, key, { "0.3.1": "### Fixed\n- a fix" });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("a set signed by the configured key → exit 0", () => {
    expect(run(completeSet(key, "0.3.1"))).toBe(0);
  });

  it("a set signed by another key → exit 1, key-id-mismatch, nothing written", () => {
    expect(run(completeSet(other, "0.3.1"))).toBe(1);
    expect(err.join("\n")).toContain("key-id-mismatch");
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("an archive changed after signing → exit 1, bad-signature naming the archive", () => {
    const set = replace(completeSet(key, "0.3.1"), "mdpro_x64.app.tar.gz", Buffer.from("rebuilt bytes"));
    expect(run(set)).toBe(1);
    expect(err.join("\n")).toMatch(/mdpro_x64\.app\.tar\.gz.*bad-signature/);
  });

  it("an optional Windows installer with a wrong-key sig → exit 1", () => {
    expect(run([...completeSet(key, "0.3.1"), ...windowsFiles(other, "0.3.1")])).toBe(1);
  });

  it("a non-minisign .sig (non-empty garbage) → exit 1, bad-base64", () => {
    expect(run(replace(completeSet(key, "0.3.1"), "mdpro_aarch64.app.tar.gz.sig", "garbage"))).toBe(1);
    expect(err.join("\n")).toContain("bad-base64");
  });

  it("no tauri.conf.json → exit 1 (fail closed), nothing written", () => {
    fs.rmSync(path.join(root, "src-tauri"), { recursive: true, force: true });
    expect(run(completeSet(key, "0.3.1"))).toBe(1);
    expect(err.join("\n")).toMatch(/pubkey|tauri\.conf/);
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("a tauri.conf.json without plugins.updater.pubkey → exit 1", () => {
    fs.writeFileSync(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ plugins: {} }));
    expect(run(completeSet(key, "0.3.1"))).toBe(1);
  });

  it("--tauri-conf points at another config", () => {
    const alt = path.join(root, "alt.conf.json");
    fs.writeFileSync(alt, JSON.stringify({ plugins: { updater: { pubkey: other.tauriPubkey } } }));
    expect(run(completeSet(other, "0.3.1"), ["--tauri-conf", alt])).toBe(0);
  });
});
