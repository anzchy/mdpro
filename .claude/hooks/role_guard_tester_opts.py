# Purpose: option tables and the argument parser for the real-device-tester allowlist
# (role_guard_tester.py, D186).
# - LONG: every long option of the subcommands whose read-only forms are allowed, names
#   without `--`, from `git <sub> --git-completion-helper-all` (git 2.50.1, hidden options
#   included; legacy `git config` from `git config --local -h`). branch and symbolic-ref
#   reuse role_guard_opts.LONG.
# - parse(): git parse-options over one call's args: any unambiguous long prefix spelled
#   out (exact name wins); an option's value is consumed as a value, never read as an
#   option (audit b93 H1: `branch --format --list x` creates x). VALUE options take the
#   next word; NEXT_IF_ANY options (git's LASTARG_DEFAULT: --contains, --merged, …) take it
#   only when it does not start with `-`, which can only add refusals since those
#   options force list mode. An ambiguous prefix with a WRITE candidate is reported.
# - WRITE / WRITE_SHORT: options that make the call change state wherever they appear.
# - DENIED / DENIED_SHORT (H3): options of allowed subcommands that write files or run
#   programs, checked on every word of every allowed call, values included (may only
#   over-refuse); a word is denied when it is a prefix of a denied name, so abbreviations
#   are caught without a full table, except the real options in EXACT_OK. Derived from
#   `--git-completion-helper-all` and the git-diff / git-log man pages (git 2.50.1).
# - env_denied(), GLOBAL_OK (H2): environment names and git global options the tester may
#   not use; `-c` / `--config-env` and GIT_CONFIG_* are always refused.
# Imported by role_guard_tester.py; a missing or broken copy refuses every tester Bash
# call (fail closed). Regression tests: tests/d186-*.test.ts.
from role_guard_opts import LONG as IMPL_LONG

def _t(names):
    return frozenset(names.split())

LONG = {
    "branch": IMPL_LONG["branch"],
    "symbolic-ref": IMPL_LONG["symbolic-ref"],
    "config": _t("""
    add blob bool bool-or-int bool-or-str comment default edit expiry-date file fixed-value get get-all
    get-color get-colorbool get-regexp get-urlmatch global includes int list local name-only no-blob
    no-comment no-default no-file no-fixed-value no-global no-includes no-local no-name-only no-null
    no-show-names no-show-origin no-show-scope no-system no-type no-worktree null path remove-section
    rename-section replace-all show-names show-origin show-scope system type unset unset-all worktree"""),
    "tag": _t("""
    annotate cleanup color column contains create-reflog delete edit file force format ignore-case list
    local-user merged message no-annotate no-cleanup no-color no-column no-contains no-create-reflog
    no-edit no-file no-force no-format no-ignore-case no-local-user no-merged no-omit-empty
    no-points-at no-sign no-sort omit-empty points-at sign sort trailer verify with without"""),
    "remote": _t("verbose no-verbose"),
    "notes": _t("ref no-ref"),
}

WRITE = {
    "branch": _t("""delete move copy force set-upstream-to set-upstream unset-upstream edit-description
                 track no-track create-reflog recurse-submodules"""),
    "config": _t("add unset unset-all replace-all rename-section remove-section edit"),
    "tag": _t("delete annotate message file trailer edit sign cleanup local-user force create-reflog"),
}
WRITE_SHORT = {"branch": "dDmMcCfut", "config": "e", "tag": "daFmesuf"}

VALUE = {
    "branch": _t("sort format points-at set-upstream-to"),
    "tag": _t("sort format points-at message file trailer cleanup local-user"),
    "config": _t("file blob type default comment"),
    "notes": _t("ref"),
}
NEXT_IF_ANY = {sub: _t("contains no-contains merged no-merged with without") for sub in ("branch", "tag")}
VALUE_SHORT = {"branch": "u", "tag": "mFu", "config": "ft", "symbolic-ref": "m"}

