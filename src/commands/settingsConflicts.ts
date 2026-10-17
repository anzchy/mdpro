/**
 * Purpose: the conflict check behind Settings → Keyboard Shortcuts' Save
 * (plan M1A-WI-10; matrix SD13; user ruling 2026-10-16
 * 「A: custom only (Recommended)」). It reads WI-8's `resolveBindings`,
 * collects the conflicts that refuse Save, and words them for the banner.
 *
 * Pipeline: resolveBindings(platform, version, local) → every flagged row
 * (custom vs custom / hard owner) refuses its own field, and every default
 * that yields to a custom refuses the custom that took it.
 *
 * Key decisions:
 * - Refused: a custom duplicate, a custom on a fixed / native / reserved /
 *   editor-owned chord, a custom taking an available row's default, and a
 *   K8 physical overlap with a custom side (US/German layouts only).
 * - Allowed: default vs default (v1 data defects), default vs editor-owned,
 *   custom vs an unavailable row's default (ADR-0114 Decision 5). The
 *   filter never flags those, so nothing here has to exempt them.
 * - An unparseable value is not a conflict (it binds nothing).
 * - M7: Settings shows every field, so SD14's hidden set and its
 *   non-blocking notices are gone; every conflict refuses.
 * - Names: the panel's label for a field, else the menu item, else the id.
 *
 * @coordinates-with src/commands/bindingConflicts.ts — resolveBindings
 * @coordinates-with src/components/common/settings/KeyboardShortcutsSettings.tsx — the consumer
 */
import { displayedShortcut, isMacPlatform, isWindowsPlatform } from "../utils/platformLabels";
import { resolveBindings } from "./bindingConflicts";
import { assertNever } from "./assertNever";
import type { BindingField, SuppressReason } from "./bindingConflicts.types";
import { normaliseStored } from "./chord";
import { rowById, rowByPrefField } from "./commandTable";
import type { CommandRow, Platform } from "./commandTable.types";

export type SettingsConflictKind = "hard" | "duplicate" | "takesDefault" | "physicalOverlap";

/** One field whose value refuses Save. */
export interface SettingsConflict {
  readonly field: BindingField;
  readonly kind: SettingsConflictKind;
  /** The field's own name. */
  readonly name: string;
  /** Command ids (or `reserved:` / `editor:` owner ids) on the other side. */
  readonly with: readonly string[];
  readonly names: readonly string[];
  /** The field's stored value. */
  readonly value: string;
}

export interface SettingsConflicts {
  readonly refusing: ReadonlyMap<BindingField, SettingsConflict>;
}

export type SettingsLabels = Readonly<Partial<Record<BindingField, string>>>;

/** The map Settings edits: field → stored string (absent = the default). */
export type SettingsLocal = Readonly<Partial<Record<BindingField, string>>>;

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

function humanise(id: string): string {
  const tail = id.slice(id.lastIndexOf(".") + 1);
  const words = tail.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function menuName(row: CommandRow, p: Platform): string | null {
  const menu = row.menu[p];
  if (menu === "none" || menu.length === 0) return null;
  return (menu[menu.length - 1] ?? "").replace(/(\.\.\.|…)$/, "") || null;
}

function nameOf(id: string, p: Platform, labels: SettingsLabels): string {
  if (id.startsWith("reserved:")) return "a reserved system shortcut";
  if (id.startsWith("editor:")) return `an editor key (${id.slice(7, id.lastIndexOf(":"))})`;
  const row = rowById(id);
  if (row === undefined) return id;
  const label = row.prefField === undefined ? undefined : labels[row.prefField];
  return label ?? menuName(row, p) ?? humanise(id);
}

const fieldOf = (id: string): BindingField | null => rowById(id)?.prefField ?? null;

/** The Settings kind of a flagged suppression (never called for `unparseable`). */
function conflictKind(reason: SuppressReason): SettingsConflictKind {
  switch (reason) {
    case "customDuplicate":
      return "duplicate";
    case "physicalOverlap":
      return "physicalOverlap";
    case "fixed":
    case "native":
    case "reserved":
    case "editorOwned":
    case "yieldedToCustom":
    case "unavailable":
    case "unparseable":
      return "hard";
    default:
      return assertNever(reason);
  }
}

/**
 * The conflicts in `local` (the stored map Settings is editing) on
 * `platform` at defaults `version`. `labels` names the shown fields.
 */
export function findSettingsConflicts(
  platform: Platform,
  version: number,
  local: SettingsLocal,
  labels: SettingsLabels = {},
): SettingsConflicts {
  const ver = version >= 2 ? "v2" : "v1";
  const resolutions = resolveBindings(platform, version, local);
  const idOf = (f: BindingField): string => rowByPrefField(f)?.id ?? String(f);
  const valueOf = (f: BindingField): string => {
    const raw = local[f];
    return typeof raw === "string" ? raw : (rowByPrefField(f)?.key[platform].defaults[ver] ?? "");
  };
  const name = (f: BindingField) => nameOf(idOf(f), platform, labels);
  const refusing = new Map<BindingField, SettingsConflict>();

  const refuse = (field: BindingField, kind: SettingsConflictKind, ids: readonly string[]) => {
    const prior = refusing.get(field);
    const all = uniq([...(prior?.with ?? []), ...ids]).sort();
    const names = uniq(all.map((id) => nameOf(id, platform, labels)));
    refusing.set(field, { field, kind: prior?.kind ?? kind, name: name(field), with: all, names, value: valueOf(field) });
  };

  for (const field of Object.keys(resolutions).sort() as BindingField[]) {
    const r = resolutions[field];
    if (r === undefined || r.kind !== "suppressed") continue;
    if (r.flagged && r.reason !== "unparseable") {
      refuse(field, conflictKind(r.reason), r.conflictsWith);
    } else if (r.reason === "yieldedToCustom") {
      const yielderId = idOf(field);
      for (const id of r.conflictsWith) {
        const taker = fieldOf(id);
        if (taker !== null) refuse(taker, "takesDefault", [yielderId]);
      }
    }
  }
  return { refusing };
}

/** The banner's lines (SD13), one per conflict that refuses Save. */
export function settingsConflictLines(
  found: SettingsConflicts,
  platform: Platform,
): { readonly alerts: readonly string[] } {
  const isMac = platform === "macos";
  const alerts: string[] = [];
  const doneChords = new Set<string>();
  for (const c of found.refusing.values()) {
    const chord = displayedShortcut(c.field, c.value, isMac);
    const others = c.names.join(" and ");
    if (c.kind === "hard") alerts.push(`${c.name} conflicts with ${others}, not active`);
    else if (c.kind === "physicalOverlap") {
      alerts.push(`${chord}: ${c.name} is the same key as ${others} on some keyboard layouts, not active`);
    }
    else if (c.kind === "takesDefault") alerts.push(`${chord}: ${c.name} would take ${others}'s key`);
    else {
      const key = normaliseStored(c.value, platform) ?? c.value;
      if (doneChords.has(key)) continue;
      doneChords.add(key);
      alerts.push(`${chord}: ${c.name} conflicts with ${others}`);
    }
  }
  return { alerts };
}

/** The platform Settings is running on. Reads `navigator` at call time. */
export function settingsPlatform(): Platform {
  if (isMacPlatform()) return "macos";
  return isWindowsPlatform() ? "windows" : "linux";
}
