// D355 fix 5: the file-level, fail-closed rule that no D355 test reads git history. A file is flagged when its import
// closure runs a child process (or imports a git library) and holds a git history verb token anywhere; only an
// allowlist entry whose scope check holds clears it. The rule's own tokens are assembled from pieces, so this file
// is scanned like any other and is not flagged (attack gap 1). Known residuals: a verb built from pieces, and a
// child process reached through a spawned script, are not seen.
import fs from "node:fs";
import path from "node:path";

const P = path.posix;
/** Reads a repo-relative posix path; undefined when the file does not exist. */
export type Read = (rel: string) => string | undefined;
export interface AllowEntry { file: string; reason: string; scope: string; argv?: string[][] }

export const HISTORY_ALLOWLIST: readonly AllowEntry[] = [{
  file: "tests/tooling/codex-land-guard-export.test.ts",
  reason: "S7 compares land-guard's export of HEAD with `git ls-tree -r HEAD` of the checked-out repo; HEAD exists in a depth-1 clone",
  scope: "head",
  argv: [["ls-tree", "-r", "-z", "--name-only", "HEAD"]],
}];

export const fsRead = (root: string): Read => (rel) => {
  const p = path.join(root, rel);
  return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : undefined;
};

const token = (words: string[]) => new RegExp(`(?<![\\w-])(?:${words.join("|")})(?![\\w-])`, "i");
const CHILD = token([["child", "process"].join("_"), ["exe", "ca"].join(""), ["cross", "spawn"].join("-"), ["z", "x"].join("")]);
const GIT_LIBRARY = token([["isomorphic", "git"].join("-"), ["simple", "git"].join("-")]);
/** History-reading or history-moving git verbs; a hyphenated compound (`diff-index`, `cherry-pick`) counts too. */
const VERBS = ["show", "log", "diff", "cat-file", "rev-parse", "rev-list", "merge-base", "ls-tree", "grep", "blame",
  "archive", "reflog", "name-rev", "for-each-ref", "format-patch", "range-diff", "whatchanged", "cherry", "bundle",
  "fetch", "checkout", "restore", "worktree", "read-tree", "shortlog", "annotate", "stash", "with-tree", "reset",
  "switch", "clone", "revert", "merge", "rebase", "notes", "sparse-checkout", "bisect", "filter-branch",
  "fast-export", "pack-objects", "verify-pack", "unpack-objects"];
const VERB = new RegExp(`(?<![\\w-])(?:${VERBS.join("|")})(?:-[a-z]+)*(?![\\w-])`, "gi");
const verbsIn = (text: string) => new Set([...text.matchAll(VERB)].map((m) => m[0].toLowerCase()));

