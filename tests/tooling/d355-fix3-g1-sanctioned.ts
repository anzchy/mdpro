/**
 * Purpose: the exact D302 conversion D355 fix 3 made to the guard files G1 pins (d355-fix1-shoulds.test.ts): each
 * guard's candidate text (98de0c69, plus ruling 2's cap change) becomes its current text by these replacements, each of
 * which must match exactly once. Generated from `git diff 98de0c69` at fix 3; any other change to a guard fails G1.
 */
export const FIX3_D302: Record<string, Array<[string, string]>> = {
  "tests/tooling/always-on-budget.test.ts": [
    [
      "import path from \"node:path\";\nimport { describe, expect, it } from \"vitest\";\nimport {\n",
      "import path from \"node:path\";\nimport { beforeAll, describe, expect, it } from \"vitest\";\nimport {\n"
    ],
    [
      "  bytesOf, capOf, claudeAlwaysOn, codexShared, directiveScanSet, frontmatterPaths, overCaps, POLICY_SET, readBlocks,\n  readDirectiveViolations, readRel, route, ROUTES, SCOPED_PATTERN_ALLOWLIST, trackedFiles, type Runtime,\n} from \"./rules-budget-lib\";\n",
      "  bytesOf, capOf, claudeAlwaysOn, codexShared, directiveScanSet, frontmatterPaths, overCaps, POLICY_SET, readBlocks,\n  readDirectiveViolations, readRel, route, ROUTES, SCOPED_PATTERN_ALLOWLIST, loadTrackedFiles, trackedFiles, type Runtime,\n} from \"./rules-budget-lib\";\n"
    ],
    [
      "describe(\"always-on budget (live tree)\", () => {\n  it(\"the cap constants are the ruled values and under ADR-0147's ceilings (B18, B40)\", () => {\n",
      "describe(\"always-on budget (live tree)\", () => {\n  // D355 fix 3: the tracked list is read by an awaited git (D302); every case below reads it from the cache\n  beforeAll(() => loadTrackedFiles(root));\n\n  it(\"the cap constants are the ruled values and under ADR-0147's ceilings (B18, B40)\", () => {\n"
    ]
  ],
  "tests/tooling/rules-budget-caps.test.ts": [
    [
      "\nit(\"P6: a policy route whose policy set is missing names it as a route error\", () => {\n  const root = fixture({\n    \"CLAUDE.md\": \"c\", \"AGENTS.md\": \"<!-- read-every-session:begin -->\\n- [c](CLAUDE.md)\\n<!-- read-every-session:end -->\\n\",\n",
      "\nit(\"P6: a policy route whose policy set is missing names it as a route error\", async () => {\n  const root = await fixture({\n    \"CLAUDE.md\": \"c\", \"AGENTS.md\": \"<!-- read-every-session:begin -->\\n- [c](CLAUDE.md)\\n<!-- read-every-session:end -->\\n\",\n"
    ]
  ],
  "tests/tooling/rule-citations.test.ts": [
    [
      "import path from \"node:path\";\nimport { describe, expect, it } from \"vitest\";\nimport {\n",
      "import path from \"node:path\";\nimport { beforeAll, describe, expect, it } from \"vitest\";\nimport {\n"
    ],
    [
      "import {\n  citationScanSet, findCitations, githubSlug, headingsAt, loadMap, readRel, RULE_FILES, scanCitations, SECTION_MAP,\n} from \"./rules-budget-lib\";\n",
      "import {\n  citationScanSet, findCitations, githubSlug, headingsAt, loadMap, loadTrackedFiles, readRel, RULE_FILES, scanCitations, SECTION_MAP,\n} from \"./rules-budget-lib\";\n"
    ],
    [
      "describe(\"rule 70 and 71 citations resolve (live tree)\", () => {\n  const scan = scanCitations(root);\n\n",
      "describe(\"rule 70 and 71 citations resolve (live tree)\", () => {\n  // D355 fix 3: the tracked list is read by an awaited git (D302), so the scan runs once the cache is loaded\n  let scan: ReturnType<typeof scanCitations>;\n  beforeAll(async () => {\n    await loadTrackedFiles(root);\n    scan = scanCitations(root);\n  });\n\n"
    ]
  ],
  "tests/tooling/d355-r3-history.test.ts": [
    [
      "// and relative links re-based from .claude/rules/ to docs/reference/.\nimport { execFileSync } from \"node:child_process\";\nimport fs from \"node:fs\";\n",
      "// and relative links re-based from .claude/rules/ to docs/reference/.\nimport { execFile } from \"node:child_process\";\nimport fs from \"node:fs\";\n"
    ],
    [
      "import path from \"node:path\";\nimport { describe, expect, it } from \"vitest\";\n",
      "import path from \"node:path\";\nimport { promisify } from \"node:util\";\nimport { describe, expect, it } from \"vitest\";\n"
    ],
    [
      "const read = (rel: string) => fs.readFileSync(path.join(root, rel), \"utf8\");\nconst atBase = (rel: string) => execFileSync(\"git\", [\"show\", `${BASE}:${rel}`], { cwd: root, encoding: \"utf8\" });\n\n",
      "const read = (rel: string) => fs.readFileSync(path.join(root, rel), \"utf8\");\n// awaited git (D302: no synchronous child process in a test worker; D355 fix 3)\nconst runFile = promisify(execFile);\nconst atBase = async (rel: string) => (await runFile(\"git\", [\"show\", `${BASE}:${rel}`], { cwd: root, encoding: \"utf8\" })).stdout;\n\n"
    ],
    [
      "\n  it(\"P29: the rule 70 and rule 71 bodies are the base's text under the stated transform\", () => {\n    const text = read(HISTORY);\n",
      "\n  it(\"P29: the rule 70 and rule 71 bodies are the base's text under the stated transform\", async () => {\n    const text = read(HISTORY);\n"
    ],
    [
      "    const r71 = between(text, `## Rule 71 at ${BASE}\\n\\n`, `\\n## Rule 12 at ${BASE}`);\n    expect(r70.trimEnd()).toBe(historyForm(atBase(\".claude/rules/70-multi-session-coordination.md\")).trimEnd());\n    expect(r71.trimEnd()).toBe(historyForm(atBase(\".claude/rules/71-herdr-mixed-roster.md\")).trimEnd());\n    expect(r70).toContain(\"`docs/agents/audit-policy-set.md` blob `<P>`\");\n",
      "    const r71 = between(text, `## Rule 71 at ${BASE}\\n\\n`, `\\n## Rule 12 at ${BASE}`);\n    expect(r70.trimEnd()).toBe(historyForm(await atBase(\".claude/rules/70-multi-session-coordination.md\")).trimEnd());\n    expect(r71.trimEnd()).toBe(historyForm(await atBase(\".claude/rules/71-herdr-mixed-roster.md\")).trimEnd());\n    expect(r70).toContain(\"`docs/agents/audit-policy-set.md` blob `<P>`\");\n"
    ]
  ],
  "tests/tooling/gh586-audit-policy-split.test.ts": [
    [
      "// dimension allowance 13,000 B). Base for the byte-identity checks: db04d826:docs/agents/audit-dimensions.md.\nimport { execFileSync } from \"node:child_process\";\nimport { createHash } from \"node:crypto\";\n",
      "// dimension allowance 13,000 B). Base for the byte-identity checks: db04d826:docs/agents/audit-dimensions.md.\nimport { execFile } from \"node:child_process\";\nimport { createHash } from \"node:crypto\";\n"
    ],
    [
      "import path from \"node:path\";\nimport { describe, expect, it } from \"vitest\";\n\n",
      "import path from \"node:path\";\nimport { promisify } from \"node:util\";\nimport { beforeAll, describe, expect, it } from \"vitest\";\n\n"
    ],
    [
      "  const ENTRY_HEAD = \"9c32bcdeef17d96f4de69c7563a42508e1460aa2\";\n  const size = (rel: string) =>\n    Number(execFileSync(\"git\", [\"cat-file\", \"-s\", `${ENTRY_HEAD}:${rel}`], { cwd: root, encoding: \"utf8\" }).trim());\n  const templates = [\"audit\", \"confirm\", \"challenge\", \"plan-review\"].map(kind =>\n    size(`.agents/skills/mdpro-delegator/references/templates/${kind}-request-template.md`));\n\n",
      "  const ENTRY_HEAD = \"9c32bcdeef17d96f4de69c7563a42508e1460aa2\";\n  // awaited git (D302: no synchronous child process in a test worker; D355 fix 3)\n  const runFile = promisify(execFile);\n  const size = async (rel: string) =>\n    Number((await runFile(\"git\", [\"cat-file\", \"-s\", `${ENTRY_HEAD}:${rel}`], { cwd: root, encoding: \"utf8\" })).stdout.trim());\n  let templates: number[] = [];\n  beforeAll(async () => {\n    templates = await Promise.all([\"audit\", \"confirm\", \"challenge\", \"plan-review\"].map(kind =>\n      size(`.agents/skills/mdpro-delegator/references/templates/${kind}-request-template.md`)));\n  });\n\n"
    ],
    [
      "\n  it(\"adds up live figures to totals under each cap, with the shared set labelled planned and auditor.md a budget\", () => {\n    const caps = flat(field(\"Caps\"));\n",
      "\n  it(\"adds up live figures to totals under each cap, with the shared set labelled planned and auditor.md a budget\", async () => {\n    const caps = flat(field(\"Caps\"));\n"
    ],
    [
      "    expect(shared).toBe(29_431);\n    expect(dimsB).toBe(size(\"docs/agents/audit-dimensions.md\"));\n    expect(request).toBe(Math.max(...templates));\n",
      "    expect(shared).toBe(29_431);\n    expect(dimsB).toBe(await size(\"docs/agents/audit-dimensions.md\"));\n    expect(request).toBe(Math.max(...templates));\n"
    ],
    [
      "    expect(auditor).toBe(3_500);\n    expect(policyB).toBe(size(\"docs/agents/audit-policy-set.md\"));\n    expect(ordinaryTotal).toBe(shared + dimsB + request + auditor);\n",
      "    expect(auditor).toBe(3_500);\n    expect(policyB).toBe(await size(\"docs/agents/audit-policy-set.md\"));\n    expect(ordinaryTotal).toBe(shared + dimsB + request + auditor);\n"
    ]
  ],
  "tests/tooling/rules-lib-core.ts": [
    [
      " * Key decisions: only tracked files are scanned (`git ls-files -z`), so CJK paths come back unquoted and a stray\n * untracked file cannot break the gate.\n *\n",
      " * Key decisions: only tracked files are scanned (`git ls-files -z`), so CJK paths come back unquoted and a stray\n * untracked file cannot break the gate. The list is read once per root by the awaited `loadTrackedFiles` (D302: no\n * synchronous child process blocks a worker); `trackedFiles` only reads that cache and throws for a root never loaded.\n *\n"
    ],
    [
      " */\nimport { execFileSync } from \"node:child_process\";\nimport fs from \"node:fs\";\n",
      " */\nimport { execFile } from \"node:child_process\";\nimport fs from \"node:fs\";\n"
    ],
    [
      "import path from \"node:path\";\n\n",
      "import path from \"node:path\";\nimport { promisify } from \"node:util\";\n\n"
    ],
    [
      "\nexport function trackedFiles(root: string): string[] {\n",
      "\nconst runFile = promisify(execFile);\nconst LS_FILES_MAX_BUFFER = 64 * 1024 * 1024;\nconst trackedCache = new Map<string, string[]>();\n\n/** Reads `root`'s tracked files with an awaited `git ls-files -z` and caches them for `trackedFiles`; a failure caches nothing. */\nexport async function loadTrackedFiles(root: string): Promise<string[]> {\n  const { stdout } = await runFile(\"git\", [\"ls-files\", \"-z\"], { cwd: root, maxBuffer: LS_FILES_MAX_BUFFER, encoding: \"utf8\" });\n  const list = stdout.split(\"\\0\").filter(Boolean);\n  trackedCache.set(path.resolve(root), list);\n  return list;\n}\n\n/** The tracked files `loadTrackedFiles(root)` read; it never runs git itself. */\nexport function trackedFiles(root: string): string[] {\n"
    ],
    [
      "export function trackedFiles(root: string): string[] {\n  const out = execFileSync(\"git\", [\"ls-files\", \"-z\"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString(\"utf8\");\n  return out.split(\"\\0\").filter(Boolean);\n}\n",
      "export function trackedFiles(root: string): string[] {\n  const list = trackedCache.get(path.resolve(root));\n  if (!list) throw new Error(`trackedFiles(${root}): await loadTrackedFiles(root) first`);\n  return list;\n}\n"
    ]
  ]
};

/** `text` with `pairs` applied in order; throws when a `from` is not found exactly once. */
export function applyExactly(text: string, pairs: Array<[string, string]> = []): string {
  return pairs.reduce((t, [from, to]) => {
    const n = t.split(from).length - 1;
    if (n !== 1) throw new Error(`sanctioned replacement matched ${n} times: ${JSON.stringify(from.slice(0, 80))}`);
    return t.replace(from, () => to);
  }, text);
}
