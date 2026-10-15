# Purpose: git option handling for the rule 70 role guard (D184), used by
# role_guard_refs.py. Three jobs:
# - normalize(): git's parse-options takes any unambiguous prefix of a subcommand's
#   long option (`git branch --forc` is `--force`), an exact name winning over a
#   longer one (`switch --force` is not `--force-create`). Prefixes are expanded
#   against LONG, the full table per subcommand; a prefix matching several names is
#   reported when any of them is in WATCHED (git rejects it anyway, so refusing it
#   costs nothing) and left alone otherwise.
# - rebase_update_refs(): whether `rebase.updateRefs` is on for this one command, from
#   GIT_CONFIG_COUNT/KEY_n/VALUE_n, GIT_CONFIG_PARAMETERS, then `-c` / `--config-env`
#   in order (git's order; the last setting wins), parsed as a git boolean.
# - last_flag(): a boolean option's effective state, read in order the way git does:
#   the last of `--x` / `--no-x` / its short alias wins (audit b91, D184 round 2).
# - staging(): the broad-staging checks (`add -A/--all/./-u`, `commit -a/--all`,
#   state.json), moved here from role_guard_refs.py to keep both files small.
# LONG comes from `git <sub> --git-completion-helper-all` (git 2.50.1, hidden options
# included), names without the leading `--`. A newer git adding an option can only
# make a prefix ambiguous where git itself would reject it.
# Not covered: `rebase.updateRefs` / `pull.rebase` from the repo's config files.
# Regression tests: tests/tooling/d184-role-guard-*.test.ts, tests/tooling/d180-verifier-probes.test.ts.
import os, shlex

