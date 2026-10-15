// @vitest-environment node
/**
 * D76-WI-3: `latest.json` — built from the final tag (never read back from
 * GitHub, plan §0.3) and validated against the verified asset set. Plan cases
 * L1..L7, plus the CHANGELOG notes source.
 *
 * Law: round trip — for any valid version and signatures,
 * `validateLatestJson(buildLatestJson(x))` accepts; changing any one checked
 * field of the built JSON makes it reject (seeded property).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { int, mulberry32, str } from "../support/seededRandom";
import { REPO, changelog, type AssetFile } from "../support/releaseSet";
import {
  buildLatestJson,
  changelogNotes,
  resolveNotes,
  validateLatestJson,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/release/latestJson.mjs";

type Latest = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
};
type Check = { ok: boolean; errors: string[] };

const SIG_A = "dW50cnVzdGVkIGNvbW1lbnQ6IGFhcmNoNjQ=";
const SIG_X = "dW50cnVzdGVkIGNvbW1lbnQ6IHg2NA==";
const PUB = "2026-10-10T08:00:00Z";

const filesFor = (sigA: string, sigX: string): AssetFile[] => [
  { name: "mdpro_aarch64.app.tar.gz.sig", data: Buffer.from(`${sigA}\n`) },
  { name: "mdpro_x64.app.tar.gz.sig", data: Buffer.from(sigX) },
];
const build = (version = "0.3.1", over: Record<string, unknown> = {}): Latest =>
  buildLatestJson({
    repo: REPO,
    version,
    notes: "### Fixed\n- a fix",
    pubDate: PUB,
    sigs: { "darwin-aarch64": `${SIG_A}\n`, "darwin-x86_64": SIG_X },
    ...over,
  });
const validate = (json: unknown, version = "0.3.1", files = filesFor(SIG_A, SIG_X)): Check =>
  validateLatestJson(json, { repo: REPO, version, files });
const clone = (j: Latest): Latest => JSON.parse(JSON.stringify(j));
const url = (tag: string, name: string, repo = REPO) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

describe("buildLatestJson", () => {
  it("L1 matches the v0.2.6 shape: keys, URL pattern, signature = sig file contents", () => {
    const v026: Latest = {
      version: "0.2.6",
      notes: "notes",
      pub_date: "2026-04-02T11:38:17Z",
      platforms: {
        "darwin-aarch64": { signature: "AAA", url: url("v0.2.6", "mdpro_aarch64.app.tar.gz") },
        "darwin-x86_64": { signature: "BBB", url: url("v0.2.6", "mdpro_x64.app.tar.gz") },
      },
    };
    const built = build("0.2.6");
    expect(Object.keys(built).sort()).toEqual(Object.keys(v026).sort());
    expect(Object.keys(built.platforms).sort()).toEqual(Object.keys(v026.platforms).sort());
    for (const p of Object.keys(v026.platforms)) {
      expect(Object.keys(built.platforms[p]).sort()).toEqual(["signature", "url"]);
      expect(built.platforms[p].url).toBe(v026.platforms[p].url);
    }
    expect(built.version).toBe("0.2.6");
    expect(built.platforms["darwin-aarch64"].signature).toBe(SIG_A);
    expect(built.platforms["darwin-x86_64"].signature).toBe(SIG_X);
  });

  it("pub_date is ISO 8601 UTC and version carries no v", () => {
    const b = build("0.3.1", { pubDate: new Date(Date.UTC(2026, 9, 10, 1, 2, 3)) });
    expect(b.pub_date).toBe("2026-10-10T01:02:03Z");
    expect(b.version).toBe("0.3.1");
  });

  it("only one trailing newline is stripped from a signature; inner bytes are kept", () => {
    const b = build("0.3.1", { sigs: { "darwin-aarch64": "ab\ncd\n", "darwin-x86_64": "xy\r\n" } });
    expect(b.platforms["darwin-aarch64"].signature).toBe("ab\ncd");
    expect(b.platforms["darwin-x86_64"].signature).toBe("xy");
  });
});

describe("validateLatestJson", () => {
  it("accepts what buildLatestJson built", () => {
    expect(validate(build())).toEqual({ ok: true, errors: [] });
  });

  it("L2 version 'v0.3.1' → rejected; 0.3.1 against expected 0.3.2 → rejected", () => {
    const j = clone(build());
    j.version = "v0.3.1";
    expect(validate(j).ok).toBe(false);
    expect(validate(build("0.3.1"), "0.3.2").ok).toBe(false);
  });

  it("L3 a signature one character off the sig file → rejected", () => {
    const j = clone(build());
    const s = j.platforms["darwin-x86_64"].signature;
    j.platforms["darwin-x86_64"].signature = `${s.slice(0, -1)}${s.endsWith("A") ? "B" : "A"}`;
    const r = validate(j);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("darwin-x86_64");
  });

  it("an empty signature → rejected", () => {
    const j = clone(build());
    j.platforms["darwin-aarch64"].signature = "";
    expect(validate(j).ok).toBe(false);
  });

  it("L4 missing darwin-x86_64 key → rejected; an extra windows-x86_64 key → rejected", () => {
    const missing = clone(build());
    delete missing.platforms["darwin-x86_64"];
    expect(validate(missing).ok).toBe(false);
    const extra = clone(build());
    extra.platforms["windows-x86_64"] = { signature: SIG_A, url: url("v0.3.1", "mdpro_0.3.1_x64-setup.exe") };
    expect(validate(extra).ok).toBe(false);
  });

  it("L5 URL for another repo, or for tag v0.3.0 → rejected", () => {
    const repo = clone(build());
    repo.platforms["darwin-aarch64"].url = url("v0.3.1", "mdpro_aarch64.app.tar.gz", "someone/mdpro");
    expect(validate(repo).ok).toBe(false);
    const tag = clone(build());
    tag.platforms["darwin-aarch64"].url = url("v0.3.0", "mdpro_aarch64.app.tar.gz");
    expect(validate(tag).ok).toBe(false);
  });

  it("L5b URL on another host → rejected", () => {
    const j = clone(build());
    j.platforms["darwin-x86_64"].url = j.platforms["darwin-x86_64"].url.replace("github.com", "evil.example");
    expect(validate(j).ok).toBe(false);
  });

  it("L6 URL with releases/download/untagged-abc/… → rejected, naming untagged", () => {
    const j = clone(build());
    j.platforms["darwin-aarch64"].url = url("untagged-abc123", "mdpro_aarch64.app.tar.gz");
    const r = validate(j);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/untagged/);
  });

  it.each([null, "x", [], { version: "0.3.1" }, { version: "0.3.1", platforms: null }])(
    "malformed JSON %j → rejected without throwing",
    (j) => {
      expect(validate(j).ok).toBe(false);
    },
  );

  it("an invalid pub_date → rejected", () => {
    const j = clone(build());
    j.pub_date = "yesterday";
    expect(validate(j).ok).toBe(false);
  });

  it("round-trip property (seed 7603): build → validate accepts; any single mutation rejects", () => {
    const r = mulberry32(7603);
    const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let i = 0; i < 100; i++) {
      const v = `${int(r, 0, 9)}.${int(r, 0, 99)}.${int(r, 0, 999)}`;
      const sa = str(r, b64, 8, 120);
      const sx = str(r, b64, 8, 120);
      const files = filesFor(sa, sx);
      const j = buildLatestJson({
        repo: REPO,
        version: v,
        notes: str(r, b64, 0, 30),
        pubDate: PUB,
        sigs: { "darwin-aarch64": `${sa}\n`, "darwin-x86_64": sx },
      });
      expect(validate(j, v, files).ok, v).toBe(true);
      const mutants: Array<(m: Latest) => void> = [
        (m) => (m.version = `${v}.0`),
        (m) => (m.platforms["darwin-aarch64"].signature += "A"),
        (m) => (m.platforms["darwin-x86_64"].url += "x"),
        (m) => delete m.platforms["darwin-aarch64"],
      ];
      for (const [k, mutate] of mutants.entries()) {
        const m = clone(j);
        mutate(m);
        expect(validate(m, v, files).ok, `${v} mutant ${k}`).toBe(false);
      }
    }
  });
});

describe("CHANGELOG notes", () => {
  it("changelogNotes returns the body of ## [<version>] up to the next section", () => {
    const text = changelog({ "0.3.1": "### Fixed\n- a fix", "0.3.0": "### Added\n- old" });
    expect(changelogNotes(text, "0.3.1")).toBe("### Fixed\n- a fix");
    expect(changelogNotes(text, "0.3.0")).toBe("### Added\n- old");
  });

  it("0.3.1 does not match a [0.3.10] section", () => {
    expect(changelogNotes(changelog({ "0.3.10": "ten" }), "0.3.1")).toBeNull();
  });

  it("reads the real CHANGELOG.md 0.3.0 section", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../../CHANGELOG.md"), "utf8");
    expect(changelogNotes(text, "0.3.0")).toMatch(/^### Added/);
  });

  it("L7 CHANGELOG without ## [0.3.1] → error in draft mode", () => {
    const r = resolveNotes({ changelog: changelog({ "0.3.0": "old" }), version: "0.3.1", mode: "draft" });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it.each(["build-only", "rehearsal-draft"])("L7 CHANGELOG without ## [0.3.1] → %s: warning, notes ''", (mode) => {
    const r = resolveNotes({ changelog: changelog({ "0.3.0": "old" }), version: "0.3.1", mode });
    expect(r).toMatchObject({ notes: "", errors: [] });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("a missing CHANGELOG file (null) behaves as a missing section", () => {
    expect(resolveNotes({ changelog: null, version: "0.3.1", mode: "draft" }).errors.length).toBeGreaterThan(0);
  });

  it("a present section → notes, no warning", () => {
    const r = resolveNotes({ changelog: changelog({ "0.3.1": "body" }), version: "0.3.1", mode: "draft" });
    expect(r).toEqual({ notes: "body", errors: [], warnings: [] });
  });
});
