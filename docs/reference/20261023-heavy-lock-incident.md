# Heavy-lock incident, 2026-10-23 (evidence for ADR-0135)

Recorded by herdr-delegator on the Mac mini. Read-only observation; nothing under picsee was touched.

## What was holding the lock

At about 10:30 `herdr agent read gpt-imple-1` showed mdpro's gpt-imple-1 waiting on the heavy lock:

```
[heavy-lock] still waiting (360s), held by: pid=33701 started=2026-10-23T10:23:31…
```

```
$ ps -o pid,ppid,etime,command -p 33701
33701 19366 07:12 …/Python scripts/tdd/heavy-lock.py zsh -f
$ ps -o pid,ppid,command -p 19366
19366     1 …/codex app-server --listen unix:// … --managed-daemon
$ lsof -a -p 33701 -d cwd -Fn
n/Users/jack/Documents/mac-app/picsee-wt/gpt-imple-1
$ pgrep -P 33701 | xargs ps -o pid,etime,command -p
34607 06:16 zsh -f
```

`zsh -f` (pid 34607) had no child process. It was an interactive shell held under picsee's lock wrapper, which in
turn held `$HOME/.cache/mdpro-heavy.lock`.

## What it blocked

Waiting behind it at the same moment:

- mdpro gpt-imple-1 (M1b): `heavy-lock.sh cargo test … m1b_new_default_yields_to_kept_custom_and_is_stored_unassigned`
  and `heavy-lock.sh pnpm exec vitest run tests/m1b-source-basic-keys.test.tsx --maxWorkers=2`;
- mdpro gpt-imple-2 (D255-WI-3d): `heavy-lock.sh pnpm test:run`.

By 11:13 the lock had moved on; its owner was an mdpro receipt record (`receipt.js record --id D255-WI-3d-F1-4 --lane rust`).
Machine state then: load averages 4.29 4.89 5.44 on 10 cores (4 performance, 6 efficiency), 16 GiB,
`kern.memorystatus_vm_pressure_level` 1, 66 % memory free.

## Why neither script caught it

- mdpro's `scripts/heavy-lock.sh` treats a holder as stale only when `kill -0 <owner pid>` fails. The owner was alive.
- picsee's `scripts/tdd/heavy-lock.py` never reclaims the shared directory itself, and has no check on what it runs.
- Neither has a notion of a held-but-idle job. A person found it by reading the `owner` file and the process tree.
