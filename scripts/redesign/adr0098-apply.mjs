// ADR-0098 phase 1 applier. Run inside a checkout at the manifest's baseline.
//
//   node scripts/redesign/adr0098-apply.mjs apply    <repo> <manifest>   git mv + AST-positioned rewrites
//   node scripts/redesign/adr0098-apply.mjs check    <repo> <manifest>   every reference in a moved file reaches
//                                                          the same target it reached at the baseline, and
//                                                          every byte outside the reference literals is the
//                                                          baseline's. Run right after apply, before prose.
//   node scripts/redesign/adr0098-apply.mjs check    <repo> <manifest> --refs-only
//                                                          the target half only. Run after prose and the hand
//                                                          edits, which change comments on purpose (rev5 N1);
//                                                          the bytes they change are covered by the rebuild
//                                                          comparison in ADR-0098 step 7, not here
//   node scripts/redesign/adr0098-apply.mjs prose    <repo> <manifest>   replace whole-token old paths with new ones in
//                                                          every non-history file (comments, docs, configs);
//                                                          its diff is reviewed by hand
//   node scripts/redesign/adr0098-apply.mjs residual <repo> <manifest>   no old path left outside the history allowlist
//   node scripts/redesign/adr0098-apply.mjs tree     <repo> <manifest> [--expect <path>]...
//                                                          stage every change (`git add -A`: rewrites, moves,
//                                                          additions, deletions); refuse if anything is still
//                                                          unstaged or untracked, a destination or an expected
//                                                          path is not in the index, or a source still is;
//                                                          print the index tree. A bad flag or a dangling
//                                                          --expect exits 2 before anything is staged
//                                                          (rev7 N6.2); names are read with -z (rev7 N6.1).
//                                                          apply, prose and `git apply` write the working tree
//                                                          only, so a bare `git write-tree` would read a stale
//                                                          index (rev6 P5.1)
//
// Only two reference kinds are rewritten, both found by TypeScript's parser (never by text search):
// relative module specifiers, and the relative string arguments of a path.* / new URL call that
// combines them with the file's own directory (`__dirname`, `import.meta.url`, or a const holding
// it, like `HERE`). Literal contents (fixture source text), comments and repo-root-relative strings
// are never touched.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const [mode, root, manifestPath, ...flags] = process.argv.slice(2);
const refsOnly = flags.includes("--refs-only");
const require = createRequire(`${root}/package.json`);
const ts = require("typescript");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const P = path.posix;
const git = (...a) => execFileSync("git", a, { cwd: root }).toString("utf8");
const MOCKS = new Set(["mock", "doMock", "unmock", "doUnmock", "importActual", "importMock"]);
const EXTS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".json", "/index.ts", "/index.tsx"];
const fromTo = new Map(manifest.moves.map((m) => [m.from, m.to]));
const toFrom = new Map(manifest.moves.map((m) => [m.to, m.from]));

const relLit = (a) => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && /^\.\.?(\/|$)/.test(a.text);
const segLit = (a) => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && !a.text.startsWith("/");

/** Directory anchors: the file's own directory, by expression or by a const that holds it. */
function isDirExpr(n, names) {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
  if (ts.isIdentifier(n)) return n.text === "__dirname" || names.has(n.text);
  if (ts.isPropertyAccessExpression(n) && ts.isMetaProperty(n.expression)) return ["url", "dirname"].includes(n.name.text);
  if (ts.isCallExpression(n)) {
    // path.dirname(fileURLToPath(import.meta.url)), fileURLToPath(new URL(".", import.meta.url)) …
    const c = n.expression;
    const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
    return ["dirname", "fileURLToPath"].includes(name) && n.arguments.length === 1 && isDirExpr(n.arguments[0], names);
  }
  return false;
}

