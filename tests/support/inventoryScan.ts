/**
 * @module tests/support/inventoryScan
 * Purpose: read today's editor keymaps for the M1A-WI-6 inventory bijection.
 * - CodeMirror: the composed `keymap` facet of the mounted Source editor, each
 *   binding classified to its source by object identity (library arrays,
 *   exported mdpro commands) or, for mdpro's inline closures, by a literal key map.
 * - Milkdown: the `$useKeymap` exports of commonmark, gfm and history (their
 *   default map is the ctx slice's `_defaultValue`), typora's config per
 *   platform, and prosemirror-commands' base keymaps.
 * Also resolves package files through the pnpm store for version pins and citations.
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Command, KeyBinding } from "@codemirror/view";
import { closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap, indentWithTab, redo, toggleLineComment, undo } from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { lintKeymap } from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import * as commonmark from "@milkdown/kit/preset/commonmark";
import * as gfm from "@milkdown/kit/preset/gfm";
import * as history from "@milkdown/kit/plugin/history";
import { macBaseKeymap, pcBaseKeymap } from "@milkdown/kit/prose/commands";
import type { Platform } from "../../src/commands/commandTable.types";
import { typoraKeymapConfig } from "../../src/plugins/milkdown/typoraKeymapPlugin";
import {
  decreaseHeadingCommand, heading1Command, heading2Command, heading3Command, heading4Command,
  heading5Command, heading6Command, increaseHeadingCommand, paragraphCommand,
} from "../../src/plugins/codemirror/headingPlugin";
import { insertLinkCommand } from "../../src/plugins/codemirror/linkPlugin";
import { sourceTableTabKeymap } from "../../src/plugins/codemirror/sourceTableTabNav";

const REPO = resolve(__dirname, "../..");
const FIELD: Record<Platform, "mac" | "win" | "linux"> = { macos: "mac", windows: "win", linux: "linux" };

/** One keymap name a source binds on one platform. */
export interface Found {
  readonly source: string;
  readonly key: string;
  readonly platform: Platform;
  readonly name?: string;
  /** CodeMirror only: the function this name runs. */
  readonly fn?: Command;
  readonly index?: number;
}

/** A name is in scope when it has a modifier or is an F-key (plan M1A-WI-6). */
export function inScope(name: string): boolean {
  const parts = name.split(/-(?!$)/);
  return parts.length > 1 || /^F([1-9]|1[0-2])$/.test(parts[0]);
}

const CM_ARRAYS: ReadonlyArray<readonly [string, readonly KeyBinding[]]> = [
  ["codemirror:defaultKeymap", defaultKeymap],
  ["codemirror:searchKeymap", searchKeymap],
  ["codemirror:historyKeymap", historyKeymap],
  ["codemirror:foldKeymap", foldKeymap],
  ["codemirror:lintKeymap", lintKeymap],
  ["codemirror:completionKeymap", completionKeymap],
  ["codemirror:closeBracketsKeymap", closeBracketsKeymap],
  ["codemirror:markdownKeymap", markdownKeymap],
  ["codemirror:indentWithTab", [indentWithTab]],
  ["mdpro:sourceTableTabNav", sourceTableTabKeymap],
];

const MDPRO_RUNS: ReadonlyArray<readonly [string, readonly Command[]]> = [
  ["mdpro:headingPlugin", [heading1Command, heading2Command, heading3Command, heading4Command,
    heading5Command, heading6Command, paragraphCommand, increaseHeadingCommand, decreaseHeadingCommand]],
  ["mdpro:linkPlugin", [insertLinkCommand]],
  ["mdpro:Editor.undoRedo", [undo, redo]],
  ["mdpro:Editor.viewModeKeymap", [toggleLineComment]],
];

/** mdpro's inline closures (R1-10b), identified by their key. */
const MDPRO_CLOSURES: Readonly<Record<string, string>> = {
  "Mod-/": "mdpro:Editor.viewModeKeymap",
  "Mod-Shift-h": "mdpro:highlightPlugin",
};

