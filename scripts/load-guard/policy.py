"""Signal authority for runner groups: verified runners and connected support only.

Unknown or protected members veto the whole group. Cargo provenance requires
real workspace/depfile/libtest content, so copying an agent into target is not
sufficient. Support authority survives reparenting only during a checked drain.
"""
import mmap
import os
import pathlib
import re
import shlex
import shutil


def allowed_root(cwd):
    if not cwd:
        return False
    home = pathlib.Path.home() / "Documents/mac-app"
    roots = [home / name for name in ("mdpro", "mdpro-wt", "picsee", "picsee-wt")]
    if os.environ.get("MDPRO_GUARD_TEST") == "1" and os.environ.get("MDPRO_LOAD_GUARD_TEST_ROOT"):
        roots.append(pathlib.Path(os.environ["MDPRO_LOAD_GUARD_TEST_ROOT"]))
    candidate = pathlib.Path(cwd).resolve()
    return any(candidate == root.resolve() or root.resolve() in candidate.parents for root in roots)


def trusted_node(executable):
    trusted = [shutil.which("node"), "/opt/homebrew/bin/node", "/usr/local/bin/node",
               str(pathlib.Path.home() / ".local/bin/node")]
    return any(item and pathlib.Path(executable).resolve() == pathlib.Path(item).resolve() for item in trusted)


def protected(process):
    command = process["command"]
    executable = process.get("executable") or command.split(None, 1)[0] if command else ""
    gui_app = ".app/" in executable.lower() and not executable.startswith("/Applications/Xcode.app/Contents/Developer/")
    return not command or gui_app or "Picsee.app" in command or any(
        name in executable.lower() for name in ("codex", "claude", "kimi", "xcodebuild", "codesign"))


def cargo_binary(executable):
    try:
        binary = pathlib.Path(executable).resolve(strict=True)
        if not re.search(r"/target/(?:debug|release)/deps/[A-Za-z0-9_]+-[0-9a-f]{16}$", str(binary)):
            return False
        workspace = binary.parents[3]
        depfile = binary.with_suffix(".d")
        if not allowed_root(workspace) or not (workspace / "Cargo.toml").is_file() or not depfile.is_file():
            return False
        if binary.parent not in depfile.resolve().parents or ".rs" not in depfile.read_text():
            return False
        # Filename, parent argv and a writable .d alone also describe a renamed
        # agent. Cargo's libtest harness must actually be linked into the file.
        with binary.open("rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
            return data.find(b"RUST_TEST_THREADS") >= 0 and data.find(b"test result:") >= 0
    except (OSError, ValueError):
        return False


def allowlisted(process):
    command = process["command"]
    if protected(process) or not allowed_root(process["cwd"]):
        return False
    executable = process.get("executable") or command.split(None, 1)[0]
    try:
        argv = shlex.split(command)
    except ValueError:
        return False
    developer = pathlib.Path("/Applications/Xcode.app/Contents/Developer")
    real = pathlib.Path(executable).resolve()
    xctest = (developer / "usr/bin/xctest").resolve()
    helper = (developer / "Toolchains/XcodeDefault.xctoolchain/usr/libexec/swift/pm/swiftpm-testing-helper").resolve()
    bundle = None
    if real == xctest:
        bundle = next((arg for arg in argv[1:] if ".xctest" in arg), None)
    elif real == pathlib.Path("/usr/bin/xcrun").resolve() and len(argv) >= 3 and \
            pathlib.Path(argv[0]).name == "xcrun" and argv[1] == "xctest":
        bundle = argv[2]
    elif real == helper and "--test-bundle-path" in argv:
        index = argv.index("--test-bundle-path") + 1
        bundle = argv[index] if index < len(argv) else None
    if bundle:
        match = re.fullmatch(r"(.*/)?(PicseeKitPackageTests|PicseeAppTests)\.xctest(?:/Contents/MacOS/\2)?", bundle)
        return bool(match and allowed_root(pathlib.Path(process["cwd"]) / bundle))
    if executable.endswith(("/node", "/nodejs")) and trusted_node(executable):
        if process.get("executable") and re.fullmatch(r"node \(vitest(?: \d+)?\)\s*", command):
            return True
        if process.get("executable") and re.fullmatch(r"node /\S*/pnpm(?:\.c?js)? exec vitest run(?: .*)?", command):
            return True
        worker = re.search(r"(/\S+/node_modules/(?:\.pnpm/\S+/node_modules/)?vitest/\S*(?:/forks|forks\.js)\S*)", command)
        return bool(worker and allowed_root(worker.group(1)))
    return cargo_binary(executable)


def ancestor_of(parent, child, members):
    by_pid = {item["pid"]: item for item in members}
    seen = set()
    while child["ppid"] in by_pid and child["ppid"] not in seen:
        seen.add(child["ppid"])
        child = by_pid[child["ppid"]]
        if child["pid"] == parent["pid"]:
            return True
    return False


def support(process, runners, members):
    if protected(process) or not allowed_root(process["cwd"]):
        return False
    executable = process.get("executable", "")
    try:
        argv = shlex.split(process["command"])
    except ValueError:
        return False
    real = pathlib.Path(executable).resolve()
    # Only the installed esbuild service beneath an already verified Vitest
    # runner; never esbuild as a standalone build command or copied basename.
    if allowed_root(real) and re.search(r"/node_modules/@esbuild/[^/]+/bin/esbuild$", str(real)) and \
            len(argv) == 3 and argv[1].startswith("--service=") and argv[2] == "--ping":
        return any("vitest" in runner["command"] and ancestor_of(runner, process, members) for runner in runners)
    cargo_paths = list((pathlib.Path.home() / ".rustup/toolchains").glob("*/bin/cargo"))
    cargo_paths += [pathlib.Path(item) for item in (shutil.which("cargo"),) if item]
    if any(real == item.resolve() for item in cargo_paths) and len(argv) >= 2 and argv[1] == "test":
        return any(cargo_binary(runner.get("executable", "")) and ancestor_of(process, runner, members) for runner in runners)
    xcode_bin = pathlib.Path("/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin")
    swift = pathlib.Path(executable) in (xcode_bin / "swift-test", xcode_bin / "swift-build") or (
        real in {p.resolve() for p in (xcode_bin / "swift-test", xcode_bin / "swift-build")} and
        bool(argv) and pathlib.Path(argv[0]).name in ("swift-test", "swift-build"))
    script = (pathlib.Path(process["cwd"]) / argv[1]).resolve() if len(argv) >= 2 else pathlib.Path("/")
    picsee_wrapper = trusted_node(executable) and bool(
        re.fullmatch(r".*/scripts/tdd/(?:app|swift)-lane\.mjs", str(script))) and allowed_root(script)
    if swift or picsee_wrapper:
        return any("xctest" in runner["command"] and ancestor_of(process, runner, members) for runner in runners)
    return False


def authorized_group(members):
    if any(item.get("uid") != os.getuid() or protected(item) for item in members):
        return False
    runners = [item for item in members if allowlisted(item)]
    return bool(runners) and all(item in runners or support(item, runners, members) for item in members)
