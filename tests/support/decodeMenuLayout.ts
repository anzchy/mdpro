/**
 * M1A-WI-7 R1-7: a test-side oracle that maps `menu_layout.json` back to the
 * builder's inputs `{table, reserved, editorOwned}`, field by field, and
 * throws on any key it does not expect. It must stay independent of the
 * builder and of the table: it may import only types from `src/commands/`
 * (R2-4a, R3-3), so it cannot fill a missing field in from `COMMAND_TABLE`.
 */
import type {
  Availability,
  CommandRow,
  KeySpec,
  MenuPath,
  OwnershipContext,
  PerPlatform,
  Platform,
  Route,
  Versioned,
} from "../../src/commands/commandTable.types";
import type {
  Disposition,
  EditorOwnedRow,
  InventoryEditor,
  LatentId,
  RemovalId,
} from "../../src/commands/editorOwnedChords";

export interface DecodedLayout {
  readonly table: CommandRow[];
  readonly reserved: PerPlatform<readonly string[]>;
  readonly editorOwned: EditorOwnedRow[];
}

type Obj = Record<string, unknown>;

function obj(v: unknown, allowed: readonly string[], at: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${at}: not an object`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new Error(`${at}: unexpected key ${k}`);
  return v as Obj;
}

function str(v: unknown, at: string): string {
  if (typeof v !== "string") throw new Error(`${at}: not a string`);
  return v;
}

function strOrNull(v: unknown, at: string): string | null {
  return v === null ? null : str(v, at);
}

function arr<T>(v: unknown, at: string, item: (x: unknown, at: string) => T): T[] {
  if (!Array.isArray(v)) throw new Error(`${at}: not an array`);
  return v.map((x, i) => item(x, `${at}[${i}]`));
}

function oneOf<T extends string>(members: readonly T[]) {
  return (v: unknown, at: string): T => {
    const s = str(v, at);
    if (!(members as readonly string[]).includes(s)) throw new Error(`${at}: ${s} is not one of ${members.join("|")}`);
    return s as T;
  };
}

const platform = oneOf<Platform>(["macos", "windows", "linux"]);
const route = oneOf<Route>(["frontend", "native", "rust-quit", "rust-hide", "unavailable"]);
const availability = oneOf<Availability>(["both", "W", "S", "none"]);
const context = oneOf<OwnershipContext>([
  "editorW", "editorS", "tableW", "tableS", "modal", "recorder", "nativeFocus",
]);
const editor = oneOf<InventoryEditor>(["W", "S"]);
const latent = oneOf<LatentId>(["D267", "D268", "D270"]);
const removal = oneOf<RemovalId>(["C11", "C12", "C17", "D264", "D269", "D271", "D272", "K4"]);

function perPlatform<T>(v: unknown, at: string, item: (x: unknown, at: string) => T): PerPlatform<T> {
  const o = obj(v, ["macos", "windows", "linux"], at);
  return { macos: item(o.macos, `${at}.macos`), windows: item(o.windows, `${at}.windows`), linux: item(o.linux, `${at}.linux`) };
}

function versioned<T>(v: unknown, at: string, item: (x: unknown, at: string) => T): Versioned<T> {
  const o = obj(v, ["v1", "v2"], at);
  return { v1: item(o.v1, `${at}.v1`), v2: item(o.v2, `${at}.v2`) };
}

function menuPath(v: unknown, at: string): MenuPath {
  return v === "none" ? "none" : arr(v, at, str);
}

function keySpec(v: unknown, at: string): KeySpec {
  const o = obj(v, ["kind", "defaults", "secondaries"], at);
  const secondaries = versioned(o.secondaries, `${at}.secondaries`, (x, a) => arr(x, a, str));
  if (o.kind === "configurable") {
    return { kind: "configurable", defaults: versioned(o.defaults, `${at}.defaults`, str), secondaries };
  }
  if (o.kind === "fixed") {
    return { kind: "fixed", defaults: versioned(o.defaults, `${at}.defaults`, strOrNull), secondaries };
  }
  throw new Error(`${at}.kind: unknown ${String(o.kind)}`);
}

const ROW_KEYS = [
  "id", "prefField", "menuId", "menu", "key", "contexts", "availability", "route", "nativeBehaviour",
];

function commandRow(v: unknown, at: string): CommandRow {
  const o = obj(v, ROW_KEYS, at);
  return {
    id: str(o.id, `${at}.id`),
    ...("prefField" in o ? { prefField: str(o.prefField, `${at}.prefField`) as CommandRow["prefField"] } : {}),
    ...("menuId" in o ? { menuId: str(o.menuId, `${at}.menuId`) } : {}),
    menu: perPlatform(o.menu, `${at}.menu`, menuPath),
    key: perPlatform(o.key, `${at}.key`, keySpec),
    contexts: arr(o.contexts, `${at}.contexts`, context),
    availability: perPlatform(o.availability, `${at}.availability`, (x, a) => versioned(x, a, availability)),
    route: perPlatform(o.route, `${at}.route`, route),
    ...("nativeBehaviour" in o ? { nativeBehaviour: str(o.nativeBehaviour, `${at}.nativeBehaviour`) } : {}),
  };
}

function disposition(v: unknown, at: string): Disposition {
  const kind = obj(v, ["kind", "command", "id", "by"], at).kind;
  switch (kind) {
    case "implements":
      return { kind, command: str(obj(v, ["kind", "command"], at).command, `${at}.command`) };
    case "editorOwned":
      obj(v, ["kind"], at);
      return { kind };
    case "removeInM1b":
      return { kind, id: removal(obj(v, ["kind", "id"], at).id, `${at}.id`) };
    case "shadowed":
      return { kind, by: str(obj(v, ["kind", "by"], at).by, `${at}.by`) };
    default:
      throw new Error(`${at}.kind: unknown ${String(kind)}`);
  }
}

const INVENTORY_KEYS = ["editor", "source", "key", "platforms", "contexts", "disposition", "latent", "names"];

function inventoryRow(v: unknown, at: string): EditorOwnedRow {
  const o = obj(v, INVENTORY_KEYS, at);
  return {
    editor: editor(o.editor, `${at}.editor`),
    source: str(o.source, `${at}.source`),
    key: str(o.key, `${at}.key`),
    platforms: arr(o.platforms, `${at}.platforms`, platform),
    contexts: arr(o.contexts, `${at}.contexts`, context),
    disposition: disposition(o.disposition, `${at}.disposition`),
    ...("latent" in o ? { latent: latent(o.latent, `${at}.latent`) } : {}),
    ...("names" in o ? { names: arr(o.names, `${at}.names`, str) } : {}),
  };
}

/** Decode a parsed `menu_layout.json`. `$generated` is checked present, then dropped. */
export function decodeMenuLayout(json: unknown): DecodedLayout {
  const o = obj(json, ["$generated", "rows", "reserved", "editorOwned"], "layout");
  str(o.$generated, "layout.$generated");
  return {
    table: arr(o.rows, "rows", commandRow),
    reserved: perPlatform(o.reserved, "reserved", (x, a) => arr(x, a, str)),
    editorOwned: arr(o.editorOwned, "editorOwned", inventoryRow),
  };
}
