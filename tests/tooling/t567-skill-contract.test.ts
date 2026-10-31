// @vitest-environment node
/**
 * T-01 (#569): the `jack-tdd-workflow` skill's contract — the files and link other sessions rely on, the
 * method statements briefs will point at, and the size cap. Checks contract phrases, not a prose snapshot.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const skillDir = path.join(root, ".agents/skills/jack-tdd-workflow");
const skillMd = path.join(skillDir, "SKILL.md");
const read = (file: string) => fs.readFileSync(file, "utf8");

/** Every regular file under `dir`, recursively, as paths relative to `dir`. */
function skillFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return skillFiles(full).map((file) => path.join(entry.name, file));
    return entry.isFile() ? [entry.name] : [];
  });
}

/** `[file, pattern]` for every skill file whose text matches one of `patterns`. */
function matchesIn(dir: string, patterns: RegExp[]): string[] {
  return skillFiles(dir).flatMap((file) => {
    const text = read(path.join(dir, file));
    return patterns.filter((pattern) => pattern.test(text)).map((pattern) => `${file} ${pattern}`);
  });
}

const caseClasses = ["success", "boundary", "invalid input", "lifecycle and timing", "caller or entry path", "platform"];
const missing = (text: string, tokens: string[]) => tokens.filter((token) => !text.toLowerCase().includes(token.toLowerCase()));

/** Paragraphs: runs of lines separated by a blank or whitespace-only line. */
const paragraphs = (text: string) => text.split(/\n[ \t]*\n/);

/**
 * True when one paragraph holds every token, each (case-insensitive) after the one before it, and none of `without`.
 */
function sameParagraph(text: string, tokens: string[], without: string[] = []): boolean {
  return paragraphs(text).some((paragraph) => {
    const lower = paragraph.toLowerCase();
    if (without.some((token) => lower.includes(token.toLowerCase()))) return false;
    let from = 0;
    for (const token of tokens) {
      const at = lower.indexOf(token.toLowerCase(), from);
      if (at < 0) return false;
      from = at + token.length;
    }
    return true;
  });
}

/** The Q1 cap on SKILL.md (story 48): lines and UTF-8 bytes. */
const MAX_SKILL_LINES = 300;
const MAX_SKILL_BYTES = 24 * 1024;
const lineCount = (text: string) => (text === "" ? 0 : text.replace(/\n$/, "").split("\n").length);
const withinCap = (text: string) => lineCount(text) <= MAX_SKILL_LINES && Buffer.byteLength(text, "utf8") <= MAX_SKILL_BYTES;

/** Contract tokens a keyword dump would carry; the method must state them in sentences instead. */
const contractTokens = [
  "<ID>-ACC", "<ID>-S<n>", "minimal change", "`verify`", "one intended assertion", "added in cycle n", "new seam",
  "NEEDS RULING", "ATTACK-NOT-RUN", "counter-proof", "raw-green", "suffixed", "/code-review", "/diagnosing-bugs",
  "once per grant", "at most one re-attack", "codex exec", "never a fork",
];
const tokensIn = (text: string) => contractTokens.filter((token) => text.includes(token)).length;
/** Lines of a paragraph that are a bare contract token (at most four words, one token), as a keyword list has. */
const bareTokenLines = (paragraph: string) => paragraph.split("\n").filter((line) =>
  tokensIn(line) === 1 && line.replace(/^[-*\s]+/, "").trim().split(/\s+/).length <= 4);

const copiedReceiptCommands = [/red-receipt\.mjs\s+(record|verify|replay|discard|check-pending)\b/, /--lane\s+rust/];
const pluginRoutes = [/tdd-guardian:/, /mdpro-spec-adversary/];
const ruleTwentyFiveCommands = [/git (reset --hard|checkout \.|restore \.|clean -f)|rm -rf|branch -D/];