/** All references in one source text, with their positions and the target each resolves to. */
function references(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const dir = P.dirname(file);
  const names = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    const v = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && !names.has(n.name.text) && isDirExpr(n.initializer, names)) {
        names.add(n.name.text);
        grew = true;
      }
      ts.forEachChild(n, v);
    };
    v(sf);
  }
  const refs = [];
  const visit = (n) => {
    let spec = null;
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && relLit(n.moduleSpecifier)) spec = n.moduleSpecifier;
    else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && relLit(n.argument.literal)) spec = n.argument.literal;
    else if (ts.isCallExpression(n)) {
      const c = n.expression;
      const a0 = n.arguments[0];
      const isImport = c.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(c) && c.text === "require";
      const isMock = ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "vi" && MOCKS.has(c.name.text);
      if ((isImport || isRequire || isMock) && a0 && relLit(a0)) spec = a0;
    }
    if (spec) refs.push({ kind: "module", line: sf.getLineAndCharacterOfPosition(spec.getStart(sf)).line + 1, lits: [spec], rel: spec.text, target: P.normalize(P.join(dir, spec.text)) });
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && !spec) {
      const args = n.arguments ?? [];
      const isUrl = ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "URL";
      let lits = null;
      if (isUrl && args.length === 2 && relLit(args[0]) && isDirExpr(args[1], names)) lits = [args[0]];
      else {
        const i = args.findIndex((a) => isDirExpr(a, names));
        if (i >= 0 && args[i + 1] && relLit(args[i + 1])) {
          lits = [];
          for (let j = i + 1; j < args.length && segLit(args[j]); j++) lits.push(args[j]);
        }
      }
      if (lits) {
        const rel = lits.map((l) => l.text).join("/");
        refs.push({ kind: "anchor", line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, lits, rel, target: P.normalize(P.join(dir, rel)) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { sf, refs };
}

/** Where a baseline target lives after the move (a moved file, or an extension-less spec of one). */
function mapTarget(t) {
  for (const ext of EXTS) {
    if (fromTo.has(t + ext)) {
      const to = fromTo.get(t + ext);
      return ext && to.endsWith(ext) ? to.slice(0, -ext.length) : to;
    }
  }
  return t;
}

function relFrom(dir, target, keepDotSlash) {
  let r = P.relative(dir, target) || ".";
  if (!r.startsWith(".")) r = (keepDotSlash ? "./" : "./") + r;
  return r;
}

function newText(ref, newDir, quote) {
  const r = relFrom(newDir, mapTarget(ref.target), true);
  const q = (s) => quote + s + quote;
  if (ref.lits.length === 1) return [q(ref.rel.endsWith("/") && !r.endsWith("/") ? r + "/" : r)];
  // Split segments: keep the split, one literal per segment.
  return [r.split("/").map(q).join(", ")];
}

/** The text with every reference literal span cut out: what must not change. */
function skeleton(text, file) {
  const { sf, refs } = references(file, text);
  const spans = refs.map((r) => [r.lits[0].getStart(sf), r.lits[r.lits.length - 1].getEnd()]).sort((a, b) => a[0] - b[0]);
  const parts = [];
  let at = 0;
  for (const [a, b] of spans) {
    parts.push(text.slice(at, a));
    at = b;
  }
  parts.push(text.slice(at));
  return parts;
}

if (mode === "apply") {
  // Refuse before touching anything: two moves to one place, or a destination that exists.
  const dests = manifest.moves.map((m) => m.to);
  const dup = dests.filter((d, i) => dests.indexOf(d) !== i);
  const taken = dests.filter((d) => fs.existsSync(P.join(root, d)));
  const missing = manifest.moves.filter((m) => !fs.existsSync(P.join(root, m.from))).map((m) => m.from);
  if (dup.length || taken.length || missing.length) {
    console.error(JSON.stringify({ collision: dup, exists: taken, missing }));
    process.exit(3);
  }
  const edits = {};
  for (const m of manifest.moves) {
    const text = fs.readFileSync(P.join(root, m.from), "utf8");
    const { sf, refs } = references(m.from, text);
    const newDir = P.dirname(m.to);
    let out = text;
    // Apply right to left so positions stay valid.
    const spans = refs
      .map((ref) => {
        const first = ref.lits[0];
        const last = ref.lits[ref.lits.length - 1];
        const quote = text[first.getStart(sf)];
        return { start: first.getStart(sf), end: last.getEnd(), text: newText(ref, newDir, quote)[0], ref };
      })
      .sort((a, b) => b.start - a.start);
    for (const s of spans) out = out.slice(0, s.start) + s.text + out.slice(s.end);
    edits[m.from] = spans.filter((s) => text.slice(s.start, s.end) !== s.text).length;
    fs.mkdirSync(P.join(root, newDir), { recursive: true });
    git("mv", m.from, m.to);
    fs.writeFileSync(P.join(root, m.to), out);
  }
  const n = Object.values(edits).reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ moved: manifest.moves.length, rewritten: n, files: Object.values(edits).filter(Boolean).length }));
} else if (mode === "check") {
  const exists = (t) => EXTS.some((e) => fs.existsSync(P.join(root, t + e)));
  const problems = [];
  let count = 0;
  for (const m of manifest.moves) {
    const oldText = execFileSync("git", ["show", `${manifest.baseline}:${m.from}`], { cwd: root }).toString("utf8");
    const newText = fs.readFileSync(P.join(root, m.to), "utf8");
    const before = references(m.from, oldText).refs;
    const after = references(m.to, newText).refs;
    // Every byte outside the reference literals is unchanged (fixture strings, comments, code).
    if (!refsOnly && JSON.stringify(skeleton(oldText, m.from)) !== JSON.stringify(skeleton(newText, m.to))) {
      problems.push(`${m.to}: bytes changed outside the reference literals`);
    }
    if (before.length !== after.length) problems.push(`${m.to}: ${before.length} references before, ${after.length} after`);
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      count++;
      const want = mapTarget(before[i].target);
      if (after[i].target !== want) problems.push(`${m.to}:${after[i].line} reaches ${after[i].target}, expected ${want}`);
      else if (!exists(after[i].target)) problems.push(`${m.to}:${after[i].line} reaches ${after[i].target}, which does not exist`);
    }
  }
  console.log(JSON.stringify({ references: count, problems }, null, 1));
  if (problems.length) process.exit(1);
} else if (mode === "residual" || mode === "prose") {
  // History that keeps old paths on purpose (ADR-0098, "Residual-reference check").
  // Files that keep old paths on purpose, each named with its reason (R3.4). Everything else,
  // whatever its date, is a current instruction and must be updated. A new file that cites an
  // old path fails the check until it is updated or added here with a reason.
  const HISTORY = {
    "docs/reference/adr-0098-test-move-map.json": "the manifest: old → new is its content",
    "scripts/redesign/adr0098-manifest.py": "generator: EXCLUDED / OVERRIDES keys name baseline paths",
    "scripts/redesign/adr0098-apply.mjs": "applier: this history list",
    ".claude/tdd-guardian/receipts.json": "receipt records; the landing verifier keeps parent records verbatim",
    ".claude/tdd-guardian/state.json": "tdd-guardian tool state, not a reference (untracked by D215)",
    "docs/adr/0076-verify-release-gains-a-rehearsal-only-check-mode.md": "accepted ADR body is immutable",
    "docs/adr/0098-launcher-tooling-and-perf-tests-move-into-their-own-folders-under-tests.md":
      "this ADR: accepted before the move, so its body (the override in § Membership, the Context counts) keeps baseline paths; the manifest bridges them (rev5 N5)",
    "docs/test/20261012-launcher-cli-32efba1-device-check.md": "record of a past device run",
    "docs/reference/20261012-d167-receipt-lines.json": "snapshot of receipt evidence",
    "docs/plans/20260912-frontend-backend-sequencing-order.md": "evidence in closed rows only; an open row is updated (checked separately)",
    "docs/plans/20260911-ui-redesign/stage-4c-foundation.md": "delivered stage; the cites are its acceptance evidence",
    "docs/plans/20261012-plan-branch-consolidation-after-031.md": "plan A text kept as history by its own status line (ADR-0083 took B)",
    "docs/feature-ledger.html": "generated: edit the .md, then `pnpm ledger:build`",
    "docs/adr/0087-device-check-hook-events-are-spooled-on-the-mini-and-replayed-in-sequence.md": "accepted ADR body is immutable",
    "docs/test/20261014-d177-step3-receiver-down-replay-device-check.md": "record of a past device run",
    "docs/plans/20260918-assessment-continue-vs-rewrite.md": "dated assessment of HEAD e030a2c",
  };
  const ALLOW = Object.keys(HISTORY).map((f) => new RegExp("^" + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
  // An old path counts only as a whole token: not preceded by a path character, so the new
  // `tests/perf/d12Heap.ts` is not a hit for the old `perf/d12Heap.ts`.
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const froms = [...fromTo.keys()].sort((a, b) => b.length - a.length);
  const token = new RegExp(`(?<![\\w./-])(${froms.map(esc).join("|")})(?![\\w-])`, "g");
  // A glob citation (`tests/d180-role-guard-*.test.ts`) is stale when a moved file matched it
  // at the baseline and its new path no longer does. Recursive globs (`tests/**`) usually still
  // match. A stale glob is rewritten only when every file it matched moved to one folder.
  const globTok = /(?<![\w./-])((?:tests|perf)\/[\w.*\/-]*\*[\w.*\/-]*)/g;
  const globRe = (g) =>
    new RegExp("^" + g.split(/(\*\*\/?|\*)/).map((x) => (x.startsWith("**") ? ".*" : x === "*" ? "[^/]*" : esc(x))).join("") + "$");
  const globFix = (raw) => {
    const g = raw.replace(/\.+$/, ""); // a sentence's full stop is not part of the glob
    const re = globRe(g);
    const stale = [...fromTo].filter(([f, t]) => re.test(f) && !re.test(t));
    if (!stale.length) return null;
    const hit = TREE_FILES.filter((f) => re.test(f));
    const dirs = new Set(stale.map(([, t]) => P.dirname(t)));
    if (stale.length !== hit.length || dirs.size !== 1 || g.includes("**") || P.dirname(g) !== P.dirname(stale[0][0])) return { g, ambiguous: true };
    return { g, to: P.join([...dirs][0], P.basename(g)) };
  };
  const TREE_FILES = git("ls-tree", "-r", "--name-only", manifest.baseline).split("\n").filter(Boolean);
  const files = git("ls-files", "--cached", "--others", "--exclude-standard").split("\n").filter(Boolean);
  const hits = [];
  const changed = [];
  for (const file of files) {
    if (ALLOW.some((re) => re.test(file)) || !fs.existsSync(P.join(root, file))) continue;
    const buf = fs.readFileSync(P.join(root, file));
    if (buf.includes(0)) continue; // binary
    let text = buf.toString("utf8");
    const globs = [...new Set([...text.matchAll(globTok)].map((m) => m[1]))].map(globFix).filter(Boolean);
    for (const g of globs) {
      if (g.ambiguous || mode === "residual") hits.push(`${file}: glob ${g.g}${g.ambiguous ? " (matches files in several places; edit by hand)" : ""}`);
      else text = text.split(g.g).join(g.to);
    }
    if (mode === "prose" && globs.some((g) => !g.ambiguous)) {
      fs.writeFileSync(P.join(root, file), text);
      changed.push(file);
    }
    if (!token.test(text)) continue;
    token.lastIndex = 0;
    if (mode === "prose") {
      fs.writeFileSync(P.join(root, file), text.replace(token, (m) => fromTo.get(m)));
      changed.push(file);
    } else {
      text.split("\n").forEach((l, i) => {
        token.lastIndex = 0;
        if (token.test(l)) hits.push(`${file}:${i + 1}: ${l.trim().slice(0, 160)}`);
      });
    }
    token.lastIndex = 0;
  }
  console.log(JSON.stringify(mode === "prose" ? { changed: [...new Set(changed)], hits } : { hits }, null, 1));
  if (hits.length) process.exit(1);
} else if (mode === "tree") {
  // Parse every flag before touching the index: a dangling --expect or an unknown flag would
  // otherwise drop an assertion and still print a tree (rev7 N6.2).
  const expected = [];
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--expect" && i + 1 < flags.length && !flags[i + 1].startsWith("--")) expected.push(flags[++i]);
    else {
      console.error(`tree: bad argument ${JSON.stringify(flags[i])}; usage: tree <repo> <manifest> [--expect <path>]...`);
      process.exit(2);
    }
  }
  // -z everywhere: without it Git C-quotes names with quotes, backslashes or control bytes, and a
  // quoted name never equals the raw manifest path (rev7 N6.1).
  const names = (...a) => git(...a, "-z").split("\0").filter(Boolean);
  git("add", "-A");
  const unstaged = names("diff", "--name-only");
  const untracked = names("ls-files", "--others", "--exclude-standard");
  // An ignored file is neither staged nor untracked, so name the paths that must be in the tree:
  // every destination, no source, and each `--expect <path>` (the manifest and the copied files).
  const tracked = new Set(names("ls-files"));
  const missing = [...manifest.moves.map((m) => m.to), ...expected].filter((p) => !tracked.has(p));
  const leftover = manifest.moves.map((m) => m.from).filter((p) => tracked.has(p));
  if (unstaged.length || untracked.length || missing.length || leftover.length) {
    console.error(JSON.stringify({ unstaged, untracked, missing, leftover }));
    process.exit(4);
  }
  console.log(git("write-tree").trim());
} else {
  console.error("mode: apply | check [--refs-only] | prose | residual | tree");
  process.exit(2);
}
