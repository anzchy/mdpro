/**
 * Purpose: Read one journey file (`tests/journeys/EJ-NNN-<slug>.md`, plan
 * §4.1): the metadata in its first fenced code block, which must carry the
 * info string `json journey`, and the names of its level-2 sections. No
 * filesystem access, so every rule is testable on a string.
 *
 * Key decisions:
 * - The metadata block must be the file's FIRST code block. A later one is
 *   not looked for: a reader, and the gate, should find it at the top.
 * - JSON, not YAML, so the gate runs on bare node with no dependency
 *   (plan §0 Q1, §4.8).
 *
 * @module scripts/journeys/parse
 * @coordinates-with scripts/journeys/schema.mjs, scripts/journeys/catalogue.mjs
 */

export const META_INFO = "json journey";

const FENCE = /^```(.*)$/;

const finding = (rule, message, lineNumber) => ({ severity: "error", rule, message, lineNumber });

/**
 * @param {string} text the journey file's content
 * @returns {{ meta: object | null, findings: object[], sections: string[], metaLine: number | null }}
 */
export function parseJourney(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let meta = null;
  let metaLine = null;
  const findings = [];
  let first = true;

  for (let i = 0; i < lines.length; i += 1) {
    const fence = FENCE.exec(lines[i]);
    if (fence) {
      const end = lines.findIndex((l, j) => j > i && l.startsWith("```"));
      const close = end === -1 ? lines.length : end;
      if (first) {
        first = false;
        if (fence[1].trim() === META_INFO) {
          metaLine = i + 1;
          ({ meta } = readMeta(lines.slice(i + 1, close).join("\n"), i + 1, findings));
        }
      }
      i = close;
      continue;
    }
    const heading = /^##\s+(.*\S)\s*$/.exec(lines[i]);
    if (heading && !lines[i].startsWith("###")) sections.push(heading[1]);
  }

  if (metaLine === null) {
    findings.push(finding("journey-meta-missing", `the first code block must be \`\`\`${META_INFO}`, 1));
  }
  return { meta, findings, sections, metaLine };
}

function readMeta(json, lineNumber, findings) {
  try {
    const value = JSON.parse(json);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      findings.push(finding("journey-meta-json", "the metadata must be a JSON object", lineNumber));
      return { meta: null };
    }
    return { meta: value };
  } catch (error) {
    findings.push(finding("journey-meta-json", error instanceof Error ? error.message : String(error), lineNumber));
    return { meta: null };
  }
}