LONG = {sub: frozenset(names.split()) for sub, names in {
    "branch": """
    abbrev all color column contains copy create-reflog delete edit-description force format ignore-case
    list merged move no-abbrev no-color no-column no-contains no-copy no-create-reflog no-delete
    no-edit-description no-force no-format no-ignore-case no-list no-merged no-move no-omit-empty
    no-points-at no-quiet no-recurse-submodules no-set-upstream no-set-upstream-to no-show-current
    no-sort no-track no-unset-upstream no-verbose omit-empty points-at quiet recurse-submodules remotes
    set-upstream set-upstream-to show-current sort track unset-upstream verbose with without""",
    "update-ref": """
    batch-updates create-reflog deref no-batch-updates no-create-reflog no-deref no-stdin stdin""",
    "symbolic-ref": """
    delete no-delete no-quiet no-recurse no-short quiet recurse short""",
    "fetch": """
    all append atomic auto-gc auto-maintenance deepen depth dry-run filter force ipv4 ipv6 jobs keep
    multiple negotiate-only negotiation-tip no-all no-append no-atomic no-auto-gc no-auto-maintenance
    no-deepen no-depth no-dry-run no-filter no-force no-jobs no-keep no-multiple no-negotiate-only
    no-negotiation-tip no-porcelain no-prefetch no-progress no-prune no-prune-tags no-quiet
    no-recurse-submodules no-recurse-submodules-default no-server-option no-set-upstream
    no-shallow-exclude no-shallow-since no-show-forced-updates no-stdin no-submodule-prefix no-tags
    no-update-head-ok no-update-shallow no-upload-pack no-verbose no-write-commit-graph
    no-write-fetch-head porcelain prefetch progress prune prune-tags quiet recurse-submodules
    recurse-submodules-default refetch refmap server-option set-upstream shallow-exclude shallow-since
    show-forced-updates stdin submodule-prefix tags unshallow update-head-ok update-shallow upload-pack
    verbose write-commit-graph write-fetch-head""",
    "pull": """
    all allow-unrelated-histories append autostash cleanup commit deepen depth dry-run edit ff ff-only
    force gpg-sign ipv4 ipv6 jobs keep log negotiation-tip no-all no-allow-unrelated-histories no-append
    no-autostash no-cleanup no-commit no-deepen no-depth no-dry-run no-edit no-ff no-force no-gpg-sign
    no-ipv4 no-ipv6 no-jobs no-keep no-log no-negotiation-tip no-progress no-prune no-quiet no-rebase
    no-recurse-submodules no-server-option no-set-upstream no-shallow-exclude no-shallow-since
    no-show-forced-updates no-signoff no-squash no-stat no-strategy no-strategy-option no-summary
    no-tags no-update-shallow no-upload-pack no-verbose no-verify no-verify-signatures progress prune
    quiet rebase recurse-submodules refmap server-option set-upstream shallow-exclude shallow-since
    show-forced-updates signoff squash stat strategy strategy-option summary tags unshallow
    update-shallow upload-pack verbose verify verify-signatures""",
    "rebase": """
    abort allow-empty-message apply autosquash autostash committer-date-is-author-date continue
    edit-todo empty exec ff force-rebase fork-point gpg-sign ignore-date ignore-whitespace interactive
    keep-base keep-empty merge no-allow-empty-message no-autosquash no-autostash
    no-committer-date-is-author-date no-exec no-ff no-force-rebase no-fork-point no-gpg-sign
    no-ignore-date no-ignore-whitespace no-keep-base no-keep-empty no-onto no-preserve-merges no-quiet
    no-reapply-cherry-picks no-rebase-merges no-rerere-autoupdate no-reschedule-failed-exec
    no-reset-author-date no-root no-signoff no-stat no-strategy no-strategy-option no-update-refs
    no-verbose no-verify no-whitespace onto preserve-merges quiet quit reapply-cherry-picks
    rebase-merges rerere-autoupdate reschedule-failed-exec reset-author-date root show-current-patch
    signoff skip stat strategy strategy-option update-refs verbose verify whitespace""",
    "checkout": """
    conflict detach force guess ignore-other-worktrees ignore-skip-worktree-bits merge no-conflict
    no-detach no-force no-guess no-ignore-other-worktrees no-ignore-skip-worktree-bits no-merge
    no-orphan no-overlay no-overwrite-ignore no-patch no-pathspec-file-nul no-pathspec-from-file
    no-progress no-quiet no-recurse-submodules no-track orphan ours overlay overwrite-ignore patch
    pathspec-file-nul pathspec-from-file progress quiet recurse-submodules theirs track""",
    "switch": """
    conflict create detach discard-changes force force-create guess ignore-other-worktrees merge
    no-conflict no-create no-detach no-discard-changes no-force no-force-create no-guess
    no-ignore-other-worktrees no-merge no-orphan no-overwrite-ignore no-progress no-quiet
    no-recurse-submodules no-track orphan overwrite-ignore progress quiet recurse-submodules track""",
    "add": """
    all chmod dry-run edit force ignore-errors ignore-missing ignore-removal intent-to-add interactive
    no-all no-chmod no-dry-run no-edit no-force no-ignore-errors no-ignore-missing no-ignore-removal
    no-intent-to-add no-interactive no-patch no-pathspec-file-nul no-pathspec-from-file no-refresh
    no-renormalize no-sparse no-update no-verbose no-warn-embedded-repo patch pathspec-file-nul
    pathspec-from-file refresh renormalize sparse update verbose warn-embedded-repo""",
    "commit": """
    ahead-behind all allow-empty allow-empty-message amend author branch cleanup date dry-run edit file
    fixup gpg-sign include interactive long message no-ahead-behind no-all no-allow-empty
    no-allow-empty-message no-amend no-author no-branch no-cleanup no-date no-dry-run no-edit no-file
    no-fixup no-gpg-sign no-include no-interactive no-long no-message no-null no-only no-patch
    no-pathspec-file-nul no-pathspec-from-file no-porcelain no-post-rewrite no-quiet no-reedit-message
    no-reset-author no-reuse-message no-short no-signoff no-squash no-status no-template
    no-untracked-files no-verbose no-verify null only patch pathspec-file-nul pathspec-from-file
    porcelain post-rewrite quiet reedit-message reset-author reuse-message short signoff squash status
    template trailer untracked-files verbose verify""",
    "worktree add": """
    checkout detach force guess-remote lock no-checkout no-detach no-force no-guess-remote no-lock
    no-orphan no-quiet no-reason no-relative-paths no-track orphan quiet reason relative-paths track""",
}.items()}

