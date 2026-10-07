/**
 * RFC 7396 JSON Merge Patch and leaf-path helpers, the test oracle for how
 * `tauri build --config <a> --config <b>` combines configs (ADR-0047 WI-002).
 *
 * Shared by `tests/control-verify-overlay.test.ts` (which self-checks
 * `mergePatch` against the RFC's Appendix A vectors), the WI-002 build-profile
 * tests, and the fake `pnpm tauri build` in `controlBuildRepo.ts`, which names
 * the bundle after the merged `productName`.
 *
 * A "leaf" is any value that is not a non-empty plain object: arrays are
 * leaves (merge patch replaces them whole), and so is `{}`.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** RFC 7396 §2 `MergePatch(Target, Patch)`; inputs are not mutated. */
export function mergePatch(target: Json, patch: Json): Json {
  if (!isObject(patch)) return patch;
  const out: JsonObject = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key] ?? null, value);
  }
  return out;
}

/** Every leaf path of `value`, each as a list of keys, in document order. */
export function leafPaths(value: Json, prefix: string[] = []): string[][] {
  if (!isObject(value) || Object.keys(value).length === 0) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...prefix, k]));
}

/** Every leaf value of `value` (arrays are walked into, unlike `leafPaths`). */
export function leafValues(value: Json): Json[] {
  if (Array.isArray(value)) return value.length === 0 ? [value] : value.flatMap(leafValues);
  if (isObject(value)) {
    const entries = Object.values(value);
    return entries.length === 0 ? [value] : entries.flatMap(leafValues);
  }
  return [value];
}

/** The value at `p`, or `undefined` when any step is missing. */
export function getPath(value: Json, p: string[]): Json | undefined {
  let cur: Json | undefined = value;
  for (const key of p) {
    if (!isObject(cur) || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Whether `p` equals `ancestor` or lies under it. */
export const isUnder = (p: string[], ancestor: string[]): boolean =>
  ancestor.length <= p.length && ancestor.every((k, i) => p[i] === k);

/** Dotted form of a path, for messages and set comparisons. */
export const dotted = (p: string[]): string => p.join(".");
