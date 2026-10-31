// @vitest-environment node
/**
 * T-01 (#569): the Matt Pocock skills version check — the pure function on fixture caches, the enabled-plugin
 * readers, the CLI T-02's prompt.sh will call, and one live, read-only case on the real caches (macOS, never CI).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM repo tool has no declaration file
import { compare } from "../../scripts/ci/compare-report.mjs";
import {
  checkMattPocockVersion,
  claudePluginEnabled,
  claudeInstalledVersion,
  claudePluginEnabledAcross,
  codexPluginEnabled,
  defaultCacheRoot,
  liveCaseEnabled,
  // @ts-expect-error -- plain ESM repo tool has no declaration file
} from "../../scripts/tdd/mattpocock-version.mjs";

const root = path.resolve(__dirname, "../..");
const caches = path.join(root, "tests/fixtures/t567/caches");
const fixture = (name: string) => path.join(caches, name);
const cli = path.join(root, "scripts/tdd/mattpocock-version.mjs");

/** Runs the CLI asynchronously and returns its exit code, stdout and stderr. */
function runCli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 20_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : -1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "t567-caches-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));
let made = 0;
/** A plugin.json body for `version`, or the given raw text. */
const manifest = (version: string) => JSON.stringify({ name: "mattpocock-skills", version });
/**
 * A cache root built at run time: each key is an entry name; a string value is that version folder's plugin.json text,
 * `{ file: text }` a regular file, and `{ dir: true }` an empty directory.
 */
