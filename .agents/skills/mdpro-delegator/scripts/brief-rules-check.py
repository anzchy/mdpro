#!/usr/bin/python3
"""Purpose: refuse a Codex implementor brief whose scope needs rule 22 or 50 but whose field does not name it (GH592).

prompt.sh runs this for verb `brief` to a Codex implementor only. The required rules come from each rule file's
`paths:` frontmatter in the repo this script sits in, never from a copied list; the scope is the brief's backticked
`**May edit:**` tokens; the named rules come from its `**Rules for paths in scope.**` paragraph. Every doubt refuses.
Exit 0 passes; exit 2 prints one `REFUSED:` line per reason on stderr.
"""
import fnmatch
import glob
import os
import re
import sys

RULE_NUMBERS = (22, 50)
FIELD = "**Rules for paths in scope.**"
MAY_EDIT = "**May edit:**"
GLOB_CHARS = set("*?[")
THEIR_TESTS = "tests/** (their tests)"


class Refusal(Exception):
    pass


def repo_root():
    return os.path.realpath(os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "..", ".."))


def rule_globs(root, number):
    """The `paths:` block list of the single `.claude/rules/<number>-*.md`; anything else refuses."""
    matches = glob.glob(os.path.join(root, ".claude", "rules", "%d-*.md" % number))
    if len(matches) != 1:
        raise Refusal("rule %d: expected one .claude/rules/%d-*.md, found %d" % (number, number, len(matches)))
    path = matches[0]
    try:
        with open(path, encoding="utf-8-sig") as handle:
            lines = handle.read().splitlines()
    except (OSError, UnicodeDecodeError) as error:
        raise Refusal("rule %d: cannot read %s (%s)" % (number, path, error))
    if not lines or lines[0] != "---" or "---" not in lines[1:]:
        raise Refusal("rule %d: %s has no frontmatter" % (number, path))
    front = lines[1:lines.index("---", 1)]
    starts = [i for i, line in enumerate(front) if re.match(r"^paths:", line)]
    if len(starts) != 1 or front[starts[0]].strip() != "paths:":
        raise Refusal("rule %d: %s has no block-list paths: frontmatter" % (number, path))
    globs = []
    for line in front[starts[0] + 1:]:
        if not line.startswith((" ", "\t")):
            break
        item = re.match(r"""^\s+-\s+(?:"([^"]+)"|'([^']+)')\s*$""", line)
        if not item:
            raise Refusal("rule %d: %s has an unparseable paths: item: %s" % (number, path, line.strip()))
        globs.append(item.group(1) or item.group(2))
    if not globs:
        raise Refusal("rule %d: %s has an empty paths: list" % (number, path))
    return os.path.splitext(os.path.basename(path))[0], globs


def paragraph(lines, start, column):
    """The text after a marker at `lines[start][column:]`, through its continuation lines."""
    first = lines[start]
    indent = len(first) - len(first.lstrip())
    text = [first[column:]]
    for line in lines[start + 1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            break
        if re.match(r"^\s*[-*+]\s", line) and len(line) - len(line.lstrip()) <= indent:
            break
        text.append(line)
    return "\n".join(text)


def segments_overlap(a, b):
    """True when some path could match both slash-separated globs (`**` spans zero or more segments)."""
    memo = {}

    def segment(x, y):
        x, y = x.lower(), y.lower()
        wild_x, wild_y = bool(GLOB_CHARS & set(x)), bool(GLOB_CHARS & set(y))
        if wild_x and wild_y:
            return True
        if wild_x:
            return fnmatch.fnmatchcase(y, x)
        if wild_y:
            return fnmatch.fnmatchcase(x, y)
        return x == y

    def walk(i, j):
        key = (i, j)
        if key in memo:
            return memo[key]
        if i == len(a):
            result = all(part == "**" for part in b[j:])
        elif j == len(b):
            result = all(part == "**" for part in a[i:])
        elif a[i] == "**":
            result = walk(i + 1, j) or walk(i, j + 1)
        elif b[j] == "**":
            result = walk(i, j + 1) or walk(i + 1, j)
        else:
            result = segment(a[i], b[j]) and walk(i + 1, j + 1)
        memo[key] = result
        return result

    return walk(0, 0)


def scope_pattern(token):
    """A scope token as segments; a folder-like token (trailing slash, or no extension) also covers what is under it."""
    parts = [part for part in token.split("/") if part]
    if token.endswith("/") or "." not in parts[-1]:
        parts.append("**")
    return parts


def check(brief_path, root):
    try:
        with open(brief_path, encoding="utf-8-sig") as handle:
            lines = handle.read().replace("\r\n", "\n").split("\n")
    except (OSError, UnicodeDecodeError) as error:
        raise Refusal("cannot read brief %s (%s)" % (brief_path, error))
    rules = {number: rule_globs(root, number) for number in RULE_NUMBERS}
    fields = [(i, line.index(FIELD)) for i, line in enumerate(lines) if FIELD in line]
    if len(fields) != 1:
        raise Refusal("%s needs exactly one %s field, found %d" % (brief_path, FIELD, len(fields)))
    field = paragraph(lines, fields[0][0], fields[0][1] + len(FIELD))
    scopes = [paragraph(lines, i, line.index(MAY_EDIT) + len(MAY_EDIT)) for i, line in enumerate(lines) if MAY_EDIT in line]
    if not scopes:
        raise Refusal("%s has no %s paragraph" % (brief_path, MAY_EDIT))
    tokens = [token for text in scopes for token in re.findall(r"`([^`]+)`", text)]
    # The template's "<paths>, their tests" grants the tests of those paths (ruling 1, Q6).
    if any(re.search(r"\btheir tests\b", re.sub(r"`[^`]*`", "", text), re.I) for text in scopes):
        tokens.append(THEIR_TESTS)
    if not tokens:
        raise Refusal("%s: its %s paragraph names no backticked path" % (brief_path, MAY_EDIT))
    missing = []
    for number, (stem, globs) in sorted(rules.items()):
        needed = [t for t in tokens if any(segments_overlap(scope_pattern(t.split(" ")[0]), g.split("/")) for g in globs)]
        named = re.search(r"\brule\s+%d\b" % number, field, re.I)
        if needed and not named:
            missing.append("REFUSED: %s needs rule %d (.claude/rules/%s.md) in its %s field, for %s"
                           % (brief_path, number, stem, FIELD, ", ".join(needed)))
    return missing


def main(argv):
    if len(argv) != 2:
        print("REFUSED: usage: brief-rules-check.py <brief>", file=sys.stderr)
        return 2
    try:
        missing = check(argv[1], repo_root())
    except Refusal as refusal:
        print("REFUSED: %s" % refusal, file=sys.stderr)
        return 2
    for line in missing:
        print(line, file=sys.stderr)
    return 2 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
