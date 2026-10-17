// @vitest-environment node
/**
 * M1A-WI-6 — one owner per (platform, context, chord) on v2; the v2 × today's
 * inventory cross-check; latent notes stay honest (R2-D).
 * Matrix: .claude/tdd-guardian/tests-20261016-223726.md § M1A-WI-6, R1-F1, R2-D.
 */
import { describe, expect, it } from "vitest";
import { normaliseStored } from "../src/commands/chord";
import { rowByPrefField } from "../src/commands/commandTable";
import { EDITOR_OWNED_CHORDS, keymapNameToStored } from "../src/commands/editorOwnedChords";
import type { KeyboardShortcuts } from "../src/types/preferences";
import {
  LATENT_FIELD,
  PLATFORMS,
  collisions,
  describe1,
  explanation,
  oneOwnerViolations,
} from "./support/tableBindings";

const OFF = ["windows", "linux"] as const;

describe("one owner on v2", () => {
  it("every platform × context binds each chord at most once", () => {
    const { dups, pairs } = oneOwnerViolations("v2");
    expect(dups).toEqual([]);
    expect(pairs).toBeGreaterThanOrEqual(300);
  });
});

describe("v1 violates it at exactly the documented set", () => {
  it("C2, C3 on macOS; C6 Image/Italic and ADR-0096's inert rows off-Mac", () => {
    const got = oneOwnerViolations("v1").dups.map((d) => `${d.platform} ${d.chord} ${d.ids.join("+")}`);
    const off = OFF.flatMap((p) => [
      `${p} Cmd+I format.emphasis+format.image`,
      `${p} Cmd+2 paragraph.heading2+view.source`,
      `${p} Cmd+4 paragraph.heading4+view.wysiwyg`,
      `${p} Cmd+Shift+\` format.code+format.strike`,
    ]);
    expect(got.sort()).toEqual(
      ["macos Cmd+H app.hide+edit.replace", "macos Cmd+W file.close+window.closeWindow", ...off].sort(),
    );
  });
});

describe("v2 × today's inventory cross-check", () => {
  const all = collisions("v2", EDITOR_OWNED_CHORDS);
  const explained = all.filter((c) => explanation(c) !== null);
  const has = (platforms: readonly string[], owner: string, rowId: string, why: string) => {
    for (const p of platforms) {
      const hit = explained.find((c) => c.platform === p && c.owner === owner && c.rowId === rowId);
      expect(hit, `${p} ${owner} vs ${rowId}`).toBeDefined();
      expect(explanation(hit!)).toBe(why);
    }
  };

  it("has no unexplained collision", () => {
    expect(all.filter((c) => explanation(c) === null).map(describe1)).toEqual([]);
    expect(all.length).toBeGreaterThanOrEqual(40);
  });

  it("names the registered removals (C11, C12, C17, D269, D271, D272)", () => {
    has(PLATFORMS, "editor:codemirror:searchKeymap:Mod-Shift-l", "view.sidebar", "removeInM1b(C11)");
    has(["macos"], "editor:codemirror:foldKeymap:Cmd-Alt-[", "paragraph.decreaseHeading", "removeInM1b(C12)");
    has(["macos"], "editor:codemirror:foldKeymap:Cmd-Alt-]", "paragraph.increaseHeading", "removeInM1b(C12)");
    has(OFF, "editor:codemirror:foldKeymap:Ctrl-Alt-[", "paragraph.decreaseHeading", "removeInM1b(C12)");
    has(OFF, "editor:codemirror:foldKeymap:Ctrl-Alt-]", "paragraph.increaseHeading", "removeInM1b(C12)");
    has(OFF, "editor:codemirror:foldKeymap:Ctrl-Shift-[", "paragraph.orderedList", "removeInM1b(C12)");
    has(OFF, "editor:codemirror:foldKeymap:Ctrl-Shift-]", "paragraph.unorderedList", "removeInM1b(C12)");
    has(PLATFORMS, "editor:codemirror:defaultKeymap:Mod-Alt-ArrowUp", "table.insertRowAbove", "removeInM1b(C17)");
    has(PLATFORMS, "editor:codemirror:defaultKeymap:Mod-Alt-ArrowDown", "table.insertRowBelow", "removeInM1b(C17)");
    has(PLATFORMS, "editor:codemirror:lintKeymap:Mod-Shift-m", "format.highlight", "removeInM1b(D269)");
    has(PLATFORMS, "editor:milkdown:preset-gfm/tableKeymap:Mod-]", "paragraph.indent", "removeInM1b(D271)");
    has(PLATFORMS, "editor:milkdown:preset-gfm/tableKeymap:Mod-[", "paragraph.outdent", "removeInM1b(D271)");
    has(OFF, "editor:codemirror:defaultKeymap:Ctrl-m", "window.minimize", "removeInM1b(D272)");
  });

  it("names D270 (latent vs the unavailable Underline) and core Mod-a", () => {
    has(PLATFORMS, "editor:codemirror:historyKeymap:Mod-u", "format.underline", "latent(D270)");
    has(PLATFORMS, "editor:milkdown:core/baseKeymap:Mod-a", "edit.selectAll", "implements");
    has(PLATFORMS, "editor:codemirror:defaultKeymap:Mod-/", "view.cycleViewMode", "shadowed(mdpro:Editor.viewModeKeymap)");
  });
});

describe("R2-D: latent notes stay honest", () => {
  const latentRows = EDITOR_OWNED_CHORDS.filter((r) => r.latent !== undefined);

  it("covers D267, D268 and D270", () => {
    expect([...new Set(latentRows.map((r) => r.latent))].sort()).toEqual(["D267", "D268", "D270"]);
  });

  it("no latent row collides with an available, bound v2 row in a shared context", () => {
    const live = collisions("v2", latentRows).filter((c) => c.binding.available);
    expect(live.map(describe1)).toEqual([]);
  });

  it("each latent row's chord is its field's v2 default on at least one platform", () => {
    for (const r of latentRows) {
      const target = rowByPrefField(LATENT_FIELD[r.latent!] as keyof KeyboardShortcuts)!;
      const hit = PLATFORMS.some((p) => {
        const v2 = target.key[p].defaults.v2;
        return r.platforms.includes(p) && v2 !== null && normaliseStored(v2, p) === keymapNameToStored(r.key, p);
      });
      expect(hit, `${r.source} ${r.key} → ${LATENT_FIELD[r.latent!]}`).toBe(true);
    }
  });
});