# Long options role_guard_refs.py inspects, incl. the ones whose value it must skip.
WATCHED = {sub: frozenset(names.split()) for sub, names in {
    "branch": "force delete move copy list set-upstream-to contains no-contains merged no-merged points-at sort format",
    "update-ref": "stdin no-deref",
    "symbolic-ref": "delete",
    "fetch": "refmap multiple depth deepen shallow-since shallow-exclude jobs server-option negotiation-tip "
             "upload-pack recurse-submodules-default",
    "pull": "refmap rebase no-rebase depth deepen shallow-since shallow-exclude jobs server-option "
            "negotiation-tip upload-pack strategy strategy-option",
    "rebase": "update-refs no-update-refs root onto strategy strategy-option exec",
    "checkout": "detach",
    "switch": "force-create detach",
    "worktree add": "detach reason",
    "add": "all update",
    "commit": "all",
}.items()}

# Long options that take the next word as their value when written without `=`.
VALUE = {sub: frozenset(names.split()) for sub, names in {
    "branch": "set-upstream-to contains no-contains merged no-merged points-at sort format",
    "fetch": "refmap depth deepen shallow-since shallow-exclude jobs server-option negotiation-tip "
             "upload-pack recurse-submodules-default filter submodule-prefix",
    "pull": "refmap depth deepen shallow-since shallow-exclude server-option negotiation-tip upload-pack "
            "strategy strategy-option cleanup",
    "rebase": "onto strategy strategy-option exec empty whitespace",
    "checkout": "conflict orphan pathspec-from-file",
    "switch": "create force-create conflict orphan",
    "worktree add": "reason",
    "add": "chmod pathspec-from-file",
    "commit": "author cleanup date file fixup message pathspec-from-file reedit-message reuse-message "
              "squash template trailer",
}.items()}

def _expand(sub, args):
    """(args with long-option prefixes spelled out, (prefix, candidates) if ambiguous or None)."""
    table, watched, value = LONG[sub], WATCHED.get(sub, frozenset()), VALUE.get(sub, frozenset())
    out, i = [], 0
    while i < len(args):
        a = args[i]
        i += 1
        if a == "--":
            return out + list(args[i - 1:]), None
        if not a.startswith("--"):
            out.append(a)
            continue
        name, eq, val = a[2:].partition("=")
        if name not in table:
            cands = sorted(o for o in table if o.startswith(name))
            if len(cands) == 1:
                name = cands[0]
            elif cands and watched.intersection(cands):
                return out, (a, cands)
        out.append(f"--{name}{eq}{val}")
        if name in value and not eq and i < len(args):
            out.append(args[i])
            i += 1
    return out, None

def normalize(sub, args):
    """Expand abbreviated long options of a subcommand the guard inspects.

    Returns (args, ambiguous); `ambiguous` is (word, candidate names) when a prefix
    matches several options and one of them is inspected, else None."""
    if sub == "worktree" and args[:1] == ["add"]:
        rest, amb = _expand("worktree add", args[1:])
        return ["add"] + rest, amb
    if sub in LONG:
        return _expand(sub, args)
    return list(args), None

def ambiguous_refusal(sub, amb):
    word, cands = amb
    return (f"`git {sub} {word}` is an ambiguous abbreviation of --{', --'.join(cands)}; "
            "spell the option out (rule 70).")

# ---- rebase.updateRefs for one command -----------------------------------

KEY = "rebase.updaterefs"

def git_bool(v):
    """git's boolean: bare (None) and true/yes/on or a non-zero integer are true;
    "" and false/no/off/0 are false; anything else (git dies on it) counts as true."""
    if v is None:
        return True
    s = v.strip().lower()
    if s in ("true", "yes", "on"):
        return True
    if s in ("", "false", "no", "off"):
        return False
    try:
        return int(s[:-1] if s[-1:] in ("k", "m", "g") else s, 0) != 0
    except ValueError:
        return True

