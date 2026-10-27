#!/usr/bin/env python3
"""Read or update the delegator heartbeat without losing concurrent updates.

  heartbeat.py show
  heartbeat.py set <agent> key=value [key=value ...]
  heartbeat.py note "<text>"
"""
import fcntl
import json
import os
import sys
import tempfile


P = os.path.expanduser(os.environ.get(
    'MDPRO_HEARTBEAT_PATH', '~/.mdpro-redesign/herdr-spike/delegator/heartbeat.json'))


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'show'
    if cmd not in ('show', 'set', 'note'):
        print(__doc__)
        return 2
    if cmd == 'set' and (len(sys.argv) < 4 or any('=' not in arg for arg in sys.argv[3:])):
        print(__doc__)
        return 2
    if cmd == 'note' and len(sys.argv) != 3:
        print(__doc__)
        return 2

    # Keep the lock file across calls. Locking the JSON inode itself would stop
    # working after os.replace(), because the next caller would lock a new inode.
    lock_fd = os.open(P + '.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        with open(P, encoding='utf-8') as source:
            heartbeat = json.load(source)
        if cmd == 'show':
            print(json.dumps(heartbeat, indent=2, ensure_ascii=False))
            return 0
        if cmd == 'set':
            assignment = heartbeat.setdefault('assignments', {}).setdefault(sys.argv[2], {})
            for item in sys.argv[3:]:
                key, value = item.split('=', 1)
                assignment[key] = None if value == 'null' else value
        else:
            heartbeat.setdefault('notes', []).append(sys.argv[2])

        mode = os.stat(P).st_mode & 0o777
        fd, temporary = tempfile.mkstemp(prefix='.heartbeat-', suffix='.json', dir=os.path.dirname(P))
        try:
            os.fchmod(fd, mode)
            with os.fdopen(fd, 'w', encoding='utf-8') as target:
                json.dump(heartbeat, target, indent=2, ensure_ascii=False)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, P)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print('ok')
        return 0
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


if __name__ == '__main__':
    sys.exit(main())
