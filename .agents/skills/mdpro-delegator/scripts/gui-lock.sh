#!/bin/zsh
# Machine-wide GUI lock shared with picsee. A permanent BSD flock mutex protects each mdpro transaction.
# acquire <batch> [expected_minutes=45] [purpose] [session=herdr-delegator]
# wait <batch> [expected_minutes] [purpose] [session] [max_wait_min=60]
# release <batch> --acquisition-id <lowercase UUIDv4>; status
# Owner: project, session, batch, start, pid, expected_minutes, purpose, acquisition_id.
exec /usr/bin/python3 - "$@" <<'PY'
import datetime
import fcntl
import os
import pathlib
import re
import stat
import sys
import tempfile
import time
import uuid

cache = pathlib.Path.home() / ".cache"
lockdir = cache / "desktop-gui.lock"
mutex = cache / "desktop-gui.mutex"
required = {"project", "session", "batch", "start", "pid", "expected_minutes", "purpose", "acquisition_id"}
uuid4 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")

class Refused(Exception):
    pass

def valid_text(value):
    lines = value.splitlines()
    if not value or "\0" in value or len(lines) != 1 or lines[0] != value:
        raise Refused("invalid owner field value")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise Refused("owner field is not UTF-8") from error
    return value

def with_mutex(operation):
    cache.mkdir(parents=True, exist_ok=True)
    fd = os.open(mutex, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        return operation()
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def read_owner():
    if lockdir.is_symlink() or not lockdir.is_dir():
        raise Refused("lock directory is absent or symlinked")
    fd = os.open(lockdir / "owner", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise Refused("owner is not a regular file")
        raw = os.read(fd, 8193)
        if len(raw) > 8192:
            raise Refused("owner is too large")
    finally:
        os.close(fd)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise Refused("owner is not UTF-8") from error
    values = {}
    for line in text.splitlines():
        if "=" not in line:
            raise Refused("malformed owner line")
        key, value = line.split("=", 1)
        if key not in required or key in values:
            raise Refused("unknown or duplicate owner field")
        values[key] = valid_text(value)
    if set(values) != required or not uuid4.fullmatch(values["acquisition_id"]):
        raise Refused("missing or malformed owner field")
    return raw, values

def publish_owner(owner):
    fd = os.open(lockdir / "owner", os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    # An incomplete owner keeps the directory occupied and later operations fail closed.
    with os.fdopen(fd, "wb") as stream:
        stream.write(owner)
        stream.flush()
        os.fsync(stream.fileno())

def acquire(batch, expected, purpose, session):
    batch, purpose, session = map(valid_text, (batch, purpose, session))
    if not expected.isdecimal() or int(expected) <= 0:
        raise Refused("invalid expected minutes")
    def transaction():
        acquisition_id = str(uuid.uuid4())
        owner = (
            f"project=mdpro\nsession={session}\nbatch={batch}\n"
            f"start={datetime.datetime.now().astimezone().strftime('%Y-%m-%dT%H:%M:%S%z')}\n"
            f"pid={os.getpid()}\nexpected_minutes={expected}\npurpose={purpose}\n"
            f"acquisition_id={acquisition_id}\n"
        ).encode("utf-8")
        try:
            os.mkdir(lockdir, 0o700)
        except FileExistsError:
            return None
        try:
            publish_owner(owner)
        except Exception:
            (lockdir / "owner").unlink(missing_ok=True)
            lockdir.rmdir()
            raise
        return acquisition_id
    return with_mutex(transaction)

def test_pause(values):
    if os.environ.get("MDPRO_GUARD_TEST") != "1":
        return
    if values["project"] != "picsee" and os.environ.get("MDPRO_GUI_LOCK_PAUSE_ACTIVE") != "1":
        return
    ready = os.environ.get("MDPRO_GUI_LOCK_PAUSE_READY")
    gate = os.environ.get("MDPRO_GUI_LOCK_PAUSE_GATE")
    if not ready or not gate:
        return
    temp = pathlib.Path(tempfile.gettempdir()).resolve()
    for candidate in (ready, gate):
        target = pathlib.Path(candidate)
        parent = target.parent.resolve()
        if not target.is_absolute() or temp not in parent.parents:
            raise Refused("test pause path must resolve under tmpdir")
    pathlib.Path(ready).write_text("ready")
    deadline = time.monotonic() + 8
    while pathlib.Path(gate).exists():
        if time.monotonic() > deadline:
            raise Refused("test pause timed out")
        time.sleep(0.01)

def test_pre_mutex_pause():
    if os.environ.get("MDPRO_GUARD_TEST") != "1":
        return
    ready = os.environ.get("MDPRO_GUI_LOCK_PRE_MUTEX_READY")
    gate = os.environ.get("MDPRO_GUI_LOCK_PRE_MUTEX_GATE")
    if not ready or not gate:
        return
    temp = pathlib.Path(tempfile.gettempdir()).resolve()
    for candidate in (ready, gate):
        target = pathlib.Path(candidate)
        if not target.is_absolute() or temp not in target.parent.resolve().parents:
            raise Refused("test pre-mutex path must resolve under tmpdir")
    pathlib.Path(ready).write_text("ready")
    deadline = time.monotonic() + 8
    while pathlib.Path(gate).exists():
        if time.monotonic() > deadline:
            raise Refused("test pre-mutex pause timed out")
        time.sleep(0.01)

def release(batch, acquisition_id):
    valid_text(batch)
    if not uuid4.fullmatch(acquisition_id):
        raise Refused("invalid acquisition id")
    test_pre_mutex_pause()
    def transaction():
        try:
            raw, values = read_owner()
        except (FileNotFoundError, NotADirectoryError, OSError) as error:
            raise Refused("owner is absent or unreadable") from error
        test_pause(values)
        if values["project"] != "mdpro" or values["batch"] != batch or values["acquisition_id"] != acquisition_id:
            raise Refused("not this acquisition")
        os.unlink(lockdir / "owner")
        try:
            os.rmdir(lockdir)
        except OSError as error:
            try:
                publish_owner(raw)
            except OSError as restore_error:
                raise Refused(f"ALERT: release failed and owner restoration failed: {restore_error}") from error
            raise Refused(f"release failed; owner restored: {error}") from error
    with_mutex(transaction)

def show():
    if not lockdir.exists() and not lockdir.is_symlink():
        print("FREE")
        return
    print("HELD:")
    if lockdir.is_symlink() or not lockdir.is_dir():
        print("  (invalid lock path; do not start GUI work)")
        return
    try:
        for line in (lockdir / "owner").read_text().splitlines():
            print(f"  {line}")
    except OSError:
        print("  (no owner file)")

def main(args):
    command = args[0] if args else "status"
    if command == "status" and len(args) <= 1:
        show()
        return 0
    if command in ("acquire", "wait"):
        if len(args) < 2 or len(args) > (6 if command == "wait" else 5):
            raise Refused("usage: acquire|wait <batch> [expected] [purpose] [session] [max_wait_min]")
        batch = args[1]
        expected = args[2] if len(args) > 2 else "45"
        purpose = args[3] if len(args) > 3 else "device batch"
        session = args[4] if len(args) > 4 else "herdr-delegator"
        attempts = 1 if command == "acquire" else int(args[5]) if len(args) > 5 else 60
        if attempts <= 0:
            raise Refused("invalid wait limit")
        interval = 60.0
        if os.environ.get("MDPRO_GUARD_TEST") == "1":
            interval = float(os.environ.get("MDPRO_GUI_LOCK_WAIT_SECONDS", "60"))
            if not 0 <= interval <= 60:
                raise Refused("invalid test wait interval")
        for attempt in range(attempts):
            acquisition_id = acquire(batch, expected, purpose, session)
            if acquisition_id is not None:
                print(f"acquisition_id={acquisition_id}")
                return 0
            if attempt + 1 < attempts:
                time.sleep(interval)
        print("BUSY" if command == "acquire" else "TIMEOUT: still held; report to the user", file=sys.stderr)
        return 75
    if command == "release":
        if len(args) != 4 or args[2] != "--acquisition-id":
            raise Refused("usage: release <batch> --acquisition-id <uuid>")
        release(args[1], args[3])
        print(f"RELEASED {args[1]}")
        return 0
    raise Refused("usage: gui-lock.sh acquire|wait|release|status")

try:
    sys.exit(main(sys.argv[1:]))
except (Refused, ValueError) as error:
    print(f"REFUSED: {error}", file=sys.stderr)
    sys.exit(1)
except OSError as error:
    print(f"FAIL: {error}", file=sys.stderr)
    sys.exit(1)
PY
