/**
 * Purpose: The minimal `fixture.json` contract (E2E-WI-1, delegator ruling
 * Q-a, 2026-10-15): every listed file under `tests/journeys/fixtures/<id>/`
 * matches its recorded sha256, and a declared generator passes when run with
 * `--check`. The golden-source field, the golden key format and the real
 * corpus are WI-E2E-2's.
 *
 * Shape: `{ "files": { "<path relative to the fixture dir>": "<sha256>" },
 *           "generator"?: { "script": "<repo-relative .mjs>", "args": [...] } }`
 *
 * @module scripts/journeys/fixtures
 * @coordinates-with scripts/journeys/links.mjs
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const FIXTURES_DIR = "tests/journeys/fixtures";

const finding = (rule, message) => ({ severity: "error", rule, message });
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** @returns {object[]} findings for one fixture id */
export function checkFixture(root, id) {
  const dir = `${FIXTURES_DIR}/${id}`;
  const manifestPath = path.join(root, dir, "fixture.json");
  if (!fs.existsSync(manifestPath)) return [finding("journey-fixture", `${dir}/fixture.json does not exist`)];

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return [finding("journey-fixture", `${dir}/fixture.json is not JSON: ${error instanceof Error ? error.message : String(error)}`)];
  }
  if (manifest?.files === null || typeof manifest?.files !== "object" || Array.isArray(manifest.files)) {
    return [finding("journey-fixture", `${dir}/fixture.json needs a \`files\` object`)];
  }

  const out = [];
  for (const [name, want] of Object.entries(manifest.files)) {
    const abs = path.join(root, dir, name);
    if (!fs.existsSync(abs)) out.push(finding("journey-fixture-sha", `${dir}/${name} is listed but missing`));
    else if (sha256(fs.readFileSync(abs)) !== want) out.push(finding("journey-fixture-sha", `${dir}/${name} does not match its sha256`));
  }

  const gen = manifest.generator;
  if (gen !== undefined) {
    if (typeof gen?.script !== "string" || !Array.isArray(gen.args ?? [])) {
      out.push(finding("journey-fixture", `${dir}/fixture.json: \`generator\` needs a \`script\` and an \`args\` list`));
    } else {
      const r = spawnSync(process.execPath, [path.join(root, gen.script), ...(gen.args ?? []), "--check"], {
        cwd: root,
        encoding: "utf8",
      });
      if (r.status !== 0) {
        out.push(finding("journey-fixture-generator", `${gen.script} --check exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`));
      }
    }
  }
  return out;
}
