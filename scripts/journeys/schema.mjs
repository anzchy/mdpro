/**
 * Purpose: Check one journey's metadata against the plan's §4.1 schema:
 * required fields and their types, the closed enums, `n/a` needing a reason,
 * a group needing an order, a retired journey needing a reason, and case ids
 * unique within the journey. A `draft` journey gets the structural check only
 * (id, title, status), so a journey can be written before it is complete
 * (plan WI-E2E-1 Risks).
 *
 * @module scripts/journeys/schema
 * @coordinates-with scripts/journeys/parse.mjs, scripts/journeys/catalogue.mjs
 */

export const STATUSES = Object.freeze(["active", "draft", "retired"]);
export const TIERS = Object.freeze(["smoke", "full", "targeted"]);
export const PLATFORMS = Object.freeze(["macos", "windows"]);
export const PLATFORM_STATUSES = Object.freeze(["required", "optional", "n/a"]);
export const CASE_MODES = Object.freeze(["W", "S"]);
export const CASE_STATUSES = Object.freeze(["active", "retired"]);
export const ID_RE = /^EJ-\d{3}$/;

const finding = (rule, message) => ({ severity: "error", rule, message });
const isString = (v) => typeof v === "string" && v.trim() !== "";
const isStringArray = (v) => Array.isArray(v) && v.every(isString);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** @returns {object[]} findings for one journey's metadata */
export function checkMeta(meta) {
  const out = [];
  const field = (name, message) => out.push(finding("journey-meta-field", `\`${name}\` ${message}`));
  const enumOf = (name, value, allowed) => {
    if (!allowed.includes(value)) {
      out.push(finding("journey-meta-enum", `\`${name}\` is ${JSON.stringify(value)}; allowed: ${allowed.join(", ")}`));
    }
  };

  if (!isString(meta.id) || !ID_RE.test(meta.id)) field("id", "must be EJ-NNN");
  if (!isString(meta.title)) field("title", "must be a non-empty string");
  if (meta.status === undefined) field("status", "is missing");
  else enumOf("status", meta.status, STATUSES);
  if (meta.status === "draft") return out;

  if (meta.status === "retired" && !isString(meta.reason)) {
    out.push(finding("journey-retired-reason", "a retired journey needs `reason`"));
  }
  if (!isString(meta.area)) field("area", "must name a ledger area");
  if (!Array.isArray(meta.tier) || meta.tier.length === 0) field("tier", "must be a non-empty list");
  else meta.tier.forEach((t) => enumOf("tier", t, TIERS));
  checkPlatforms(meta.platforms, out, field, enumOf);
  for (const name of ["fixtures", "tier0", "rust", "supersedes"]) {
    if (meta[name] !== undefined && !isStringArray(meta[name])) field(name, "must be a list of strings");
  }
  if (!isString(meta.projection)) field("projection", "must be a path");
  checkLedger(meta.ledger, field);
  checkCases(meta.cases, out, field, enumOf);
  if (meta.group !== undefined && meta.group !== null) {
    if (!isString(meta.group)) field("group", "must be a name or null");
    else if (!Number.isInteger(meta.order)) {
      out.push(finding("journey-group-order", `group "${meta.group}" needs an integer \`order\``));
    }
  }
  return out;
}

function checkPlatforms(platforms, out, field, enumOf) {
  if (!isObject(platforms)) return field("platforms", "must be an object");
  for (const name of Object.keys(platforms)) enumOf("platforms", name, PLATFORMS);
  for (const name of PLATFORMS) {
    const p = platforms[name];
    if (!isObject(p)) {
      field(`platforms.${name}`, "is missing");
      continue;
    }
    enumOf(`platforms.${name}.status`, p.status, PLATFORM_STATUSES);
    if (p.status === "n/a" && !isString(p.reason)) {
      out.push(finding("journey-na-reason", `platforms.${name} is n/a without a \`reason\``));
    }
  }
}

function checkLedger(ledger, field) {
  if (!Array.isArray(ledger)) return field("ledger", "must be a list");
  ledger.forEach((entry, i) => {
    if (!isObject(entry) || !isString(entry.row)) field(`ledger[${i}].row`, "must name the row's 能力 cell");
    else if (!isStringArray(entry.covers) || entry.covers.length === 0) field(`ledger[${i}].covers`, "must list what it proves");
    else if (entry.cases !== undefined && !isStringArray(entry.cases)) field(`ledger[${i}].cases`, "must be a list of case ids");
    else if (entry.partial !== undefined && !isString(entry.partial)) field(`ledger[${i}].partial`, "must say what is not covered");
  });
}

function checkCases(cases, out, field, enumOf) {
  if (!Array.isArray(cases) || cases.length === 0) return field("cases", "must be a non-empty list");
  const seen = new Set();
  cases.forEach((c, i) => {
    if (!isObject(c) || !isString(c.id)) return field(`cases[${i}].id`, "is missing");
    if (seen.has(c.id)) out.push(finding("journey-case-dup", `case id ${c.id} is used twice`));
    seen.add(c.id);
    if (!isString(c.intended)) field(`cases[${i}].intended`, "must state the intended behaviour");
    if (c.mode !== undefined && c.mode !== null) enumOf(`cases[${i}].mode`, c.mode, CASE_MODES);
    if (c.status !== undefined) enumOf(`cases[${i}].status`, c.status, CASE_STATUSES);
    for (const key of ["platforms", "optional"]) {
      if (c[key] === undefined) continue;
      if (!Array.isArray(c[key])) field(`cases[${i}].${key}`, "must be a list of platforms");
      else c[key].forEach((p) => enumOf(`cases[${i}].${key}`, p, PLATFORMS));
    }
    if (c.knownDefect !== undefined && c.knownDefect !== null && !isString(c.knownDefect)) {
      field(`cases[${i}].knownDefect`, "must be a D id or null");
    }
  });
}
