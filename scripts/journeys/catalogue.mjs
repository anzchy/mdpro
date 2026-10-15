/**
 * Purpose: The catalogue-wide rules of the journey gate (plan §4.5, the
 * `journeys:check` paragraph) that need no git history: each journey file
 * parses and passes the schema; ids are unique and lead their file name;
 * REGISTRY.md lists every id and every listed id has its file; `supersedes`
 * resolves, has no cycle and leaves nothing current behind; `knownDefect`
 * names a D row that exists; and the README's count block matches the
 * catalogue. The links a journey cites (tests, projection, fixtures) are
 * checked by `links.mjs` and `fixtures.mjs`, called from here.
 *
 * Pipeline: root → loadCatalogue → per-file findings + checkIds + checkRegistry
 *   + checkSupersedes + checkKnownDefects + checkCount + checkLinks
 *
 * Key decisions:
 * - A `draft` journey is checked for structure only (schema.mjs): it gets the
 *   id and registry rules, but none of the rules about what it cites.
 * - An ADR-0047 spike id (`J1a`) in `supersedes` resolves against the spike
 *   document's `### <id>` headings, which stay frozen (plan §4.9).
 *
 * @module scripts/journeys/catalogue
 * @coordinates-with scripts/journeys/parse.mjs, scripts/journeys/schema.mjs,
 *   scripts/journeys/links.mjs, scripts/journeys/fixtures.mjs,
 *   scripts/journeys/check.mjs
 */
import fs from "node:fs";
import path from "node:path";

import { checkLinks } from "./links.mjs";
import { parseJourney } from "./parse.mjs";
import { ID_RE, checkMeta } from "./schema.mjs";

export const CATALOGUE_DIR = "tests/journeys";
export const REGISTRY_FILE = `${CATALOGUE_DIR}/REGISTRY.md`;
export const README_FILE = `${CATALOGUE_DIR}/README.md`;
export const SEQUENCING_DOC = "docs/plans/20260912-frontend-backend-sequencing-order.md";
export const SPIKE_DOC = "docs/test/20261002-adr0047-journeys.md";
export const LEDGER_DOC = "docs/feature-ledger.md";

const NOT_JOURNEYS = new Set(["README.md", "REGISTRY.md"]);
const COUNT_RE = /<!--\s*journeys:count\s*-->[\s\S]*?<!--\s*\/journeys:count\s*-->/;
const SPIKE_ID_RE = /^J\d+[a-z]?$/;

const finding = (rule, message, file) => ({ severity: "error", rule, message, file });
const read = (root, rel) => {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};

/** Every journey file under the catalogue directory, parsed. */
export function loadCatalogue(root) {
  const dir = path.join(root, CATALOGUE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !NOT_JOURNEYS.has(name))
    .sort()
    .map((name) => {
      const rel = `${CATALOGUE_DIR}/${name}`;
      return { name, rel, ...parseJourney(fs.readFileSync(path.join(root, rel), "utf8")) };
    });
}

/** The ids listed in REGISTRY.md: the first cell of every table row that holds an EJ id. */
export function parseRegistry(text) {
  return text
    .split(/\r?\n/)
    .map((line) => /^\|\s*(EJ-\d{3})\s*\|/.exec(line)?.[1])
    .filter(Boolean);
}

/** The README block that states the catalogue's size; generated, never hand-written. */
export function countBlock(metas) {
  const by = (s) => metas.filter((m) => m.status === s).length;
  const line = `**${metas.length}** journeys: ${by("active")} active, ${by("draft")} draft, ${by("retired")} retired.`;
  return `<!-- journeys:count -->\n${line}\n<!-- /journeys:count -->`;
}

/** README text with its count block regenerated, or null if it has none. */
export function rewriteCount(readme, metas) {
  return COUNT_RE.test(readme) ? readme.replace(COUNT_RE, countBlock(metas)) : null;
}

/** @returns {object[]} every catalogue finding under `root` */
export function checkCatalogue(root) {
  const journeys = loadCatalogue(root);
  const out = [];
  for (const j of journeys) {
    out.push(...j.findings.map((f) => ({ ...f, file: j.rel })));
    if (j.meta) out.push(...checkMeta(j.meta).map((f) => ({ ...f, file: j.rel })));
  }
  const parsed = journeys.filter((j) => j.meta && typeof j.meta.id === "string");
  checkIds(parsed, out);
  checkRegistry(root, journeys, parsed, out);
  const live = parsed.filter((j) => j.meta.status !== "draft");
  checkSupersedes(root, parsed, out);
  checkKnownDefects(root, live, out);
  checkCount(root, parsed.map((j) => j.meta), out);
  out.push(...checkLinks(root, parsed));
  return out;
}

