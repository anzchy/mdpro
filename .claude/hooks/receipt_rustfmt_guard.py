# Purpose: logic of the D187 PreToolUse(Bash) hook receipt-rustfmt-guard.sh, which
# refuses a tdd-guardian `receipt.js record` that would fingerprint a Rust test file
# that is not rustfmt-clean (rule 10 「Format before you record」). The receipt hashes
# the files' bytes, so a later `cargo fmt` breaks a red recorded on unformatted bytes
# for good (D173 commit 1: 8 of 9 files).
# Pipeline: hook JSON on stdin → Bash command → `receipt.js record` calls (through
# `cd`, `env`, `VAR=x`, `&&`/`;` chains and `bash|sh|zsh -c '…'`, parsed with
# role_guard_shell.py, unedited) → the files record would hash: the `--files` list
# (resolved against `--cwd`, else the call's dir), or with no `--files` the changed
# test files `git status` reports, classified as tdd-guardian 0.10.2 does → for each
# existing `.rs` file, `rustfmt --edition E --emit stdout` on its bytes (stdin, run
# in the file's dir so a rustfmt.toml is honoured) must give the same bytes back.
# Key decisions: `rustfmt --check` reading stdin exits 0 even when it prints a diff
# (rustfmt 1.8.0), so the bytes are compared instead; stdin also keeps rustfmt from
# following `mod x;` into other files. Fail closed: rustfmt not found, a failing
# `git status`, a file rustfmt cannot parse, or any exception denies with exit 2 and
# one line on stderr. Non-`.rs` files and deleted paths are never handed to rustfmt.
# Not covered: a record through any entry point other than a `receipt.js` path,
# backticks, `eval`, scripts that run receipt.js.
# @coordinates-with receipt-rustfmt-guard.sh (the hook), role_guard_shell.py (parser)
# Regression tests: tests/d187-receipt-rustfmt-guard.test.ts.
import json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TAG = "receipt-rustfmt-guard"
RUSTFMT_TIMEOUT_S = 10
GIT_TIMEOUT_S = 15  # receipt.js's own `git status` timeout

# Mirrors isTestFile in tdd-guardian 0.10.2 scripts/tdd-guardian/lib/verification.js
# (TEST_DIR_RE, TEST_FILE_RES, BOOKKEEPING_RE); keep in step on a plugin upgrade.
TEST_DIR_RE = re.compile(r"(^|/)(tests?|specs?|__tests__|__specs__|testing|it|e2e|integration-tests)(/|$)", re.I)
TEST_FILE_RES = [
    re.compile(r"[._-](test|tests|spec|specs)\.[a-z0-9]+$", re.I),
    re.compile(r"^test_[^/]+\.py$", re.I),
    re.compile(r"^[^/]+_test\.(go|py|rb|rs|dart|exs?)$", re.I),
    re.compile(r"(Test|Tests|Spec|Specs|IT)\.(java|kt|kts|scala|cs|fs|swift|groovy)$"),
    re.compile(r"^[^/]+Tests?\.swift$"),
    re.compile(r"\.feature$", re.I),
]
BOOKKEEPING_RE = re.compile(r"(^|/)\.claude/tdd-guardian/")

# receipt.js FLAGS: the ones that take a value (`json` does not).
VALUE_FLAGS = {"id", "lane", "files", "cwd"}


class Deny(Exception):
    pass


def is_test_file(p):
    clean = p.strip().replace("\\", "/")
    if not clean or BOOKKEEPING_RE.search(clean):
        return False
    base = clean.rsplit("/", 1)[-1]
    return any(r.search(base) for r in TEST_FILE_RES) or bool(TEST_DIR_RE.search(clean))


def parse_receipt_args(argv):
    """receipt.js parseArgs: `--k=v` / `--k v`; the first positional is the subcommand."""
    args, positional, i = {}, [], 0
    while i < len(argv):
        t = argv[i]
        i += 1
        if not t.startswith("--"):
            positional.append(t)
            continue
        key, eq, val = t[2:].partition("=")
        if key in args:
            continue  # receipt.js refuses a repeated option; the first one stands
        if key in VALUE_FLAGS and not eq:
            if i < len(argv) and not argv[i].startswith("--"):
                val = argv[i]
                i += 1
        args[key] = val
    return (positional[0] if positional else None), args


def receipt_argv(seg):
    """The arguments after `receipt.js` when this segment runs it (`node … receipt.js` or directly)."""
    for i, t in enumerate(seg):
        if os.path.basename(t) == "receipt.js":
            runner = os.path.basename(seg[0])
            if i == 0 or (runner in ("node", "nodejs") and all(a.startswith("-") for a in seg[1:i])):
                return seg[i + 1:]
            return None
    return None


