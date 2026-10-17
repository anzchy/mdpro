/**
 * Purpose: the conflict check behind Settings → Keyboard Shortcuts' Save
 * (plan M1A-WI-10; matrix SD13, SD14; user ruling 2026-10-16
 * 「A: custom only (Recommended)」). It reads WI-8's `resolveBindings` and
 * sorts what it finds into conflicts that refuse Save and notices that do
 * not, and words both for the banner.
 *
 * Pipeline: resolveBindings(platform, version, local) → every flagged row
 * (custom vs custom / hard owner) and every default that yields to a custom
 * → its sides (the row's field and each field among the other ids) →
 * refusing when a side is shown in Settings, a notice when none is.
 *
 * Key decisions:
 * - Refused: a custom duplicate, a custom on a fixed / native / reserved /
 *   editor-owned chord, a custom taking an available row's default.
 * - Allowed: default vs default (v1 data defects), default vs editor-owned,
 *   custom vs an unavailable row's default (ADR-0114 Decision 5). The
 *   filter never flags those, so nothing here has to exempt them.
 * - An unparseable value is not a conflict (it binds nothing).
 * - SD14: a conflict whose sides are all hidden fields is a notice only.
 * - Names: the panel's label for a field, else the menu item, else the id.
 *
 * @coordinates-with src/commands/bindingConflicts.ts — resolveBindings
 * @coordinates-with src/components/common/settings/KeyboardShortcutsSettings.tsx — the consumer
 */
import { displayedShortcut, isMacPlatform, isWindowsPlatform } from "../utils/platformLabels";
import { resolveBindings } from "./bindingConflicts";
import type { BindingField } from "./bindingConflicts.types";
import { normaliseStored } from "./chord";
import { rowById, rowByPrefField } from "./commandTable";
import type { CommandRow, Platform } from "./commandTable.types";

export type SettingsConflictKind = "hard" | "duplicate" | "takesDefault";

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

/** A conflict with no side shown in Settings: reported, never refusing. */
export interface SettingsNotice {
  readonly fields: readonly BindingField[];
  readonly names: readonly string[];
  readonly value: string;
  /** The field whose value `value` is (for the chord label). */
  readonly labelField: BindingField;
}

export interface SettingsConflicts {
  readonly refusing: ReadonlyMap<BindingField, SettingsConflict>;
  readonly notices: readonly SettingsNotice[];
}

export type SettingsLabels = Readonly<Partial<Record<BindingField, string>>>;

/** The map Settings edits: field → stored string (absent = the default). */
export type SettingsLocal = Readonly<Partial<Record<BindingField, string>>>;

/** SD14: the configurable fields Settings does not render. */
export const SETTINGS_HIDDEN_FIELDS: ReadonlySet<BindingField> = new Set<BindingField>([
  "fileOpenQuickly",
  "fileExportHtml",
  "formatHighlight",
  "tableInsertRowAbove",
  "tableInsertRowBelow",
  "tableInsertColumnLeft",
  "tableInsertColumnRight",
  "tableDeleteRow",
  "tableDeleteColumn",
]);

const shown = (f: BindingField) => !SETTINGS_HIDDEN_FIELDS.has(f);
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
  const notices = new Map<string, SettingsNotice>();

  const refuse = (field: BindingField, kind: SettingsConflictKind, ids: readonly string[]) => {
    const prior = refusing.get(field);
    const all = uniq([...(prior?.with ?? []), ...ids]).sort();
    const names = uniq(all.map((id) => nameOf(id, platform, labels)));
    refusing.set(field, { field, kind: prior?.kind ?? kind, name: name(field), with: all, names, value: valueOf(field) });
  };
  const notice = (key: string, fields: readonly BindingField[], owners: readonly string[], labelField: BindingField) => {
    const prior = notices.get(key);
    const fs = uniq([...(prior?.fields ?? []), ...fields]).sort();
    const names = uniq([...fs.map(name), ...owners.map((id) => nameOf(id, platform, labels))]);
    notices.set(key, { fields: fs, names, value: valueOf(labelField), labelField });
  };

  for (const field of Object.keys(resolutions).sort() as BindingField[]) {
    const r = resolutions[field];
    if (r === undefined || r.kind !== "suppressed") continue;
    const otherFields = r.conflictsWith.flatMap((id) => {
      const f = fieldOf(id);
      return f === null ? [] : [f];
    });
    const sides = [field, ...otherFields];
    const visible = sides.some(shown);
    if (r.flagged && r.reason !== "unparseable") {
      const kind: SettingsConflictKind = r.reason === "customDuplicate" ? "duplicate" : "hard";
      if (visible) refuse(field, kind, r.conflictsWith);
      else if (kind === "duplicate") notice(`dup:${normaliseStored(valueOf(field), platform) ?? ""}`, sides, [], field);
      else notice(`hard:${field}`, [field], r.conflictsWith.filter((id) => fieldOf(id) === null), field);
    } else if (r.reason === "yieldedToCustom") {
      const yielderId = idOf(field);
      for (const taker of otherFields) {
        if (visible) refuse(taker, "takesDefault", [yielderId]);
        else notice(`yield:${taker}`, [taker, field], [], taker);
      }
    }
  }
  return { refusing, notices: [...notices.values()] };
}

/** The banner's lines (SD13): `alerts` refuse Save, `notices` do not. */
export function settingsConflictLines(
  found: SettingsConflicts,
  platform: Platform,
): { readonly alerts: readonly string[]; readonly notices: readonly string[] } {
  const isMac = platform === "macos";
  const alerts: string[] = [];
  const doneChords = new Set<string>();
  for (const c of found.refusing.values()) {
    const chord = displayedShortcut(c.field, c.value, isMac);
    const others = c.names.join(" and ");
    if (c.kind === "hard") alerts.push(`${c.name} conflicts with ${others}, not active`);
    else if (c.kind === "takesDefault") alerts.push(`${chord}: ${c.name} would take ${others}'s key`);
    else {
      const key = normaliseStored(c.value, platform) ?? c.value;
      if (doneChords.has(key)) continue;
      doneChords.add(key);
      alerts.push(`${chord}: ${c.name} conflicts with ${others}`);
    }
  }
  const notices = found.notices.map(
    (n) => `${n.names.join(" and ")} share ${displayedShortcut(n.labelField, n.value, isMac)} (not shown on this page)`,
  );
  return { alerts, notices };
}

/** The platform Settings is running on. Reads `navigator` at call time. */
export function settingsPlatform(): Platform {
  if (isMacPlatform()) return "macos";
  return isWindowsPlatform() ? "windows" : "linux";
}