/** The top-level `key: value` pairs of a leading `---` fenced block, or null when the fence is absent or unclosed. */
function frontmatter(text: string): Record<string, string> | null {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([a-z][a-z0-9-]*):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return fields;
}

describe("T567 jack-tdd-workflow skill files", () => {
  it("has SKILL.md as a regular file in the canonical directory", () => {
    expect(fs.lstatSync(skillMd, { throwIfNoEntry: false })?.isFile() ?? false).toBe(true);
  });

  it("is reached from .claude/skills by a relative symlink to the canonical directory", () => {
    const link = path.join(root, ".claude/skills/jack-tdd-workflow");
    const facts = fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()
      ? { target: fs.readlinkSync(link), real: fs.realpathSync(link) }
      : null;
    expect(facts).toEqual({ target: "../../.agents/skills/jack-tdd-workflow", real: fs.realpathSync(skillDir) });
  });

  it("opens with frontmatter that names the skill after its directory and describes it", () => {
    const fields = frontmatter(read(skillMd)) ?? {};
    expect({
      name: fields.name,
      keys: Object.keys(fields).sort(),
      description: (fields.description?.length ?? 0) > 0 && (fields.description?.length ?? 0) <= 1024,
    }).toEqual({ name: path.basename(skillDir), keys: ["description", "name"], description: true });
  });
});