def record_calls(shell, cmd, here, depth=0):
    """Yield (dir, args) for each `receipt.js record` call in `cmd`."""
    for seg in shell.segments(cmd):
        seg, _genv, there, _assigns = shell.strip_prefix(seg, here)
        if not seg:
            continue
        prog = os.path.basename(seg[0])
        if prog == "cd":
            here = os.path.join(here, os.path.expanduser(seg[1] if len(seg) > 1 else "~"))
        elif prog in shell.SHELLS and depth < 3:
            script = shell.shell_script(seg[1:])
            if script is not None:
                yield from record_calls(shell, script, there, depth + 1)
        else:
            argv = receipt_argv(seg)
            if argv is not None:
                sub, args = parse_receipt_args(argv)
                if sub == "record":
                    yield there, args


def git_test_files(base):
    """(shown, absolute) for changed `.rs` test files, read as receipt.js reads `git status`."""
    def git(*a):
        try:
            r = subprocess.run(["git", "-C", base, *a], capture_output=True, timeout=GIT_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise Deny(f"git status failed in {base} ({type(e).__name__}); cannot tell which test files record would hash")
        if r.returncode != 0:
            raise Deny(f"git status failed in {base}; cannot tell which test files record would hash")
        return r.stdout.decode("utf-8", "surrogateescape")

    entries = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0")
    top = git("rev-parse", "--show-toplevel").strip()
    out, i = [], 0
    while i < len(entries):
        entry, i = entries[i], i + 1
        status, rel = entry[:2], entry[3:]
        if "R" in status or "C" in status:
            i += 1  # a rename or copy is followed by its source path
        if rel.endswith(".rs") and is_test_file(rel):
            out.append((rel, os.path.join(top, rel)))
    return out


def listed_files(base, value):
    names = [f.strip() for f in value.split(",") if f.strip()]
    return [(f, os.path.join(base, os.path.expanduser(f))) for f in names if f.endswith(".rs")]


def find_rustfmt():
    found = shutil.which("rustfmt")
    if found:
        return found
    for home in (os.environ.get("CARGO_HOME"), os.path.join(os.path.expanduser("~"), ".cargo")):
        cand = os.path.join(home, "bin", "rustfmt") if home else ""
        if cand and os.access(cand, os.X_OK):
            return cand
    raise Deny("rustfmt not found; install it (rustup component add rustfmt) before recording .rs files")


def edition():
    project = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.join(HERE, "..", "..")
    try:
        with open(os.path.join(project, "src-tauri", "Cargo.toml"), encoding="utf-8") as fh:
            m = re.search(r'^\s*edition\s*=\s*"(\d{4})"', fh.read(), re.M)
    except OSError:
        m = None
    return m.group(1) if m else "2021"


def is_clean(rustfmt, path, ed):
    with open(path, "rb") as fh:
        data = fh.read()
    r = subprocess.run([rustfmt, "--edition", ed, "--emit", "stdout"], input=data, capture_output=True,
                       cwd=os.path.dirname(path) or ".", timeout=RUSTFMT_TIMEOUT_S)
    return r.returncode == 0 and r.stdout == data


def check(data):
    if data.get("tool_name") != "Bash":
        return
    cmd = (data.get("tool_input") or {}).get("command") or ""
    if "receipt.js" not in cmd:
        return
    sys.path.insert(0, HERE)  # -I leaves the script's own dir off sys.path
    import role_guard_shell as shell

    targets = []
    for there, args in record_calls(shell, cmd, data.get("cwd") or os.getcwd()):
        base = os.path.join(there, os.path.expanduser(args["cwd"])) if args.get("cwd") else there
        found = listed_files(base, args["files"]) if "files" in args else git_test_files(base)
        targets += [(shown, p) for shown, p in found if os.path.isfile(p)]  # missing: receipt.js reports it
    if not targets:
        return
    rustfmt, ed = find_rustfmt(), edition()
    bad = [shown for shown, p in targets if not is_clean(rustfmt, p, ed)]
    if bad:
        raise Deny(f"run cargo fmt before recording; not rustfmt-clean: {', '.join(bad)}")


def deny(msg):
    sys.stderr.write(f"{TAG}: {msg} (rule 10, D187)".replace("\n", "\\n") + "\n")
    sys.exit(2)


def main():
    try:
        check(json.loads(sys.stdin.read()))
    except Deny as e:
        deny(str(e))
    except Exception as e:  # fail closed: an unchecked record is the bug this guards
        deny(f"internal error ({type(e).__name__}: {e}); refusing the call")
    sys.exit(0)


if __name__ == "__main__":
    main()
