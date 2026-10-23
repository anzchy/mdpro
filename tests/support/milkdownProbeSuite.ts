/**
 * @module tests/support/milkdownProbeSuite
 * Purpose: the R2-1a / R3-4 assertions over one platform's Milkdown probe, shared
 * by tests/milkdown-keymap-probe-{mac,win,linux}{,.slow}.test.ts. The unit lane
 * probes the reduced domain (every inventory W key, every scanned Milkdown key,
 * every v2 table chord, and the handleKeyDown-only keys); the slow lane adds the
 * WI-5 domain.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { normaliseStored } from "../../src/commands/chord";
import type { OwnershipContext, Platform } from "../../src/commands/commandTable.types";
import { EDITOR_OWNED_CHORDS, keymapNameToStored } from "../../src/commands/editorOwnedChords";
import { validDomain } from "./chordDomain";
import { inScope, scannedMilkdown } from "./inventoryScan";
import {
  STATES, buildStates, handles, mountMilkdown, probeAll, stateContext, unmountMilkdown,
  type StateName,
} from "./milkdownProbe";
import { tableBindings } from "./tableBindings";
import { typoraKeymapConfig } from "../../src/plugins/milkdown/typoraKeymapPlugin";

const HANDLER_ONLY = ["Ctrl-`", "Shift-ArrowLeft", "Shift-ArrowRight", "Shift-ArrowUp", "Shift-ArrowDown",
  "Mod-Backspace", "Mod-Delete"];

/** W rows that no probe state reaches, with the reason (R2-1a converse). */
const UNREACHABLE: Record<"mac" | "off", Readonly<Record<string, string>>> = {
  mac: {
    "Cmd+Z": "undo: a fresh state has no history",
    "Cmd+Y": "redo: a fresh state has no history",
    "Cmd+Shift+Z": "redo: a fresh state has no history",
    "Cmd+K": "typora link returns false by design; the link modal takes the key",
    "Cmd+Option+[": "decrease heading has no effect in the probe's H1/paragraph states",
    "Cmd+\\": "clear format has no effect in the probe's plain-text states",
  },
  off: {
    "Cmd+Z": "undo: a fresh state has no history",
    "Cmd+Y": "redo: a fresh state has no history",
    "Cmd+Shift+Z": "redo: a fresh state has no history",
    "Cmd+K": "typora link returns false by design; the link modal takes the key",
    "Cmd+Option+[": "decrease heading has no effect in the probe's H1/paragraph states",
    "Cmd+\\": "clear format has no effect in the probe's plain-text states",
  },
};

const ANCHORS: ReadonlyArray<readonly [string, StateName, boolean]> = [
  ["Mod-Enter", "v", true], ["Mod-a", "iii", true], ["Shift-Backspace", "iii", true], ["Ctrl-e", "iii", false],
  ["Mod-Backspace", "ii", true], ["Shift-ArrowRight", "i", true], ["Ctrl-`", "iii", true],
];

function domain(p: Platform, lane: "unit" | "slow"): string[] {
  const names = [
    ...EDITOR_OWNED_CHORDS.filter((r) => r.editor === "W" && r.platforms.includes(p)).map((r) => r.key),
    ...scannedMilkdown().filter((f) => f.platform === p && inScope(f.key)).map((f) => f.key),
    ...HANDLER_ONLY,
  ];
  const chords = [
    ...names.map((n) => keymapNameToStored(n, p)),
    ...tableBindings("v2", p).map((b) => b.chord),
    ...(lane === "slow" ? validDomain(p).map((s) => normaliseStored(s, p)) : []),
  ];
  return [...new Set(chords.filter((c): c is string => c !== null))].sort();
}

const raw = (init: KeyboardEventInit & { keyCode: number }) => new KeyboardEvent("keydown", init as KeyboardEventInit);

