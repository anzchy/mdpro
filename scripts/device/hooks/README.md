# dtrack hook events: spool, replay, receive

The device tester `dtrack` runs as a Claude session on the Mac mini. Its hook events
(`Stop`, `Notification`, `SessionStart`) reach the MacBook through this pipeline,
which [ADR-0087](../../../docs/adr/0087-device-check-hook-events-are-spooled-on-the-mini-and-replayed-in-sequence.md)
and D177 introduced. If the network is down, events wait in a spool on the mini.
They are replayed in order once a later event fires. The receiver drops
duplicates and reports any gaps.

## Files

| File | Runs on | What it does |
|---|---|---|
| `push.mjs` | mini | The hook command. It reads the hook JSON from stdin, spools it, starts a detached `push.mjs --flush`, and always exits 0 in under 1 s. `--flush` replays the spool. |
| `pushCore.mjs` | mini | `enqueue` (numbering, spooling, the 5000-entry cap, orphaning). It also re-exports `flush` and the shared constants, so callers import everything from here. |
| `pushFlush.mjs` | mini | `flush`: sends in spool order. A 2xx deletes; 401/408/429/5xx/network errors stop; any other 4xx dead-letters. A run is capped at `FLUSH_MAX_MS` (60 s): after that it stops with reason `deadline`, abandons any request still in flight and keeps every unsent entry. |
| `pushCtx.mjs` | mini | The constants, hook-dir file names, `withDefaults` and the fetch-based poster. |
| `pushLocks.mjs` | mini | The `spool.lock` / `seq.lock` / `flush.lock` dirs. Each holds an owner pid, and a dead owner's lock is reclaimed. A reclaim that fails waits and uses up the deadline like a live holder, so it never spins. |
| `pushStore.mjs` | mini | The `seq` file (`{epoch, seq}`), spool/dead/orphan jsonl files, and `push.log`. A seq must be a safe integer below `Number.MAX_SAFE_INTEGER - 1`; at that point the counter rolls over to a new epoch. |
| `build-mini-settings.mjs` | mini | Writes dtrack's `.claude/settings.json` hooks as `type:"command"` entries running `<node> push.mjs`, merged into the existing settings. Refuses node < 18. |
| `receiver.py` | MacBook | The HTTP receiver, run by launchd as `com.mdpro.hook-receiver`. It checks the token, appends to `events.jsonl`, mirrors `latest.json`, and dedupes spooled events. A seq is marked as seen only after the event is written; if the write fails, the reply is 500 and the sender retries. |
| `receiver_spool.py` | MacBook | Validates the spool fields (integers up to 2^53 − 1) and keeps the dedupe state (`seq-state.json`) and gaps (`gaps.json`). A jump in seq records at most 10,000 missing seqs, however large the jump. |
| `gap-lines.py` | MacBook | Prints `gaps.json` as `missing seq A..B (source)`, `dead N (source)` and `orphans N (source)` lines. |
| `wait-dtrack.sh` | MacBook | Blocks until a new event arrives. `-t <secs>` sets a timeout (exit 124 when it expires); `-e <regex>` filters events. The gap lines go to stderr. |
| `last-dtrack.sh` | MacBook | Prints the latest event, then the gap lines. |

The tests are `tests/d177-*.test.ts`.

## Install paths and requirements

- **MacBook:** `~/.mdpro-redesign/hooks/` holds the receiver files, `gap-lines.py`, and the two shell scripts. The receiver also writes its state files there.
- **Mini:** `~/.mdpro-redesign/hooks/` holds `push.mjs`, `pushCore.mjs`, `pushCtx.mjs`, `pushFlush.mjs`, `pushLocks.mjs`, `pushStore.mjs` and `build-mini-settings.mjs`. The spool, `seq`, dead-letter, orphan and log files are created there.
- **Node:** the mini needs node ≥ 18, because `push.mjs` uses global `fetch` and `AbortSignal.timeout`.
- **Override:** `MDPRO_HOOK_DIR` replaces the hook dir on either side. The tests use it; production does not.

### Secrets: paths only

| Item | MacBook | Mini |
|---|---|---|
| Shared token | `~/.mdpro-redesign/hooks/token` | `~/.mdpro-redesign/hooks/token` (mode 0600) |
| Push config | (none) | `~/.mdpro-redesign/hooks/push.json` (mode 0600): `{"url": "http://<macbook-tailscale-ip>:8787/hook", "source": "dtrack-mini"}` |

- Never print the token, and never put it on a command line: copy the file instead.
- The settings file the builder writes contains no URL and no token.

## Cutover

1. **MacBook: swap the receiver.**
   - Copy `receiver.py`, `receiver_spool.py`, `gap-lines.py`, `wait-dtrack.sh` and `last-dtrack.sh` into `~/.mdpro-redesign/hooks/`.
   - Restart it with `launchctl kickstart -k gui/$(id -u)/com.mdpro.hook-receiver`.
   - The old `type:"http"` hook on the mini keeps working, because the receiver still accepts the legacy body.
2. **Mini: install the push side.**
   - `rsync` the seven mini files into `~/.mdpro-redesign/hooks/`.
   - Write `push.json` and copy the token file, both at mode 0600.
   - Check that `node -v` prints v18 or later.
   - Back up dtrack's settings: `cp <dtrack-project>/.claude/settings.json <dtrack-project>/.claude/settings.json.bak`.
   - Build the new settings:
     `node ~/.mdpro-redesign/hooks/build-mini-settings.mjs <dtrack-project>/.claude/settings.json <dtrack-project>/.claude/settings.json.bak --node "$(command -v node)"`.
   - **The user** restarts dtrack's `claude` process. Rule 70 forbids sessions from doing it.
3. **Device check: receiver down.**
   - Stop the receiver on the MacBook.
   - Have dtrack fire a few events, then start the receiver again and let dtrack fire one more.
   - `last-dtrack.sh` should show every event, in order, with no gap lines.
   - The Tailscale-down variant is not exercised (user decision).

**Rollback:** restore `settings.json.bak` and have the user restart dtrack. The new receiver still accepts the legacy body.

## Known limits

- The spool flushes only when the next hook event fires. After a timed-out `wait-dtrack.sh`, run `last-dtrack.sh` to see whether events are waiting.
- An orphaned event (a lock stayed busy for more than 500 ms) is visible only as `orphans N`, and only after a later POST succeeds.
- At most 64 retired epochs and 10,000 missing seqs are kept per source.
- A flush run stops after 60 s (`FLUSH_MAX_MS`), and whatever is left waits for the next hook event.
- The receiver runs under `/usr/bin/python3` (3.9.6 on the MacBook), so it must stay 3.9-compatible. The tests spawn `python3` from `PATH`.
