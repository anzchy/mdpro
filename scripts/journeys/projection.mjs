/**
 * Purpose: The log oracle of plan §4.4. A journey's projection file
 * (`tests/journeys/projections/EJ-NNN.json`) declares which events count and
 * which of their fields, which events are deliberately ignored, and which
 * orders the code guarantees. `normalize` turns a slice of `~/.mdpro/mdpro.log`
 * into comparable records; `compareProjection` holds them against a journey's
 * expected records.
 *
 * Projection file: `{ projectionVersion, events: { "<event>": { fields: [...] } },
 *   ignore?: ["<event>" | "<prefix>.*"], order?: [["<event>", "<event>", ...]] }`
 * Expected record: `{ event, status, fields: {...}, count?: n, atLeast?: n }`
 *
 * Key decisions:
 * - The two ADR-0047 hard rules hold whatever the projection says: every
 *   `fail` / `warn` / `error` line is reported unless the journey expects it,
 *   and every event in neither `events` nor `ignore` is reported. Nothing is
 *   dropped silently; an unparsable line is reported too.
 * - Normalisation keeps `event`, `status` and the declared fields only, so
 *   time, durations, pids and geometry go by construction. Window labels
 *   become W2, W3… (`main` stays) and document ids D1, D2… in order of first
 *   appearance; the run directory becomes `<RUN>` in both its `/tmp` and
 *   `/private/tmp` spellings.
 * - Counts are exact unless the expectation says `atLeast`; order is checked
 *   only along the declared sequences, by first occurrence.
 *
 * @module scripts/journeys/projection
 * @coordinates-with scripts/journeys/catalogue.mjs
 */

const WINDOW_KEYS = new Set(["windowLabel", "windowId"]);
const DOCUMENT_KEYS = new Set(["documentId", "fromDocumentId", "toDocumentId"]);

const finding = (rule, message) => ({ severity: "error", rule, message });

function parseLine(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A normaliser with its own label and id maps, so numbering follows first appearance in this slice. */
function normaliser(runDir) {
  const windows = new Map([["main", "main"]]);
  const documents = new Map();
  const prefixes = runDir ? [`/private${runDir}`, runDir] : [];
  const value = (key, v) => {
    if (Array.isArray(v)) return v.map((x) => value(key, x));
    if (typeof v !== "string") return v;
    if (WINDOW_KEYS.has(key)) {
      if (!windows.has(v)) windows.set(v, `W${windows.size + 1}`);
      return windows.get(v);
    }
    if (DOCUMENT_KEYS.has(key)) {
      if (!documents.has(v)) documents.set(v, `D${documents.size + 1}`);
      return documents.get(v);
    }
    const prefix = prefixes.find((p) => v === p || v.startsWith(`${p}/`));
    return prefix ? `<RUN>${v.slice(prefix.length)}` : v;
  };
  return value;
}

/** `ignore` entries are exact names, or a prefix when they end in `.*` (`mcp.*`). */
function ignoreMatcher(entries) {
  const exact = new Set(entries.filter((e) => !e.endsWith(".*")));
  const prefixes = entries.filter((e) => e.endsWith(".*")).map((e) => e.slice(0, -1));
  return (event) => exact.has(event) || prefixes.some((p) => event.startsWith(p));
}

const isFailure = (l) => l.status === "fail" || l.level === "warn" || l.level === "error";

/**
 * @returns {{ projected: object[], unknown: string[], failures: object[], bad: number }}
 */
export function normalize(lines, projection, { runDir } = {}) {
  const value = normaliser(runDir);
  const events = projection.events ?? {};
  const ignored = ignoreMatcher(projection.ignore ?? []);
  const projected = [];
  const unknown = new Set();
  const failures = [];
  let bad = 0;

  for (const raw of lines) {
    const line = parseLine(raw);
    if (line === null || typeof line !== "object" || typeof line.event !== "string") {
      bad += 1;
      continue;
    }
    const spec = events[line.event];
    let record = null;
    if (spec) {
      const fields = {};
      for (const key of spec.fields ?? []) {
        const v = line.context?.[key] ?? line[key];
        if (v !== undefined) fields[key] = value(key, v);
      }
      record = { event: line.event, status: line.status, fields };
      projected.push(record);
    } else if (!ignored(line.event)) {
      unknown.add(line.event);
    }
    if (isFailure(line)) failures.push({ line, record });
  }
  return { projected, unknown: [...unknown], failures, bad };
}

const keyOf = (r) =>
  JSON.stringify([r.event, r.status, Object.fromEntries(Object.entries(r.fields ?? {}).sort(([a], [b]) => a.localeCompare(b)))]);

/** @returns {object[]} findings: the slice against the journey's expected records */
export function compareProjection(lines, projection, expected, ctx = {}) {
  const { projected, unknown, failures, bad } = normalize(lines, projection, ctx);
  const out = [];
  if (bad > 0) out.push(finding("projection-bad-line", `${bad} log line(s) are not JSON log records`));
  for (const event of unknown) out.push(finding("projection-unknown", `${event} is in neither the projection nor its ignore list`));

  const expectedKeys = new Set(expected.map(keyOf));
  for (const { line, record } of failures) {
    if (!record || !expectedKeys.has(keyOf(record))) {
      out.push(finding("projection-failure-line", `${line.event} ${line.status} (level ${line.level}) is not expected by the journey`));
    }
  }

  const actual = new Map();
  for (const r of projected) actual.set(keyOf(r), (actual.get(keyOf(r)) ?? 0) + 1);
  const want = new Map();
  for (const e of expected) {
    const k = keyOf(e);
    const prev = want.get(k) ?? { exact: 0, atLeast: 0 };
    if (e.atLeast !== undefined) prev.atLeast += e.atLeast;
    else prev.exact += e.count ?? 1;
    want.set(k, prev);
  }
  for (const [k, w] of want) {
    const have = actual.get(k) ?? 0;
    const need = w.exact + w.atLeast;
    if (have < need) out.push(finding("projection-missing", `expected ${need} of ${k}, found ${have}`));
    else if (w.atLeast === 0 && have > w.exact) out.push(finding("projection-extra", `expected ${w.exact} of ${k}, found ${have}`));
  }
  for (const [k, have] of actual) {
    if (!want.has(k)) out.push(finding("projection-extra", `unexpected ${have} of ${k}`));
  }

  for (const sequence of projection.order ?? []) {
    const firsts = sequence.map((event) => projected.findIndex((r) => r.event === event)).filter((i) => i !== -1);
    if (firsts.some((at, i) => i > 0 && at < firsts[i - 1])) {
      out.push(finding("projection-order", `the order ${sequence.join(" → ")} is not kept`));
    }
  }
  return out;
}