def _parameters(text):
    """(key, value-or-None) pairs from GIT_CONFIG_PARAMETERS (`'k'='v'`, `'k=v'` or `'k'`)."""
    try:
        words = shlex.split(text)
    except ValueError:
        return [(KEY, None)] if KEY in text.lower() else []
    return [(k, v if eq else None) for k, eq, v in (w.partition("=") for w in words)]

def rebase_update_refs(conf):
    """True when `rebase.updateRefs` is on for this command.

    conf = ([("-c" | "--config-env", "key[=value]")], {inline VAR: value}); variables
    not assigned inline are read from this process's environment. A `--config-env`
    variable that cannot be read counts as true (an earlier `export` may set it)."""
    cfg, assigns = conf

    def env(name):
        return assigns[name] if name in assigns else os.environ.get(name)

    entries = []
    try:
        count = int(env("GIT_CONFIG_COUNT") or 0)
    except ValueError:
        count = 0
    for k in range(count):
        entries.append((env(f"GIT_CONFIG_KEY_{k}") or "", env(f"GIT_CONFIG_VALUE_{k}") or ""))
    entries += _parameters(env("GIT_CONFIG_PARAMETERS") or "")
    for opt, spec in cfg:
        key, eq, val = spec.partition("=")
        if opt == "--config-env":
            v = env(val) if eq else None
            entries.append((key, v if v is not None else "true"))
        else:
            entries.append((key, val if eq else None))
    on = False
    for key, val in entries:
        if key.lower() == KEY:
            on = git_bool(val)
    return on

def pull_rebases(args):
    """False only when the command line turns rebasing off (`--no-rebase`, `--rebase=false`);
    otherwise pull may rebase, through `pull.rebase` / `branch.<name>.rebase` config too."""
    state = None
    for a in args:
        if a == "--":
            break
        if a == "--rebase" or short_has(a, "r", "sXSjo"):
            state = True
        elif a.startswith("--rebase="):
            state = git_bool(a.split("=", 1)[1])
        elif a == "--no-rebase":
            state = False
    return state is not False

def last_flag(args, on, off=(), short="", value_letters=""):
    """True when the last spelling of a boolean option before `--` turns it on.

    `on` / `off` are full long names (args already normalized); `short` is its one-letter
    alias, counted inside a `-xyz` cluster before any of `value_letters`."""
    state = False
    for a in args:
        if a == "--":
            break
        if a in on or (short and short_has(a, short, value_letters)):
            state = True
        elif a in off:
            state = False
    return state

# ---- broad staging --------------------------------------------------------

def short_has(arg, letter, value_letters=""):
    """True when a `-xyz` cluster sets `letter` before any value-taking letter."""
    if not arg.startswith("-") or arg.startswith("--") or len(arg) < 2:
        return False
    for ch in arg[1:]:
        if ch == letter:
            return True
        if ch in value_letters:
            return False
    return False

def _names_state_json(arg):
    p = os.path.normpath(arg)
    return p.endswith(os.path.join(".claude", "tdd-guardian", "state.json")) or \
        p.endswith(os.path.join(".claude", "tdd-guardian"))

def staging(sub, args):
    """Refusal text for broad staging (args already normalized), else None."""
    if sub == "add":
        for a in args:
            if a in ("-A", "--all", ".", "./", "-u", "--update") or short_has(a, "A") or short_has(a, "u"):
                return f"`git add {a}` stages files you did not name; stage named paths only (rule 70)."
            if not a.startswith("-") and _names_state_json(a):
                return "never stage .claude/tdd-guardian/state.json; it is per-worktree gate state."
    if sub == "commit":
        for a in args:
            if a == "--":
                break
            if a == "--all" or short_has(a, "a", "mFCctS"):
                return "`git commit -a/--all` stages files you did not name; `git add` named paths first (rule 70)."
    return None
