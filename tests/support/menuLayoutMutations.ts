/**
 * M1A-WI-7 R1-7b: the leaf-mutation domain over menu-layout inputs, one
 * mutation per leaf by type (string +"X" or the next enum member, boolean
 * flipped, number +1, null set, empty array pushed) plus each absent optional
 * set. Shared by tests/menu-layout-build.slow.test.ts (ADR-0050). The fast
 * per-row twin in tests/menu-layout-build.test.ts keeps its inline copy:
 * those lines are under a red receipt and may not be removed.
 */
import type { CommandRow } from "../../src/commands/commandTable.types";
import type { EditorOwnedRow } from "../../src/commands/editorOwnedChords";

type Json = null | string | number | boolean | Json[] | { [k: string]: Json };

const ENUMS: Readonly<Record<string, readonly string[]>> = {
  route: ["frontend", "native", "rust-quit", "rust-hide", "unavailable"],
  availability: ["both", "W", "S", "none"],
  contexts: ["editorW", "editorS", "tableW", "tableS", "modal", "recorder", "nativeFocus"],
  platforms: ["macos", "windows", "linux"],
  editor: ["W", "S"],
  latent: ["D267", "D268", "D270"],
  keyKind: ["configurable", "fixed"],
  dispositionKind: ["implements", "editorOwned", "removeInM1b", "shadowed"],
  removalId: ["C11", "C12", "C17", "D264", "D269", "D271", "D272", "K4"],
};

function enumOf(path: readonly (string | number)[]): readonly string[] | undefined {
  const head = String(path[0]);
  const last = path[path.length - 1];
  if (head === "key" && last === "kind") return ENUMS.keyKind;
  if (head === "disposition" && last === "kind") return ENUMS.dispositionKind;
  if (head === "disposition" && last === "id") return ENUMS.removalId;
  return ENUMS[head];
}

function mutateLeaf(v: Json, path: readonly (string | number)[]): Json {
  if (v === null) return "X";
  if (typeof v === "boolean") return !v;
  if (typeof v === "number") return v + 1;
  if (typeof v === "string") {
    const members = enumOf(path);
    const i = members?.indexOf(v) ?? -1;
    return members !== undefined && i >= 0 ? members[(i + 1) % members.length] : `${v}X`;
  }
  if (Array.isArray(v) && v.length === 0) return ["X"];
  throw new Error(`not a leaf at ${path.join(".")}`);
}

/** Every leaf path of `value`: scalars, nulls and empty arrays. */
function leafPaths(value: Json, prefix: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) {
    return value.length === 0 ? [prefix] : value.flatMap((x, i) => leafPaths(x, [...prefix, i]));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, x]) => leafPaths(x, [...prefix, k]));
  }
  return [prefix];
}

function withLeaf(value: Json, path: readonly (string | number)[]): Json {
  const copy = structuredClone(value) as Json;
  if (path.length === 0) return mutateLeaf(copy, path);
  let parent = copy as Record<string | number, Json>;
  for (const seg of path.slice(0, -1)) parent = parent[seg] as Record<string | number, Json>;
  const last = path[path.length - 1];
  parent[last] = mutateLeaf(parent[last], path);
  return copy;
}

/** Each mutation of one unit: its leaves, then each absent optional set. */
function mutationsOf(unit: Json, optionals: Readonly<Record<string, Json>>): Json[] {
  const out = leafPaths(unit).map((p) => withLeaf(unit, p));
  const obj = unit as Record<string, Json>;
  for (const [k, v] of Object.entries(optionals)) if (!(k in obj)) out.push({ ...obj, [k]: v });
  return out;
}

const ROW_OPTIONALS = { prefField: "X", menuId: "X", nativeBehaviour: "X" };
const INVENTORY_OPTIONALS = { latent: "D267", names: ["X"] };

export const rowMutations = (row: CommandRow): CommandRow[] =>
  mutationsOf(row as unknown as Json, ROW_OPTIONALS) as unknown as CommandRow[];

export const inventoryMutations = (row: EditorOwnedRow): EditorOwnedRow[] =>
  mutationsOf(row as unknown as Json, INVENTORY_OPTIONALS) as unknown as EditorOwnedRow[];
