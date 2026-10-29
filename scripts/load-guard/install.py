#!/usr/bin/env python3
"""Write/remove mdpro's launchd plist without loading it.

Usage: python3 scripts/load-guard/install.py install|uninstall. The delegator
loads it after landing. A foreign plist is never overwritten or removed.
"""
import os
import pathlib
import sys
import tempfile

MARKER = "mdpro-load-guard-managed"
HERE = pathlib.Path(__file__).resolve().parent
DEST = pathlib.Path.home() / "Library/LaunchAgents/com.mdpro.load-guard.plist"


def owned():
    try:
        if DEST.is_symlink():
            return False
        template = (HERE / "com.mdpro.load-guard.plist.in").read_text(encoding="utf8")
        rendered = template.replace("@BACKSTOP@", str(HERE / "backstop.py"))
        return DEST.read_text(encoding="utf8") == rendered
    except (OSError, UnicodeError):
        return False


def install():
    if (DEST.exists() or DEST.is_symlink()) and not owned():
        print("refusing to overwrite a foreign plist", file=sys.stderr)
        return 1
    template = (HERE / "com.mdpro.load-guard.plist.in").read_text(encoding="utf8")
    rendered = template.replace("@BACKSTOP@", str(HERE / "backstop.py"))
    DEST.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".mdpro-load-guard-", dir=DEST.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as stream:
            stream.write(rendered)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, DEST)
    finally:
        pathlib.Path(temp).unlink(missing_ok=True)
    return 0


def uninstall():
    if not DEST.exists() and not DEST.is_symlink():
        return 0
    if not owned():
        print("refusing to remove a foreign plist", file=sys.stderr)
        return 1
    DEST.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(install() if sys.argv[1:] == ["install"] else uninstall() if sys.argv[1:] == ["uninstall"] else 64)