function classify(b: KeyBinding): string {
  for (const [source, arr] of CM_ARRAYS) if (arr.includes(b)) return source;
  for (const [source, runs] of MDPRO_RUNS) if (b.run && runs.includes(b.run)) return source;
  return (b.key && MDPRO_CLOSURES[b.key]) || `unclassified(${b.key ?? b.mac ?? b.win ?? b.linux})`;
}

/** Every name of every distinct composed binding, per platform, with its Shift variant. */
export function composedCodeMirror(bindings: readonly KeyBinding[]): { found: Found[]; anyOnly: number } {
  const found: Found[] = [];
  let anyOnly = 0;
  [...new Set(bindings)].forEach((b, index) => {
    if (b.any && !b.key && !b.mac && !b.win && !b.linux) anyOnly++;
    const source = classify(b);
    for (const platform of ["macos", "windows", "linux"] as const) {
      const key = b[FIELD[platform]] ?? b.key;
      if (!key) continue;
      found.push({ source, key, platform, fn: b.run, index });
      if (b.shift) found.push({ source, key: `Shift-${key}`, platform, fn: b.shift, index });
    }
  });
  return { found, anyOnly };
}

type KeymapDefault = Record<string, { shortcuts: string | string[] }>;

/** `$useKeymap` results among a module's exports, with their default maps. */
export function useKeymapExports(mod: Record<string, unknown>): Array<[string, KeymapDefault]> {
  const out: Array<[string, KeymapDefault]> = [];
  for (const [exportName, v] of Object.entries(mod)) {
    if (!Array.isArray(v) || !("keymap" in v) || !("ctx" in v)) continue;
    const slice = (v as unknown as { key?: { _defaultValue?: unknown } }).key;
    if (slice?._defaultValue) out.push([exportName, slice._defaultValue as KeymapDefault]);
  }
  return out;
}

export const MILKDOWN_PACKAGES = [
  ["milkdown:preset-commonmark", commonmark],
  ["milkdown:preset-gfm", gfm],
  ["milkdown:plugin-history", history],
] as const;

/** The scannable Milkdown keymaps on every platform. */
export function scannedMilkdown(): Found[] {
  const found: Found[] = [];
  for (const platform of ["macos", "windows", "linux"] as const) {
    for (const [pkg, mod] of MILKDOWN_PACKAGES) {
      for (const [exportName, map] of useKeymapExports(mod as Record<string, unknown>)) {
        for (const [name, entry] of Object.entries(map)) {
          for (const key of [entry.shortcuts].flat()) found.push({ source: `${pkg}/${exportName}`, key, platform, name });
        }
      }
    }
    for (const [name, entry] of Object.entries(typoraKeymapConfig(platform === "macos"))) {
      found.push({ source: "mdpro:typoraKeymap", key: entry.shortcuts, platform, name });
    }
    for (const key of Object.keys(platform === "macos" ? macBaseKeymap : pcBaseKeymap)) {
      found.push({ source: "milkdown:core/baseKeymap", key, platform });
    }
  }
  return found;
}

/** A package's root directory, resolved from another package's real directory. */
export function packageDir(name: string, fromDir: string = join(REPO, "node_modules", "@milkdown/kit")): string {
  let dir = realpathSync(fromDir);
  while (!dir.endsWith("/node_modules") && dir !== dirname(dir)) dir = dirname(dir);
  return realpathSync(join(dir, name));
}

export function packageVersion(dir: string): string {
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
}

/** The text of `file:line`; a file starting `src/` is read from the worktree. */
export function citedLine(citation: string): string {
  const [file, line] = citation.split(/:(?=\d+$)/);
  const path = file.startsWith("src/") ? join(REPO, file) : citedPackageFile(file);
  return readFileSync(path, "utf8").split("\n")[Number(line) - 1] ?? "";
}

function citedPackageFile(file: string): string {
  const parts = file.split("/");
  const pkg = file.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const from = pkg.startsWith("prosemirror-") ? packageDir("@milkdown/prose") : undefined;
  return join(packageDir(pkg, from), file.slice(pkg.length + 1));
}