describe("T567 jack-tdd-workflow method text", () => {
  it("points at rule 10 for the receipt CLI", () => {
    const text = read(skillMd);
    expect(["node scripts/tdd/red-receipt.mjs", ".claude/rules/10-tdd.md"].filter((token) => !text.includes(token))).toEqual([]);
  });

  it("names its matrix template, which exists as a file of the skill", () => {
    const named = read(skillMd).includes("references/matrix-template.md");
    const present = fs.lstatSync(path.join(skillDir, "references/matrix-template.md"), { throwIfNoEntry: false })?.isFile() ?? false;
    expect({ named, present }).toEqual({ named: true, present: true });
  });

  it("gives the template every case class, an assertion and a test file column, and an effect-not-boolean assertion", () => {
    const template = read(path.join(skillDir, "references/matrix-template.md"));
    const header = template.split("\n").find((line) => line.startsWith("|") && /assertion/i.test(line)) ?? "";
    expect({
      classes: missing(template, caseClasses),
      columns: missing(header, ["assertion", "test file"]),
      effect: missing(template, ["document, state or IPC effect", "not a bare boolean"]),
    }).toEqual({ classes: [], columns: [], effect: [] });
  });

  it("tells the implementor which case classes a matrix covers and what a case asserts", () => {
    expect(missing(read(skillMd), [...caseClasses, "document, state or IPC effect", "test file"])).toEqual([]);
  });

  it("names the attack prompt at its current path, which exists", () => {
    const prompt = ".agents/skills/mdpro-delegator/references/templates/matrix-attack-prompt.md";
    expect({ named: read(skillMd).includes(prompt), present: fs.existsSync(path.join(root, prompt)) }).toEqual({ named: true, present: true });
  });

  it("says who attacks the matrix on each runtime and what the attacker is given", () => {
    expect(missing(read(skillMd), [
      "fresh", "never a fork", "resumed", "Opus subagent", "default effort", "codex exec",
      "only the attack prompt, the brief and the matrix",
    ])).toEqual([]);
  });

  it("bounds the attack, demands a counter-proof for a rejected gap, and stops for the delegator", () => {
    const text = read(skillMd);
    expect({
      tokens: missing(text, ["once per grant", "at most one re-attack", "NEEDS RULING", "ATTACK-NOT-RUN", "verbatim"]),
      counterProof: sameParagraph(text, ["counter-proof", "Out of scope"]),
      stillOpen: sameParagraph(text, ["still open after the re-attack", "delegator"]),
    }).toEqual({ tokens: [], counterProof: true, stillOpen: true });
  });

  it("lets the acceptance check go RED first as <ID>-ACC and be verified when the last cycle settles", () => {
    expect(sameParagraph(read(skillMd), ["<ID>-ACC", "before the first cycle", "`verify`", "last cycle settles"])).toBe(true);
  });

  it("orders a cycle as RED receipt <ID>-S<n>, minimal change, verify, then refactor, with no refactor before verify", () => {
    const cycle = paragraphs(read(skillMd)).find((paragraph) =>
      sameParagraph(paragraph, ["<ID>-S<n>", "minimal change", "`verify`", "refactor"])) ?? "";
    const beforeVerify = cycle.slice(cycle.indexOf("<ID>-S<n>"), cycle.indexOf("`verify`"));
    expect({ found: cycle.length > 0, refactorBeforeVerify: /refactor/i.test(beforeVerify) }).toEqual({ found: true, refactorBeforeVerify: false });
  });

  it("allows one intended assertion and one --test file per record, never a batch, replacing all REDs first", () => {
    expect(missing(read(skillMd), ["one intended assertion", "one `--test` file", "never recorded as a batch", "all REDs first"])).toEqual([]);
  });

  it("checks a test runs to its assertion before its RED, counts a one-test fix as one cycle, and sends a big refactor out as a prefactor", () => {
    const text = read(skillMd);
    expect({
      runsToAssertion: text.includes("runs to its assertion"),
      fixRound: sameParagraph(text, ["one-test fix round", "one cycle"]),
      prefactor: sameParagraph(text, ["refactor too big for one cycle", "delegator", "prefactor"]),
    }).toEqual({ runsToAssertion: true, fixRound: true, prefactor: true });
  });

  it("splits matrix amendments: a case inside a seam and AC needs no re-attack, a new seam or meaning stops for the delegator", () => {
    const text = read(skillMd);
    expect({
      noReattack: /added in cycle n[^.\n]{0,60}(needs no re-attack|without a new attack)/i.test(text),
      reversed: /added in cycle n[^.\n]{0,60}\b(needs|requires) a (new )?re-?attack/i.test(text),
      stops: sameParagraph(text, ["new seam", "changed behaviour", "what an AC means", "delegator"], ["added in cycle n"]),
    }).toEqual({ noReattack: true, reversed: false, stops: true });
  });

  it("names raw-green tests in the handoff and gives the recorded-line correction route without a rule-25 command", () => {
    const text = read(skillMd);
    expect({
      rawGreen: sameParagraph(text, ["raw-green", "handoff"]),
      route: sameParagraph(text, ["by edit", "correct the line", "suffixed", "re-apply", "`verify`", "old receipt", "rule-25"]),
    }).toEqual({ rawGreen: true, route: true });
  });

  it("runs /code-review on the committed candidate, /diagnosing-bugs before a D item's first RED, and ends with the handoff table", () => {
    const text = read(skillMd);
    expect({
      review: sameParagraph(text, ["/code-review", "committed candidate"]),
      diagnose: sameParagraph(text, ["/diagnosing-bugs", "before the first RED"]),
      handoff: missing(text, ["AC | evidence | verdict", "tree SHAs", "paths changed", "rejected"]),
    }).toEqual({ review: true, diagnose: true, handoff: [] });
  });

  it("uses the GLOSSARY's four TDD terms and points at GLOSSARY.md", () => {
    const text = read(skillMd);
    expect(["Test matrix", "Matrix attack", "RED receipt", "Cycle", "GLOSSARY.md"].filter((term) => !text.includes(term))).toEqual([]);
  });

  it("states one method for both the Claude and the Codex runtime", () => {
    expect(sameParagraph(read(skillMd), ["one method", "Claude", "Codex"])).toBe(true);
  });

  it("cites its primary sources and Matt Pocock's tdd, code-review and diagnosing-bugs", () => {
    const sources = paragraphs(read(skillMd)).filter((paragraph) => paragraph.includes("mattpocock-skills")).join("\n\n");
    expect(missing(sources, [
      "https://newsletter.kentbeck.com/p/canon-tdd",
      "https://google.github.io/eng-practices/review/developer/small-cls.html",
      "https://martinfowler.com/bliki/ParallelChange.html",
      "`tdd`", "`code-review`", "`diagnosing-bugs`", "1.3.1",
    ])).toEqual([]);
  });
});

