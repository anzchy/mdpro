/**
 * M1A-WI-6 — the editor-owned inventory against today's keymaps.
 * Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-6, R1-10a/b,
 * R2-4b, R3-2. CodeMirror is read from the real mounted Source editor's
 * composed `keymap` facet; Milkdown from the static keymap exports (the
 * per-platform handling probe is tests/milkdown-keymap-probe-*.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));

import { keymap, type KeyBinding } from "@codemirror/view";
import { macBaseKeymap, pcBaseKeymap, selectAll as pmSelectAll } from "@milkdown/kit/prose/commands";
import { normaliseStored } from "../src/commands/chord";
import { rowById, rowByPrefField } from "../src/commands/commandTable";
import type { KeyboardShortcuts } from "../src/types/preferences";
import type { Platform } from "../src/commands/commandTable.types";
import { EDITOR_OWNED_CHORDS as INV, keymapNameToStored, type EditorOwnedRow } from "../src/commands/editorOwnedChords";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";
import {
  MILKDOWN_PACKAGES, citedLine, composedCodeMirror, inScope, packageDir, packageVersion,
  scannedMilkdown, useKeymapExports, type Found,
} from "./support/inventoryScan";
import { LATENT_FIELD, PLATFORMS, collisions, explanation } from "./support/tableBindings";
import { IMPLEMENTS_BY_IDENTITY, IMPLEMENTS_CITED } from "./support/inventoryCitations";

const tag = (f: { source: string; key: string; platform: Platform }) => `${f.source}|${f.key}|${f.platform}`;
const expand = (rows: readonly EditorOwnedRow[]) =>
  rows.flatMap((r) => r.platforms.map((platform) => ({ source: r.source, key: r.key, platform })));
const minus = (a: string[], b: string[]) => {
  const rest = [...b];
  return a.filter((x) => { const i = rest.indexOf(x); if (i < 0) return true; rest.splice(i, 1); return false; });
};
const PROBE_ONLY = new Set(["prosemirror-tables:tableEditing", "mdpro:inlineEditPlugin"]);

describe("keymapNameToStored", () => {
  it.each([
    ["Mod-Shift-l", "macos", "Cmd+Shift+L"],
    ["Shift-Mod-k", "windows", "Cmd+Shift+K"],
    ["Mod--", "linux", "Cmd+-"],
    ["Mod-Alt-\\", "windows", "Cmd+Option+\\"],
    ["Alt-A", "macos", "Option+Shift+A"],
    ["Cmd-ArrowUp", "macos", "Cmd+Up"],
    ["Ctrl-m", "macos", "Ctrl+M"],
    ["Ctrl-m", "windows", "Cmd+M"],
    ["Ctrl-Space", "linux", "Cmd+Space"],
    ["Ctrl-`", "windows", "Cmd+`"],
    ["F3", "macos", "F3"],
    ["Shift-F3", "linux", "Shift+F3"],
  ] as const)("%s on %s → %s", (name, p, want) => {
    expect(keymapNameToStored(name, p)).toBe(want);
  });

  it.each([
    ["Cmd-ArrowUp", "windows"], ["Meta-a", "linux"], ["Enter", "macos"], ["Mod-Insert", "macos"],
    ["Hyper-a", "macos"], ["", "macos"],
  ] as const)("%s on %s is not a stored chord", (name, p) => {
    expect(keymapNameToStored(name, p)).toBeNull();
  });
});

describe("composed CodeMirror keymap ⇄ S rows", () => {
  let found: Found[] = [];
  let anyOnly = -1;
  beforeAll(() => {
    const view = mountEditor("");
    ({ found, anyOnly } = composedCodeMirror(view.state.facet(keymap).flat() as KeyBinding[]));
  });
  afterAll(() => teardownEditor());
  const scoped = () => found.filter((f) => inScope(f.key));

  it("every in-scope binding parses and has a known source", () => {
    expect(scoped().filter((f) => keymapNameToStored(f.key, f.platform) === null).map(tag)).toEqual([]);
    expect(scoped().filter((f) => f.source.startsWith("unclassified")).map(tag)).toEqual([]);
    expect(anyOnly).toBe(0);
    expect(scoped().length).toBeGreaterThanOrEqual(150);
  });

  it("is a two-way bijection with the S rows", () => {
    const composed = scoped().map(tag).sort();
    const rows = expand(INV.filter((r) => r.editor === "S")).map(tag).sort();
    expect(minus(composed, rows), "unlisted bindings").toEqual([]);
    expect(minus(rows, composed), "stale rows").toEqual([]);
  });

  it("carries the anchors", () => {
    const keys = new Set(scoped().map((f) => f.key));
    for (const k of ["Mod-z", "Mod-Shift-l", "Mod-Alt-ArrowUp", "Mod-d", "F3", "Mod-Shift-m", "Mod-u", "Mod-Shift-h", "Mod-/"]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it("D255-WI-3b Source Image binds on macOS and stays keyless on Windows and Linux", () => {
    const image = scoped().filter((f) => f.source === "mdpro:sourceFormatPlugin" && f.key === "Mod-Ctrl-i");
    expect(image.map((f) => f.platform)).toEqual(["macos"]);
    expect(image[0]?.fn).toBe(IMPLEMENTS_BY_IDENTITY["format.image"]?.[0]);
    expect(INV.filter((r) => r.source === "mdpro:sourceFormatPlugin" && r.key === "Mod-Ctrl-i")
      .flatMap((r) => r.platforms)).toEqual(["macos"]);
  });

  it("resolves platform-specific names", () => {
    const on = (p: Platform, src: string) =>
      new Set(scoped().filter((f) => f.platform === p && f.source === src).map((f) => keymapNameToStored(f.key, p)));
    expect(on("macos", "codemirror:historyKeymap").has("Cmd+Shift+Z")).toBe(true);
    expect(on("macos", "codemirror:historyKeymap").has("Cmd+Y")).toBe(false);
    expect(on("windows", "codemirror:historyKeymap").has("Cmd+Y")).toBe(true);
    const linuxOnly = (p: Platform) => scoped().some((f) => f.platform === p && f.key === "Ctrl-Shift-z");
    expect([linuxOnly("macos"), linuxOnly("windows"), linuxOnly("linux")]).toEqual([false, false, true]);
    const cmdUp = (p: Platform) => scoped().filter((f) => f.platform === p && f.key.endsWith("Cmd-ArrowUp")).map((f) => f.key);
    expect(cmdUp("macos").sort()).toEqual(["Cmd-ArrowUp", "Shift-Cmd-ArrowUp"]);
    expect(cmdUp("windows")).toEqual([]);
  });

  it("a shadowed row is bound by its shadowing source earlier in the facet", () => {
    const shadowed = INV.filter((r) => r.disposition.kind === "shadowed");
    expect(shadowed.length).toBeGreaterThan(0);
    for (const r of shadowed) {
      const by = r.disposition.kind === "shadowed" ? r.disposition.by : "";
      for (const p of r.platforms) {
        const mine = scoped().find((f) => f.source === r.source && f.key === r.key && f.platform === p)!;
        const chord = keymapNameToStored(r.key, p);
        const winner = scoped().find((f) => f.source === by && f.platform === p && keymapNameToStored(f.key, p) === chord);
        expect(winner, `${by} binds ${chord} on ${p}`).toBeDefined();
        expect(winner!.index!).toBeLessThan(mine.index!);
      }
    }
  });

  it("R1-10a: every exported-command implements row runs X's command", () => {
    const MAP = IMPLEMENTS_BY_IDENTITY;
    const closures = new Set(IMPLEMENTS_CITED.map((c) => `${c.source}|${c.key}`));
    const used = new Set<string>();
    const wrong: string[] = [];
    for (const r of INV) {
      if (r.editor !== "S" || r.disposition.kind !== "implements" || closures.has(`${r.source}|${r.key}`)) continue;
      const x = r.disposition.command;
      for (const p of r.platforms) {
        const f = scoped().find((g) => g.source === r.source && g.key === r.key && g.platform === p);
        if (!f || !(MAP[x] ?? []).includes(f.fn)) wrong.push(`${tag({ ...r, platform: p })} → ${x}`);
        used.add(x);
      }
    }
    expect(wrong).toEqual([]);
    expect([...used].sort()).toEqual(Object.keys(MAP).sort());
  });
});

describe("Milkdown keymap exports ⇄ W rows", () => {
  const scanned = scannedMilkdown().filter((f) => inScope(f.key));

  it("finds at least one keymap per package", () => {
    for (const [, mod] of MILKDOWN_PACKAGES) expect(useKeymapExports(mod as Record<string, unknown>).length).toBeGreaterThan(0);
  });

  it("is a two-way bijection with the scannable W rows, names included", () => {
    const names = new Map<string, Set<string>>();
    for (const f of scanned) {
      const set = names.get(tag(f)) ?? new Set<string>();
      if (f.name !== undefined) set.add(f.name);
      names.set(tag(f), set);
    }
    const rows = INV.filter((r) => r.editor === "W" && !PROBE_ONLY.has(r.source));
    const rowTags = expand(rows).map(tag).sort();
    expect(minus([...names.keys()].sort(), rowTags), "unlisted").toEqual([]);
    expect(minus(rowTags, [...names.keys()]), "stale").toEqual([]);
    const badNames = rows.flatMap((r) => r.platforms.map((p) => {
      const want = [...(names.get(tag({ ...r, platform: p })) ?? [])].sort();
      return JSON.stringify(want) === JSON.stringify([...(r.names ?? [])].sort()) ? null : `${r.source} ${r.key} ${p}`;
    })).filter((x) => x !== null);
    expect(badNames).toEqual([]);
  });

  it("carries the anchors", () => {
    const has = (source: string, key: string, p: Platform = "windows") =>
      INV.some((r) => r.source === source && r.key === key && r.platforms.includes(p));
    for (const k of ["Mod-y", "Shift-Mod-z"]) expect(has("milkdown:plugin-history/historyKeymap", k), k).toBe(true);
    expect(has("mdpro:typoraKeymap", "Mod-1")).toBe(true);
    expect(has("mdpro:typoraKeymap", "Mod-k")).toBe(true);
    expect(has("milkdown:preset-commonmark/blockquoteKeymap", "Mod-Shift-b")).toBe(true);
    for (const k of ["Mod-]", "Mod-[", "Mod-Enter"]) expect(has("milkdown:preset-gfm/tableKeymap", k), k).toBe(true);
    for (const k of ["Mod-Enter", "Mod-a", "Shift-Backspace"]) expect(has("milkdown:core/baseKeymap", k), k).toBe(true);
    expect(has("milkdown:core/baseKeymap", "Ctrl-e", "macos")).toBe(true);
    expect(has("milkdown:core/baseKeymap", "Ctrl-e", "windows")).toBe(false);
  });

  it("pins the Milkdown and ProseMirror versions", () => {
    const prose = packageDir("@milkdown/prose");
    expect(packageVersion(packageDir("@milkdown/kit"))).toBe("7.18.0");
    expect(packageVersion(packageDir("prosemirror-tables", prose))).toBe("1.8.5");
    expect(packageVersion(packageDir("prosemirror-commands", prose))).toBe("1.7.1");
    expect(packageVersion(packageDir("prosemirror-keymap", prose))).toBe("1.2.3");
  });
});

describe("inventory integrity", () => {
  it("has rows, each on a platform, each parsing on each platform, each unique there", () => {
    expect(INV.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const r of INV) {
      expect(r.platforms.length, tag({ ...r, platform: "macos" })).toBeGreaterThan(0);
      for (const p of r.platforms) {
        expect(keymapNameToStored(r.key, p), `${r.source} ${r.key} ${p}`).not.toBeNull();
        expect(seen.has(tag({ ...r, platform: p })), `duplicate ${r.source} ${r.key} ${p}`).toBe(false);
        seen.add(tag({ ...r, platform: p }));
      }
    }
  });

  it("implements names a table row; latent sits only on editorOwned; every id is used", () => {
    const removal = new Set<string>();
    for (const r of INV) {
      if (r.disposition.kind === "implements") expect(rowById(r.disposition.command), r.disposition.command).toBeDefined();
      if (r.disposition.kind === "removeInM1b") removal.add(r.disposition.id);
      if (r.latent !== undefined) expect(r.disposition.kind).toBe("editorOwned");
    }
    expect([...removal].sort()).toEqual(["C11", "C12", "C17", "D264", "D269", "D271", "D272", "K4"]);
    expect([...new Set(INV.flatMap((r) => (r.latent ? [r.latent] : [])))].sort()).toEqual(["D267"]);
  });

  it("contexts follow the editor, and table-only handlers act only in tableW", () => {
    const tableOnly = new Set(["prosemirror-tables:tableEditing", "milkdown:preset-gfm/tableKeymap"]);
    for (const r of INV) {
      const want = tableOnly.has(r.source) ? ["tableW"] : r.editor === "W" ? ["editorW", "tableW"] : ["editorS", "tableS"];
      expect(r.contexts, `${r.source} ${r.key}`).toEqual(want);
    }
  });

  it("K4 and D264 rows: the Milkdown Mod-Alt-0…8 keys, off-Mac Mod-Shift-b, off-Mac Mod-Alt-\\", () => {
    const k4 = INV.filter((r) => r.disposition.kind === "removeInM1b" && r.disposition.id === "K4");
    expect(k4.flatMap((r) => r.platforms.map((p) => `${r.key} ${p}`)).sort()).toEqual(
      [...["0", "1", "2", "3", "4", "5", "6", "7", "8"].flatMap((d) => PLATFORMS.map((p) => `Mod-Alt-${d} ${p}`)),
        "Mod-Shift-b linux", "Mod-Shift-b windows"].sort(),
    );
    const d264 = INV.filter((r) => r.disposition.kind === "removeInM1b" && r.disposition.id === "D264");
    expect(d264.map((r) => `${r.source} ${r.key} ${r.platforms.join(",")}`)).toEqual([
      "codemirror:defaultKeymap Mod-Alt-\\ windows,linux",
    ]);
  });
});

describe("R1-10b / R2-4b: every other implements pair is cited and checked", () => {
  it("the cited list equals the inventory's other implements rows", () => {
    const covered = new Set(["codemirror:", "mdpro:headingPlugin", "mdpro:linkPlugin", "mdpro:Editor.undoRedo", "mdpro:sourceFormatPlugin"]);
    const others = INV.filter((r) => r.disposition.kind === "implements" &&
      !(r.editor === "S" && [...covered].some((c) => r.source.startsWith(c))));
    const got = [...new Set(others.map((r) => `${r.source}|${r.key}|${r.disposition.kind === "implements" ? r.disposition.command : ""}`))];
    expect(got.sort()).toEqual(IMPLEMENTS_CITED.map((c) => `${c.source}|${c.key}|${c.implements}`).sort());
    expect(IMPLEMENTS_CITED).toHaveLength(34);
  });

  it("(1) each citation's line holds the key literal", () => {
    expect(IMPLEMENTS_CITED.filter((c) => !citedLine(c.citation).includes(JSON.stringify(c.key))).map((c) => c.citation)).toEqual([]);
  });

  it("(2) exported commands are bound by identity", () => {
    expect(pcBaseKeymap["Mod-a"]).toBe(pmSelectAll);
    expect(macBaseKeymap["Mod-a"]).toBe(pmSelectAll);
  });

  it("(3) each named entry carries its expected library-side name", () => {
    const named = IMPLEMENTS_CITED.filter((c) => c.name !== undefined);
    expect(named.length).toBeGreaterThan(0);
    for (const c of named) {
      const rows = INV.filter((r) => r.source === c.source && r.key === c.key);
      expect(rows.length, `${c.source} ${c.key}`).toBeGreaterThan(0);
      for (const r of rows) expect(r.names, `${c.source} ${c.key}`).toEqual([c.name]);
    }
  });
});

describe("R3-2: each latent row is tied to its own reserver", () => {
  it("(a) its chord is its field's v1 or v2 default somewhere; (c) the map covers the notes", () => {
    const latent = INV.filter((r) => r.latent !== undefined);
    expect(latent.length).toBeGreaterThan(0);
    for (const r of latent) {
      const target = rowByPrefField(LATENT_FIELD[r.latent!] as keyof KeyboardShortcuts)!;
      const hit = r.platforms.some((p) => (["v1", "v2"] as const).some((v) => {
        const d = target.key[p].defaults[v];
        return d !== null && normaliseStored(d, p) === keymapNameToStored(r.key, p);
      }));
      expect(hit, `${r.source} ${r.key} ${r.latent}`).toBe(true);
    }
    expect(Object.keys(LATENT_FIELD).sort()).toEqual([...new Set(latent.map((r) => r.latent))].sort());
  });

  it("(b) a latent note explains only a collision with its own field's reserver", () => {
    const fake = (key: string): EditorOwnedRow => ({
      editor: "S", source: "test:synthetic", key, platforms: ["windows"], contexts: ["editorS", "tableS"],
      disposition: { kind: "editorOwned" }, latent: "D267",
    });
    const own = collisions("v2", [fake("Ctrl-Shift-k")]);
    expect(own.map((c) => [c.rowId, explanation(c)])).toEqual([["paragraph.codeFences", "latent(D267:M1b)"]]);
    const other = collisions("v2", [fake("Ctrl-l")]);
    expect(other.map((c) => [c.rowId, explanation(c)])).toEqual([["edit.selectLine", null]]);
  });
});