const STATIC = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(["'`])([^"'`]*)\1/g;
const SIDE_EFFECT = /\bimport\s*(["'`])([^"'`]*)\1/g;
const DYNAMIC = /\b(?:import|require)\s*\(\s*([^)]*?)\s*\)/g;
const LITERAL = /^(["'`])([^"'`$]*)\1$/;

function specifiers(file: string, text: string): string[] {
  const out = [...text.matchAll(STATIC), ...text.matchAll(SIDE_EFFECT)].map((m) => m[2]);
  for (const m of text.matchAll(DYNAMIC)) {
    const lit = LITERAL.exec(m[1]);
    if (!lit) throw new Error(`${file}: computed specifier ${m[1]}`);
    out.push(lit[2]);
  }
  return out;
}

function resolve(file: string, spec: string, read: Read): string | undefined {
  if (spec.startsWith("/")) throw new Error(`${file}: absolute specifier ${spec}`);
  if (!spec.startsWith(".")) return undefined; // a package; a child-process or git package is caught by its token
  const base = P.normalize(P.join(P.dirname(file), spec));
  if (base.startsWith("..")) throw new Error(`${file}: ${spec} leaves the repository`);
  const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, `${base}/index.ts`].find((c) => read(c) !== undefined);
  if (!hit) throw new Error(`${file}: cannot resolve ${spec}`);
  return hit;
}

function load(file: string, read: Read): string {
  const text = read(file);
  if (text === undefined) throw new Error(`cannot read ${file}`);
  return text;
}

/** The file and every module it reaches through relative imports, transitively, sorted. Throws on any it cannot follow. */
export function closure(file: string, read: Read): string[] {
  const seen = new Set<string>();
  const walk = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const s of specifiers(f, load(f, read))) { const r = resolve(f, s, read); if (r) walk(r); }
  };
  walk(file);
  return [...seen].sort();
}

/** `<file>: <verbs>` for each file whose closure runs a child process and holds a history verb; `<file>: git library` for a git library. */
export function flagged(files: readonly string[], read: Read): string[] {
  return files.flatMap((f) => {
    const text = closure(f, read).map((c) => load(c, read)).join("\n");
    if (GIT_LIBRARY.test(text)) return [`${f}: git library`];
    const verbs = verbsIn(text);
    return CHILD.test(text) && verbs.size ? [`${f}: ${[...verbs].sort().join(" ")}`] : [];
  });
}

const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const REACHES_ROOT = /__dirname|__filename|import\.meta|process\.cwd|repoRoot|process\.env\.(?:PWD|INIT_CWD)|path\.resolve\(\s*(?:["'`]\.?["'`]\s*)?\)|["'`]\.\.(?:\/[^"'`]*)?["'`]|\.\.\/\.\./;
const REDIRECTS_GIT = /GIT_DIR|GIT_WORK_TREE|--git-dir|--work-tree|["'`]-C["'`]/;
const GIT_PROGRAM = /["'`]git["'`]|["'`]git\s/g;
const OTHER_REVISION = [/(?<![\w-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{4,40}(?![\w-])/i, /HEAD\s*[~^]/, /@\s*[~^{]/, /:\//,
  /\b[A-Z_]*_HEAD\b/, /\brefs\//, /\borigin\//, /\b(?:master|main)\b/, /--(?:all|branches|tags|remotes)\b/, /\w\.\.\.?\w/, /\$\{/];

/** Why `entry` does not clear its file; [] when it does. Scope checks run over the entry's closure within tests/. */
export function allowProblems(entry: AllowEntry, scanned: readonly string[], read: Read): string[] {
  const out: string[] = [];
  const say = (why: string) => out.push(`${entry.file} (${entry.scope}): ${why}`);
  if (!entry.reason.trim()) say("no reason");
  if (entry.scope !== "temp-repo" && entry.scope !== "head") { say("unknown scope"); return out; }
  if (!scanned.includes(entry.file)) say("not a scanned file");
  if (!flagged([entry.file], read).length) { say("clears nothing (the file is not flagged)"); return out; }
  const text = closure(entry.file, read).filter((f) => f.startsWith("tests/")).map((f) => stripComments(load(f, read))).join("\n");
  if (REDIRECTS_GIT.test(text)) say("redirects git to another repository");
  if (entry.scope === "temp-repo") {
    if (!/\bmkdtemp/.test(text)) say("makes no mkdtemp repository");
    if (REACHES_ROOT.test(text)) say("reaches the repository root");
    if ((text.match(/\bcwd\s*:/g) ?? []).length < (text.match(GIT_PROGRAM) ?? []).length) say("a git call has no cwd");
    return out;
  }
  const argv = entry.argv ?? [];
  if (!argv.length) say("pins no argv");
  for (const a of argv) if (!text.includes(`[${a.map((s) => JSON.stringify(s)).join(", ")}]`)) say(`pinned argv missing: ${a.join(" ")}`);
  const pinned = new Set(argv.flatMap((a) => [...verbsIn(a.join(" "))]));
  for (const v of verbsIn(text)) if (!pinned.has(v)) say(`verb outside the pin: ${v}`);
  if (OTHER_REVISION.some((re) => re.test(text))) say("names a revision other than HEAD");
  return out;
}

/** Flagged files no entry clears, then every entry's problems. */
export function historyOffenders(files: readonly string[], read: Read, allow: readonly AllowEntry[] = HISTORY_ALLOWLIST): string[] {
  const problems = allow.map((e) => ({ e, p: allowProblems(e, files, read) }));
  const cleared = new Set(problems.filter((x) => !x.p.length).map((x) => x.e.file));
  return [...flagged(files, read).filter((l) => !cleared.has(l.slice(0, l.indexOf(": ")))), ...problems.flatMap((x) => x.p)];
}