describe("T567 jack-tdd-workflow size and shape", () => {
  it("keeps SKILL.md within 300 lines and 24 KiB", () => {
    const text = read(skillMd);
    expect({ lines: lineCount(text) <= MAX_SKILL_LINES, bytes: Buffer.byteLength(text, "utf8") <= MAX_SKILL_BYTES }).toEqual({ lines: true, bytes: true });
  });

  it("states its contract in sentences, not as a keyword list", () => {
    const text = read(skillMd);
    const crowdedLines = text.split("\n").filter((line) => tokensIn(line) >= 8);
    const listParagraphs = paragraphs(text).filter((paragraph) => bareTokenLines(paragraph).length >= 8);
    expect({ crowdedLines, listParagraphs }).toEqual({ crowdedLines: [], listParagraphs: [] });
  });
});

describe("T567 jack-tdd-workflow references it must not carry", () => {
  it("copies no receipt command from rule 10 into any skill file", () => {
    expect(matchesIn(skillDir, copiedReceiptCommands)).toEqual([]);
  });

  it("routes no runtime to the tdd-guardian plugin or mdpro-spec-adversary from any skill file", () => {
    expect(matchesIn(skillDir, pluginRoutes)).toEqual([]);
  });

  it("tells the reader to run no rule-25 command", () => {
    expect(matchesIn(skillDir, ruleTwentyFiveCommands)).toEqual([]);
  });
});

describe("T567 test helpers", () => {
  it("walks into references/ when it scans a skill directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t567-walk-"));
    try {
      fs.mkdirSync(path.join(dir, "references"));
      fs.writeFileSync(path.join(dir, "references/x.md"), "run tdd-guardian:x\n");
      expect(matchesIn(dir, pluginRoutes)).toEqual([`${path.join("references", "x.md")} /tdd-guardian:/`]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads no frontmatter name from an unfenced, unclosed or body-only name", () => {
    expect([
      frontmatter("name: jack-tdd-workflow\n"),
      frontmatter("---\nname: jack-tdd-workflow\n"),
      frontmatter("---\ndescription: x\n---\nname: jack-tdd-workflow\n")?.name,
    ]).toEqual([null, null, undefined]);
  });

  it("finds tokens only in order, inside one paragraph, and honours the exclusion", () => {
    expect([
      sameParagraph("alpha beta\ngamma", ["alpha", "gamma"]),
      sameParagraph("alpha\n\ngamma", ["alpha", "gamma"]),
      sameParagraph("alpha\n  \t\ngamma", ["alpha", "gamma"]),
      sameParagraph("gamma alpha", ["alpha", "gamma"]),
      sameParagraph("alpha gamma delta", ["alpha", "gamma"], ["delta"]),
      sameParagraph("Alpha GAMMA", ["alpha", "gamma"]),
    ]).toEqual([true, false, false, false, false, true]);
  });

  it("counts lines and UTF-8 bytes at the cap's edges", () => {
    expect([
      withinCap(Array(301).fill("a").join("\n")),
      withinCap("a\n".repeat(300)),
      withinCap("a".repeat(MAX_SKILL_BYTES + 1)),
      withinCap("测".repeat(8193)),
      withinCap("测".repeat(8192)),
    ]).toEqual([false, true, false, false, true]);
  });

  it("flags a keyword dump, one token per line, as a list paragraph", () => {
    const dump = contractTokens.slice(0, 8).map((token) => `- ${token}`).join("\n");
    expect([bareTokenLines(dump).length, tokensIn(contractTokens.join(" ")) >= 8]).toEqual([8, true]);
  });
});