def parse(sub, args):
    """([(kind, name, value, word)], ambiguous): kind is "long" (name spelled out), "short" (one
    letter) or "pos", word is the arg as written; every word after `--` is "pos".
    ambiguous = (word, candidates) or None."""
    table, write = LONG.get(sub, frozenset()), WRITE.get(sub, frozenset())
    value, nxt, vshort = VALUE.get(sub, frozenset()), NEXT_IF_ANY.get(sub, frozenset()), VALUE_SHORT.get(sub, "")
    items, i = [], 0
    while i < len(args):
        a = args[i]
        i += 1
        if a == "--":
            return items + [("pos", w, None, w) for w in args[i:]], None
        if a.startswith("--"):
            name, eq, val = a[2:].partition("=")
            if table and name not in table:
                cands = sorted(o for o in table if o.startswith(name))
                if len(cands) == 1:
                    name = cands[0]
                elif write.intersection(cands):
                    return items, (a, cands)
            if not eq and i < len(args) and (name in value or (name in nxt and not args[i].startswith("-"))):
                eq, val = "=", args[i]
                i += 1
            items.append(("long", name, val if eq else None, a))
        elif len(a) > 1 and a[0] == "-":
            for k, ch in enumerate(a[1:], 2):
                if ch in vshort:
                    v = a[k:]
                    if not v and i < len(args):
                        v, i = args[i], i + 1
                    items.append(("short", ch, v, a))
                    break
                items.append(("short", ch, None, a))
        else:
            items.append(("pos", a, None, a))
    return items, None

def write_item(sub, items):
    """The word that sets a write option (as written, a short cluster whole), else None."""
    for kind, name, _, word in items:
        if (kind == "long" and name in WRITE.get(sub, ())) or (kind == "short" and name in WRITE_SHORT.get(sub, "")):
            return f"--{name}" if kind == "long" else word
    return None

def flag(items, on, off=(), short=""):
    """True when the last of `--on` / `--off` / `-short` turns the option on (git: last one wins)."""
    state = False
    for kind, name, *_ in items:
        if (kind == "long" and name in on) or (kind == "short" and name == short and short):
            state = True
        elif kind == "long" and name in off:
            state = False
    return state

def has(items, longs=(), shorts=""):
    return any((k == "long" and n in longs) or (k == "short" and n in shorts) for k, n, *_ in items)

def words(items):
    return [n for k, n, *_ in items if k == "pos"]

# ---- H3: options that write files or run programs ---------------------------

COMMON_DENIED = _t("output ext-diff textconv exec upload-pack receive-pack")
DENIED = {"grep": _t("open-files-in-pager ext-grep"), "cat-file": _t("filters"), "help": _t("web info")}
DENIED_SHORT = {"grep": "O", "help": "wi"}
EXACT_OK = _t("text filter")

def denied_word(sub, args):
    """The first word naming an option that writes a file or runs a program, else None."""
    names, letters = COMMON_DENIED | DENIED.get(sub, frozenset()), DENIED_SHORT.get(sub, "")
    for a in args:
        if a == "--":
            return None
        if a.startswith("--"):
            name = a[2:].partition("=")[0]
            if name and name not in EXACT_OK and any(d.startswith(name) for d in names):
                return a
        elif a.startswith("-") and set(a[1:]) & set(letters):
            return a
    return None

# ---- H2: global options and environment -------------------------------------

GLOBAL_OK = _t("""-C --git-dir --work-tree --namespace --attr-source -p --paginate -P --no-pager
               --no-replace-objects --no-lazy-fetch --no-optional-locks --no-advice --bare --literal-pathspecs
               --glob-pathspecs --noglob-pathspecs --icase-pathspecs --version -v --help -h --exec-path
               --html-path --man-path --info-path --list-cmds""")
ENV_OK = _t("GIT_DIR GIT_WORK_TREE GIT_OPTIONAL_LOCKS")
SAFE_PAGERS = {"", "cat", "less", "more"}
ENV_DENIED = _t("PAGER EDITOR VISUAL LESS LESSOPEN LESSCLOSE MANPAGER MANOPT BROWSER SSH_ASKPASS")

def global_denied(word):
    """True for a global option the tester may not pass: `-c`, `--config-env`, `--exec-path=DIR`, unknown."""
    name, eq, _ = word.partition("=")
    return name not in GLOBAL_OK or (name == "--exec-path" and bool(eq))

def env_denied(name, value):
    """True for a variable that points git at programs, config or another store (GIT_DIR /
    GIT_WORK_TREE / GIT_OPTIONAL_LOCKS pass; GIT_PAGER / PAGER only as cat, less or more)."""
    if name in ("GIT_PAGER", "PAGER"):
        return value.strip() not in SAFE_PAGERS
    return (name.startswith("GIT_") and name not in ENV_OK) or name in ENV_DENIED