function makeCache(entries: Record<string, string | { file: string } | { dir: true }>): string {
  const dir = path.join(scratch, `cache-${made++}`);
  fs.mkdirSync(dir);
  for (const [name, value] of Object.entries(entries)) {
    const at = path.join(dir, name);
    if (typeof value === "string") {
      fs.mkdirSync(path.join(at, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(path.join(at, ".claude-plugin/plugin.json"), value);
    } else if ("file" in value) fs.writeFileSync(at, value.file);
    else fs.mkdirSync(at);
  }
  return dir;
}

describe("T567 checkMattPocockVersion on fixture caches", () => {
  it("accepts a 1.3.1 cache", () => {
    expect(checkMattPocockVersion(fixture("ok-131"))).toMatchObject({ ok: true, version: "1.3.1" });
  });

  it("accepts a 1.3.2 cache", () => {
    expect(checkMattPocockVersion(fixture("ok-132"))).toMatchObject({ ok: true, version: "1.3.2" });
  });

  it("rejects a 1.3.0 cache as too old, naming the version", () => {
    const result = checkMattPocockVersion(fixture("old-130"));
    expect({ ok: result.ok, version: result.version, tooOld: result.reason.startsWith("too old") }).toEqual({ ok: false, version: "1.3.0", tooOld: true });
  });

  it("compares versions by number, not by text", () => {
    const verdict = (version: string) => checkMattPocockVersion(makeCache({ [version]: manifest(version) })).ok;
    expect(["1.10.0", "2.0.0", "1.2.9"].map(verdict)).toEqual([true, true, false]);
  });

  it("reports a missing cache for an absent path, an empty directory and a regular file, without throwing", () => {
    const empty = makeCache({});
    const file = path.join(scratch, "cache-as-file");
    fs.writeFileSync(file, "not a directory");
    expect({ empty: fs.readdirSync(empty), file: fs.lstatSync(file).isFile() }).toEqual({ empty: [], file: true });
    const results = [path.join(scratch, "absent"), empty, file].map((dir) => {
      try {
        const result = checkMattPocockVersion(dir);
        return { ok: result.ok, version: result.version, missing: result.reason.startsWith("missing") };
      } catch (error) {
        return { threw: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(results).toEqual(Array(3).fill({ ok: false, version: null, missing: true }));
  });

  it("reports a malformed cache, naming the folder, for every bad name or manifest", () => {
    const shapes: Array<[string, Record<string, string | { dir: true }>]> = [
      ["1.3", { "1.3": manifest("1.3") }],
      ["1.3.1-beta", { "1.3.1-beta": manifest("1.3.1-beta") }],
      ["01.3.1", { "01.3.1": manifest("01.3.1") }],
      ["1.3.1", { "1.3.1": manifest("1.3.x") }],
      ["1.3.1", { "1.3.1": "{ not json" }],
      ["1.3.1", { "1.3.1": JSON.stringify({ name: "other-skills", version: "1.3.1" }) }],
      ["1.3.2", { "1.3.2": manifest("1.3.1") }],
      ["1.3.1", { "1.3.1": { dir: true } }],
    ];
    const results = shapes.map(([folder, entries]) => {
      try {
        const result = checkMattPocockVersion(makeCache(entries));
        return { ok: result.ok, malformed: result.reason.startsWith("malformed"), named: result.reason.includes(folder) };
      } catch (error) {
        return { threw: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(results).toEqual(Array(shapes.length).fill({ ok: false, malformed: true, named: true }));
  });

  it("judges the numerically highest of several version folders", () => {
    const pick = (...versions: string[]) =>
      checkMattPocockVersion(makeCache(Object.fromEntries(versions.map((version) => [version, manifest(version)])))).version;
    expect([pick("1.3.0", "1.3.2"), pick("1.3.0", "1.10.0"), pick("1.10.0", "1.9.0"), pick("1.9.0", "1.10.0")])
      .toEqual(["1.3.2", "1.10.0", "1.10.0", "1.10.0"]);
  });

  it("ignores regular files and dot-entries beside a valid version folder", () => {
    const strays: Array<[string, { file: string } | { dir: true }]> = [
      [".DS_Store", { file: "\0" }], ["notes.txt", { file: "x" }], ["9.9.9", { file: "x" }], [".staging", { dir: true }],
    ];
    const results = strays.map(([name, entry]) => {
      const dir = makeCache({ "1.3.1": manifest("1.3.1"), [name]: entry });
      const shape = "file" in entry ? fs.lstatSync(path.join(dir, name)).isFile() : fs.lstatSync(path.join(dir, name)).isDirectory();
      const result = checkMattPocockVersion(dir);
      return { shape, ok: result.ok, version: result.version };
    });
    expect(results).toEqual(Array(strays.length).fill({ shape: true, ok: true, version: "1.3.1" }));
  });

  it("fails closed on a non-version folder beside a valid one, naming it", () => {
    const results = ["41f619d61b99", "unknown", "junk"].map((name) => {
      const result = checkMattPocockVersion(makeCache({ "1.3.2": manifest("1.3.2"), [name]: { dir: true } }));
      return { ok: result.ok, malformed: result.reason.startsWith("malformed"), named: result.reason.includes(name) };
    });
    expect(results).toEqual(Array(3).fill({ ok: false, malformed: true, named: true }));
  });

  it("validates every version folder's manifest, not only the selected one", () => {
    const results = [
      ["1.3.1", { "1.3.2": manifest("1.3.2"), "1.3.1": { dir: true as const } }],
      ["1.3.2", { "1.3.1": manifest("1.3.1"), "1.3.2": manifest("1.3.1") }],
    ].map(([folder, entries]) => {
      const result = checkMattPocockVersion(makeCache(entries as Record<string, string | { dir: true }>));
      return { ok: result.ok, malformed: result.reason.startsWith("malformed"), named: result.reason.includes(folder as string) };
    });
    expect(results).toEqual(Array(2).fill({ ok: false, malformed: true, named: true }));
  });

  it("writes nothing into the cache it reads", () => {
    const dir = makeCache({ "1.3.1": manifest("1.3.1"), "1.3.0": manifest("1.3.0") });
    const snapshot = () => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
      .map((entry) => {
        const full = path.join(entry.parentPath, entry.name);
        return `${path.relative(dir, full)}:${entry.isFile() ? fs.readFileSync(full, "utf8") : "dir"}`;
      })
      .sort();
    const before = snapshot();
    checkMattPocockVersion(dir);
    expect(snapshot()).toEqual(before);
  });

  it("reports an unreadable cache root without throwing", () => {
    const dir = makeCache({ "1.3.1": manifest("1.3.1") });
    fs.chmodSync(dir, 0o000);
    try {
      let outcome: unknown;
      try {
        const result = checkMattPocockVersion(dir);
        outcome = { ok: result.ok, version: result.version, unreadable: result.reason.startsWith("unreadable") };
      } catch (error) {
        outcome = { threw: error instanceof Error ? error.message : String(error) };
      }
      expect(outcome).toEqual({ ok: false, version: null, unreadable: true });
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  it("reports an unreadable manifest as malformed, naming its folder", () => {
    const dir = makeCache({ "1.3.1": manifest("1.3.1") });
    const file = path.join(dir, "1.3.1/.claude-plugin/plugin.json");
    fs.chmodSync(file, 0o000);
    try {
      const result = checkMattPocockVersion(dir);
      expect({ ok: result.ok, malformed: result.reason.startsWith("malformed"), named: result.reason.includes("1.3.1") })
        .toEqual({ ok: false, malformed: true, named: true });
    } finally {
      fs.chmodSync(file, 0o644);
    }
  });
});

describe("T567 mattpocock-version CLI", () => {
  it("exits 0 with the JSON result on a good cache, 1 on a too-old one, 2 with usage on no argument", async () => {
    const [good, old, none] = await Promise.all([runCli(fixture("ok-131")), runCli(fixture("old-130")), runCli()]);
    const parse = (text: string) => { try { return JSON.parse(text); } catch { return text; } };
    expect([
      { code: good.code, out: parse(good.stdout) },
      { code: old.code, out: parse(old.stdout) },
      { code: none.code, usage: /usage/i.test(none.stderr) },
    ]).toEqual([
      { code: 0, out: expect.objectContaining({ ok: true, version: "1.3.1" }) },
      { code: 1, out: expect.objectContaining({ ok: false, version: "1.3.0" }) },
      { code: 2, usage: true },
    ]);
  });

  it("prints exactly one JSON line and exits 1 for a missing, malformed or unreadable cache", async () => {
    const malformed = makeCache({ "1.3.1": "{ not json" });
    const locked = makeCache({ "1.3.1": manifest("1.3.1") });
    fs.chmodSync(locked, 0o000);
    try {
      const runs = await Promise.all([path.join(scratch, "absent-cli"), malformed, locked].map((dir) => runCli(dir)));
      const shape = runs.map(({ code, stdout }) => {
        const lines = stdout.split("\n").filter(Boolean);
        let parsed: { ok?: unknown; version?: unknown; reason?: string } = {};
        try { parsed = JSON.parse(lines[0] ?? ""); } catch { /* left empty: the assertion names it */ }
        return { code, lines: lines.length, ok: parsed.ok, version: parsed.version, kind: parsed.reason?.split(":")[0] };
      });
      expect(shape).toEqual([
        { code: 1, lines: 1, ok: false, version: null, kind: "missing" },
        { code: 1, lines: 1, ok: false, version: null, kind: "malformed" },
        { code: 1, lines: 1, ok: false, version: null, kind: "unreadable" },
      ]);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });
});

describe("T567 enabled-plugin readers", () => {
  const claudeKey = "mattpocock-skills@claude-plugins-official";

  it("reads Claude's enabledPlugins: true only for the exact key set to true", () => {
    const settings = (value: unknown) => JSON.stringify({ enabledPlugins: { other: true, [claudeKey]: value } });
    expect({
      enabled: claudePluginEnabled(settings(true)),
      disabled: claudePluginEnabled(settings(false)),
      text: claudePluginEnabled(settings("true")),
      absent: claudePluginEnabled(JSON.stringify({ enabledPlugins: { other: true } })),
      lookalike: claudePluginEnabled(JSON.stringify({ enabledPlugins: { [`${claudeKey}-old`]: true } })),
      nested: claudePluginEnabled(JSON.stringify({ other: { enabledPlugins: { [claudeKey]: true } } })),
      invalid: claudePluginEnabled(`{ "enabledPlugins": { "${claudeKey}": true }`),
      empty: claudePluginEnabled(""),
    }).toEqual({ enabled: true, disabled: false, text: false, absent: false, lookalike: false, nested: false, invalid: false, empty: false });
  });

  it("reads Codex's config: true only when the plugin's own table sets enabled = true", () => {
    const header = '[plugins."mattpocock-skills@mattpocock"]';
    const config = (...lines: string[]) => ['model = "x"', "", ...lines, ""].join("\n");
    const verdicts = {
      spaced: config(header, "enabled = true"),
      tight: config(header, "enabled=true"),
      trailingComment: config(header, "enabled = true # on"),
      disabled: config(header, "enabled = false"),
      absent: config('[plugins."other@x"]', "enabled = true"),
      otherTableAfter: config(header, 'source = "x"', '[plugins."other@x"]', "enabled = true"),
      commentedValue: config(header, "# enabled = true"),
      marketplaceOnly: config("[marketplaces.mattpocock]", "enabled = true"),
      suffixedHeader: config('[plugins."mattpocock-skills@mattpocock-old"]', "enabled = true"),
      commentedHeader: config(`# ${header}`, "enabled = true"),
      quotedValue: config(header, 'enabled = "true"'),
      prefixValue: config(header, "enabled = truex"),
    };
    expect(Object.fromEntries(Object.entries(verdicts).map(([name, text]) => [name, codexPluginEnabled(text)]))).toEqual({
      spaced: true, tight: true, trailingComment: true, disabled: false, absent: false, otherTableAfter: false,
      commentedValue: false, marketplaceOnly: false, suffixedHeader: false, commentedHeader: false, quotedValue: false,
      prefixValue: false,
    });
  });

  it("resolves Claude's enabled state across user, project and local settings: the last scope that sets the key wins", () => {
    const set = (value: unknown) => JSON.stringify({ enabledPlugins: { [claudeKey]: value } });
    const unrelated = JSON.stringify({ enabledPlugins: { "other@x": true } });
    const scopes: Record<string, Array<string | null>> = {
      projectOff: [set(true), set(false), null],
      userOnly: [set(true), null, null],
      localOff: [set(true), set(true), set(false)],
      localOn: [set(false), unrelated, set(true)],
      invalidProject: [set(true), "{ not json", null],
      stringProject: [set(true), set("false"), null],
      none: [null, null, null],
    };
    expect(Object.fromEntries(Object.entries(scopes).map(([name, texts]) => [name, claudePluginEnabledAcross(texts)]))).toEqual({
      projectOff: false, userOnly: true, localOff: false, localOn: true, invalidProject: true, stringProject: true, none: false,
    });
  });

  it("reads Claude's install record for the plugin, preferring the user-scope entry and refusing bad fields", () => {
    const record = (entries: unknown, key = claudeKey) => JSON.stringify({ version: 2, plugins: { [key]: entries } });
    const entry = (fields: Record<string, unknown>) => ({ scope: "user", installPath: "/x/1.3.1", version: "1.3.1", ...fields });
    const read = (text: string) => {
      try { return claudeInstalledVersion(text); } catch (error) { return { threw: String(error) }; }
    };
    expect({
      user: read(record([entry({})])),
      userSecond: read(record([entry({ scope: "project", installPath: "/p/1.3.0", version: "1.3.0" }), entry({})])),
      projectOnly: read(record([entry({ scope: "project", installPath: "/p/1.3.2", version: "1.3.2" })])),
      invalid: read("{ not json"),
      absent: read(JSON.stringify({ version: 2, plugins: {} })),
      emptyArray: read(record([])),
      numericPath: read(record([entry({ installPath: 131 })])),
      emptyPath: read(record([entry({ installPath: "" })])),
      numericVersion: read(record([entry({ version: 131 })])),
      emptyVersion: read(record([entry({ version: "" })])),
      lookalike: read(record([entry({})], "mattpocock-skills@other")),
    }).toEqual({
      user: { version: "1.3.1", installPath: "/x/1.3.1" },
      userSecond: { version: "1.3.1", installPath: "/x/1.3.1" },
      projectOnly: { version: "1.3.2", installPath: "/p/1.3.2" },
      invalid: null, absent: null, emptyArray: null, numericPath: null, emptyPath: null, numericVersion: null,
      emptyVersion: null, lookalike: null,
    });
  });
});

describe("T567 live-case wiring", () => {
  it("names each runtime's cache root under a home directory, and refuses any other runtime", () => {
    const attempt = (runtime: string) => {
      try { return defaultCacheRoot(runtime, "/h"); } catch (error) { return error instanceof Error ? "threw" : "threw-non-error"; }
    };
    expect(["claude", "codex", "vscode", ""].map(attempt)).toEqual([
      "/h/.claude/plugins/cache/claude-plugins-official/mattpocock-skills",
      "/h/.codex/plugins/cache/mattpocock/mattpocock-skills",
      "threw",
      "threw",
    ]);
  });

  it("runs the live case only on macOS outside CI", () => {
    expect([
      liveCaseEnabled({ platform: "darwin", env: { RUNNER_OS: "macOS" } }),
      liveCaseEnabled({ platform: "darwin", env: { RUNNER_OS: "" } }),
      liveCaseEnabled({ platform: "linux", env: {} }),
      liveCaseEnabled({ platform: "win32", env: {} }),
      liveCaseEnabled({ platform: "darwin", env: {} }),
    ]).toEqual([false, false, false, false, true]);
  });
});

const LIVE_DESCRIBE = "T567 live case on the real caches";
const LIVE_TITLE = "both runtimes have mattpocock-skills at or above the minimum, installed where checked and enabled";

describe(LIVE_DESCRIBE, () => {
  it("declares the live case in the CI inventory with the plugin prerequisite, so every runner may skip it", () => {
    const { testPath, currentTestName } = expect.getState();
    const [describeTitle] = (currentTestName ?? "").split(" > ");
    const file = path.relative(root, testPath ?? "").replaceAll("\\", "/");
    const liveId = [file, describeTitle, LIVE_TITLE];
    const inventory = JSON.parse(fs.readFileSync(path.join(root, "tests/ci-inventory.json"), "utf8"));
    const entries = inventory.tests.filter((item: { id: string[] }) => JSON.stringify(item.id) === JSON.stringify(liveId));
    const report = {
      success: true,
      testResults: [{
        name: path.join(root, file),
        status: "passed",
        assertionResults: [{ ancestorTitles: [describeTitle], title: LIVE_TITLE, status: "skipped" }],
      }],
    };
    const judge = (profile: string) => {
      try {
        compare("ci", report, { schemaVersion: 1, tests: entries, exclusions: [] }, profile, root);
        return "accepted";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    expect({ entries, ubuntu: judge("ubuntu"), macos: judge("macos") }).toEqual({
      entries: [{ id: liveId, prerequisite: "plugin" }],
      ubuntu: "accepted",
      macos: "accepted",
    });
  });

  it.runIf(liveCaseEnabled(process))(LIVE_TITLE, () => {
    const home = os.homedir();
    const readOrNull = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
    const claudeRoot = defaultCacheRoot("claude", home);
    const claude = checkMattPocockVersion(claudeRoot);
    const codex = checkMattPocockVersion(defaultCacheRoot("codex", home));
    const installed = claudeInstalledVersion(fs.readFileSync(path.join(home, ".claude/plugins/installed_plugins.json"), "utf8"));
    const claudeEnabled = claudePluginEnabledAcross([
      readOrNull(path.join(home, ".claude/settings.json")),
      readOrNull(path.join(root, ".claude/settings.json")),
      readOrNull(path.join(root, ".claude/settings.local.json")),
    ]);
    const codexEnabled = codexPluginEnabled(fs.readFileSync(path.join(home, ".codex/config.toml"), "utf8"));
    expect({
      claude: claude.ok,
      codex: codex.ok,
      installedWhereChecked: installed?.installPath === path.join(claudeRoot, claude.version ?? ""),
      claudeEnabled,
      codexEnabled,
    }).toEqual({ claude: true, codex: true, installedWhereChecked: true, claudeEnabled: true, codexEnabled: true });
  });
});
