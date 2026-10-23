# Device check B2: file watcher, Mac mini, 2026-10-23

Committed by herdr-delegator from the tester's report (gpt-imple-3, Codex Computer Use). Build: the same verify build
of master `ed958b26` as B1, launched by exact path; one process, `releaseId:"unknown"`. Evidence on the mini under
`~/.mdpro-redesign/device/B2-evidence/`.

## Delegator's check against the cards

| Item | Verdict | Why |
|---|---|---|
| D246 H-1 | **PASS** | 3 scripted rm-then-recreate tries all end on the Modified prompt (`emitted_deleted` → `emitted_modified`, one coalesced) |
| D246 H-2 | **PASS** | unreadable file: `emitted_modified` with `unchangedCheck:"read_failed"`, not Deleted |
| D171 re-smoke | **PASS** | background change recorded, delivered on activation; ⌘S blocked until answered |
| D178 | **NOT EXERCISED** | third run in which macOS produced no `renamed` event; both tries surfaced safely as Deleted. Proposed for closing as unreachable by hand, pending the user's ruling |
| D101 record | **PASS** | ⌘S ×20: `self_write` 5, `ignored_unchanged` 35, zero reload prompts |

Note: the shared log held `app.quit.*` lines for windows `A`, `B`, `w0`–`w7` during the run. They come from Rust unit tests
writing to the real `~/.mdpro/mdpro.log` while other sessions ran their lanes, not from the app under test (registered
as D316).

---

## Tester's report (verbatim)

# B2 report: file watcher, Mac mini (gpt-imple-3, 2026-10-23)

- **Build:** existing `verify-ed958b2`, master `ed958b26f69b7b8a0d8c1ea608056d5f6dbdbf6d`; no rebuild.
- **Run:** 2026-10-23 15:47:57–15:53:25 Asia/Shanghai.
- **Launch identity:** launched only with `open -n /Users/jack/Documents/mac-app/mdpro-wt/verify-ed958b2/src-tauri/target/release/bundle/macos/mdpro.app`. Before testing, `pgrep` showed exactly one mdpro process, PID 99412, at the verify path and no other mdpro process. The newest `app.ready` was PID 99412, `appVersion:"0.3.5"`, `buildId:"unknown"`, `releaseId:"unknown"`. Receipt: `B2-evidence/logs/launch-receipt.txt`.
- **Evidence:** copied fixtures under `B2-evidence/fixtures/`; jq-filtered decisive lines in `B2-evidence/logs/decisive.jsonl`.
- **Screenshots:** none persisted. Computer Use exposed the exact dialog text through mdpro's accessibility tree, but this runner did not provide a filesystem export for those captures; the UI observations are therefore paired with the proving JSONL lines below.

## Counts

**PASS 4 · FAIL 0 · NOT EXERCISED 1.** D246 H-1 and H-2 are counted separately.

## D246 H-1 — PASS

- Opened the clean copied fixture `B2-evidence/fixtures/d246-h1.md`.
- Ran the exact Bash sequence `rm <file>; sleep 0.2; printf 'changed…\n' > <file>` three times. After every try, mdpro displayed **External change detected — File was modified externally. Reload to update content?**; it never ended on Deleted.
- Try 1 logged `emitted_deleted` at 15:48:30.506 followed by `emitted_modified` at 15:48:30.714. Try 2 coalesced the remove observation after recreation and logged `emitted_modified` at 15:48:46.177. Try 3 logged `emitted_deleted` at 15:48:52.340 followed by `emitted_modified` at 15:48:52.546.
- Decisive lines: `B2-evidence/logs/decisive.jsonl`, first five records.
- Screenshot: none persisted; exact prompt text was observed in mdpro's accessibility tree on all three tries.

## D246 H-2 — PASS

- Opened `B2-evidence/fixtures/d246-h2.md`, changed it to mode `000`, and touched its mtime.
- mdpro displayed the Modified prompt, not Deleted.
- Decisive line: `file.watch.event` at 15:49:12.913, `outcome:"emitted_modified"`, `changeType:"modified"`, `unchangedCheck:"read_failed"`.
- Restored the fixture mode to `0644` immediately afterward.
- Screenshot: none persisted; exact Modified prompt text was observed in mdpro's accessibility tree.

## D171 re-smoke — PASS

- Opened `d171-a.md` and `d171-b.md`, kept `a` active, then appended `external d171 change` to `b` externally.
- No prompt appeared while `b` was in the background. Activating `b` displayed the Modified prompt.
- Pressing ⌘S before answering displayed `Save failed: the file changed on disk; reload or ignore that change before saving`; the save was blocked. Clicking Reload and then ⌘S succeeded.
- Decisive lines: 15:49:49.841 `file.change.received` `outcome:"recorded"`; 15:49:53.606 `outcome:"delivered"`; 15:49:56.689 `file.change.pending` `action:"save-blocked"`.
- Screenshot: none persisted; the prompt and save-blocked toast were observed in mdpro's accessibility tree.

## D178 — NOT EXERCISED

- First card-style try: while `d178-other.md` was active, appended to `d178-notes.md`, waited one second, then moved it to `d178-notes2.md`.
- Second scripted try: while the other tab was active, ran `printf >> d178-scripted.md; mv d178-scripted.md d178-scripted2.md` with no intervening sleep (well under 100 ms).
- Both activations produced a safe Deleted prompt; neither silently followed the rename. However, macOS emitted no `renamed` event and no `file.change.pending` record with `followed:true`, so the required path was not reached.
- Decisive lines: first try `emitted_modified` at 15:50:32.633 then `emitted_deleted` at 15:50:33.642; scripted try `emitted_deleted` at 15:52:15.973. Filtered count of `renamed`, `kind:"rename"`, or `followed:true`: **0**.
- Screenshot: none persisted; both Deleted prompts were observed in mdpro's accessibility tree.

## D101 record — PASS

- Opened `B2-evidence/fixtures/d101.md`, focused the document, appended one character and pressed ⌘S twenty times.
- All twenty saves logged `file.save` success. No External change prompt appeared.
- Watcher outcomes for this path: `self_write` **5**, `ignored_unchanged` **35**; matching `ui.dialog` reload prompts: **0**.
- Decisive summary: last record in `B2-evidence/logs/decisive.jsonl`.
- Screenshot: none; the final document remained visible with no prompt.

## Cleanup proof

- mdpro quit normally at 15:53:25; final log: `app.quit` success. `pgrep -lf 'mdpro.app/Contents/MacOS'` returned no process.
- `~/.mdpro/config.json` differed after the run, was restored from `B2-evidence/config-backup/config.json`, and `cmp` returned identical.
- `d246-h2.md` mode was restored from `000` to `0644`.
- The desktop GUI lock was released after this report was written.
- The verify worktree was left in place, unchanged. No commit or code fix was made.

## Surprises

- H-1 try 2 coalesced the remove so the remove event itself observed the recreated file and logged `emitted_modified`; the end-user result was still the required Modified prompt. Tries 1 and 3 logged the explicit Deleted → Modified sequence.
- The shared JSONL log contained synthetic-looking/interleaved quit-guard traffic with window labels such as `A`, `B`, and `w0`–`w7`, including seven error-level lines and one expected save-block warning. These did not come from the final `main`-window quit path and did not terminate PID 99412; the final main-window quit completed successfully.
- D178 reproduced the earlier platform limitation: both rename attempts surfaced safely as Deleted, but neither produced the `renamed` event needed to exercise `followed:true`.