export function runProbeSuite(p: Platform, lane: "unit" | "slow"): void {
  const mac = p === "macos";
  describe(`Milkdown keydown probe — ${p}, ${lane}`, () => {
    let view: EditorView;
    let states: Record<StateName, EditorState>;
    let result = new Map<string, Set<StateName>>();
    const chords = domain(p, lane);
    // The M1a inventory retains removed v1 rows for migration/conflict history.
    // Probe the v2 composition: base/history/retained table keys plus the
    // applied Typora config, which owns the configurable actions now.
    const activeChords = () => {
      const staticRows = EDITOR_OWNED_CHORDS.filter((r) => {
        if (r.editor !== "W" || !r.platforms.includes(p) || r.source === "mdpro:typoraKeymap") return false;
        if (r.source.startsWith("milkdown:preset-commonmark/"))
          return r.source.endsWith("/hardbreakKeymap") ||
            (r.source.endsWith("/listItemKeymap") && r.key === "Shift-Tab");
        if (r.source === "milkdown:preset-gfm/tableKeymap") return r.key === "Shift-Tab" || r.key === "Mod-Enter";
        if (r.source.startsWith("milkdown:preset-gfm/")) return false;
        return r.disposition.kind !== "removeInM1b" && r.disposition.kind !== "shadowed";
      }).map((r) => ({ chord: keymapNameToStored(r.key, p), contexts: r.contexts }));
      const typoraRows = Object.values(typoraKeymapConfig(mac)).map((entry) => ({
        chord: keymapNameToStored(entry.shortcuts, p), contexts: ["editorW", "tableW"] as const,
      }));
      return [...staticRows, ...typoraRows].filter((r): r is { chord: string; contexts: readonly OwnershipContext[] } => r.chord !== null);
    };

    beforeAll(async () => {
      view = await mountMilkdown();
      states = buildStates(view.state);
      result = probeAll(view, states, chords, p);
    }, 600_000);
    afterAll(() => unmountMilkdown());

    it("the navigator.platform switch took effect", () => {
      const ctrlH = handles(view, states.iii, raw({ key: "h", code: "KeyH", keyCode: 72, ctrlKey: true }));
      const metaA = handles(view, states.iii, raw({ key: "a", code: "KeyA", keyCode: 65, metaKey: true }));
      const ctrlA = handles(view, states.iii, raw({ key: "a", code: "KeyA", keyCode: 65, ctrlKey: true }));
      expect({ ctrlH, metaA }).toEqual({ ctrlH: true, metaA: mac });
      if (!mac) expect(ctrlA).toBe(true);
    });

    it("jsdom keeps keyCode, and the domain is the expected size", () => {
      expect(raw({ key: "a", keyCode: 65 }).keyCode).toBe(65);
      if (lane === "slow") {
        expect(validDomain(p)).toHaveLength(1238);
        // Distinct normal forms: off-Mac, Cmd and Ctrl collapse into one primary modifier.
        expect(chords.length).toBe(mac ? 585 : 297);
      }
      expect(chords.length).toBeGreaterThanOrEqual(60);
      expect(result.size).toBe(chords.length);
    });

    it("forward and R3-4: every handled chord is a W row acting in that state's context", () => {
      const unlisted: string[] = [];
      for (const [chord, hit] of result) {
        for (const s of hit) {
          const ok = activeChords().some((r) => r.chord === chord && r.contexts.includes(stateContext(s)));
          if (!ok) unlisted.push(`${p} ${chord} in (${s}) → ${stateContext(s)}`);
        }
      }
      expect(unlisted).toEqual([]);
    });

    it("converse: every W row is handled in some state, or is listed unreachable", () => {
      const unreachable = UNREACHABLE[mac ? "mac" : "off"];
      const missing = [...new Set(activeChords().map((r) => r.chord))]
        .filter((c) => (result.get(c)?.size ?? 0) === 0 && !(c in unreachable));
      expect(missing).toEqual([]);
      expect(Object.keys(unreachable).filter((c) => (result.get(c)?.size ?? 0) > 0)).toEqual([]);
      expect(Object.keys(unreachable)).toHaveLength(6);
      expect(activeChords().length).toBeGreaterThan(0);
    });

    it("anchors are handled in their named state", () => {
      for (const [name, s, everywhere] of ANCHORS) {
        if (!everywhere && !mac) continue;
        const chord = keymapNameToStored(name, p);
        expect(chord !== null && (result.get(chord)?.has(s) ?? false), `${name} in (${s})`).toBe(true);
      }
      expect(STATES).toHaveLength(6);
    });
  });
}