function checkIds(parsed, out) {
  const seen = new Map();
  for (const j of parsed) {
    const { id } = j.meta;
    if (seen.has(id)) out.push(finding("journey-id-dup", `${id} is used by ${seen.get(id)} and ${j.rel}`, j.rel));
    else seen.set(id, j.rel);
    if (!j.name.startsWith(`${id}-`)) {
      out.push(finding("journey-file-name", `${j.name} holds ${id}; the file name must start with "${id}-"`, j.rel));
    }
  }
}

function checkRegistry(root, journeys, parsed, out) {
  const text = read(root, REGISTRY_FILE);
  if (text === null) {
    out.push(finding("journey-unregistered", `${REGISTRY_FILE} is missing`, REGISTRY_FILE));
    return;
  }
  const registered = new Set(parseRegistry(text));
  for (const j of parsed) {
    if (!registered.has(j.meta.id)) out.push(finding("journey-unregistered", `${j.meta.id} is not in ${REGISTRY_FILE}`, j.rel));
  }
  // A file that does not parse still owns its id through its name.
  const present = new Set(journeys.map((j) => /^(EJ-\d{3})-/.exec(j.name)?.[1]).concat(parsed.map((j) => j.meta.id)));
  for (const id of registered) {
    if (!present.has(id)) {
      out.push(finding("journey-file-missing", `${id} is registered but has no journey file; files are never deleted`, REGISTRY_FILE));
    }
  }
}

function checkSupersedes(root, parsed, out) {
  const byId = new Map(parsed.map((j) => [j.meta.id, j]));
  const spike = read(root, SPIKE_DOC) ?? "";
  const ledger = read(root, LEDGER_DOC) ?? "";
  for (const j of parsed) {
    for (const old of j.meta.supersedes ?? []) {
      if (ID_RE.test(old)) {
        const target = byId.get(old);
        if (!target) {
          out.push(finding("journey-supersedes", `${j.meta.id} supersedes ${old}, which has no journey file`, j.rel));
          continue;
        }
        if (target.meta.status !== "retired") {
          out.push(finding("journey-supersedes-current", `${old} is superseded by ${j.meta.id} but is still ${target.meta.status}`, j.rel));
        }
        if (new RegExp(`旅程(?:（部分）)?：\\s*${old}\\b`).test(ledger)) {
          out.push(finding("journey-supersedes-current", `${old} is superseded by ${j.meta.id} but ${LEDGER_DOC} still cites it`, j.rel));
        }
      } else if (!SPIKE_ID_RE.test(old) || !new RegExp(`^### ${old}\\b`, "m").test(spike)) {
        out.push(finding("journey-supersedes", `${j.meta.id} supersedes ${old}, which is neither a journey nor a heading in ${SPIKE_DOC}`, j.rel));
      }
    }
  }
  for (const cycle of findCycles(byId)) {
    out.push(finding("journey-supersedes-cycle", `supersedes cycle: ${cycle.join(" → ")}`, byId.get(cycle[0]).rel));
  }
}

/** Each cycle in the supersedes graph, once, starting from its smallest id. */
function findCycles(byId) {
  const cycles = new Map();
  const walk = (id, trail) => {
    const at = trail.indexOf(id);
    if (at !== -1) {
      const loop = trail.slice(at);
      const start = loop.indexOf([...loop].sort()[0]);
      const key = [...loop.slice(start), ...loop.slice(0, start)];
      cycles.set(key.join(","), [...key, key[0]]);
      return;
    }
    for (const next of byId.get(id)?.meta.supersedes ?? []) if (byId.has(next)) walk(next, [...trail, id]);
  };
  for (const id of byId.keys()) walk(id, []);
  return [...cycles.values()];
}

function checkKnownDefects(root, live, out) {
  const seq = read(root, SEQUENCING_DOC) ?? "";
  for (const j of live) {
    for (const c of j.meta.cases ?? []) {
      const d = c?.knownDefect;
      if (d === undefined || d === null) continue;
      const ok = typeof d === "string" && /^D\d+$/.test(d) && seq.includes(`<a id="${d.toLowerCase()}"></a>`);
      if (!ok) out.push(finding("journey-known-defect", `${j.meta.id}/${c.id}: knownDefect ${JSON.stringify(d)} has no row in ${SEQUENCING_DOC}`, j.rel));
    }
  }
}

function checkCount(root, metas, out) {
  const readme = read(root, README_FILE);
  const want = countBlock(metas);
  const have = readme === null ? null : COUNT_RE.exec(readme)?.[0];
  if (have !== want) {
    out.push(finding("journey-count", `${README_FILE} count block is stale or missing; run \`pnpm journeys:check --write-count\``, README_FILE));
  }
}
