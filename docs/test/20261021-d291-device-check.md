# D291 device check (Mac mini, 2026-10-21)

- **Build:** master `0d34b465`, which has D291 at `958061e8`. Built in `mdpro-wt/verify-0d34b46` on the mini from `refs/verify/0d34b465` (0.3.5).
- **Driven by:** claude-imple-1 through dtrack (rule 71), from the delegator's brief `~/.mdpro-redesign/device/D291-brief.md`.
- **Full report:** `~/.mdpro-redesign/device/D291-report.md`. Raw dtrack reports and screenshots are under `~/.mdpro-redesign/device/D291-dtrack/`.

**Result:** PASS 1 · FAIL 2 · NOT EXERCISED 1.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | WYSIWYG: `q` right after the last Recover | **FAIL, 1 of 3 tries** | 2 of 3 tries landed (`contentLength 17→18` 236 ms after the click). In one try, a `q` sent in the same input batch as the click was lost while placement was still pending, with no `ui.recovery.focus.cancel`. Master loses that key every time. Follow-up: [D300](../plans/20260912-frontend-backend-sequencing-order.md#d300) |
| 2 | Source: key lands at the live selection | **PASS** | `file.draft.recover {"outcome":"ok"}`, no cancel. `q` at line 1 col 0, the live selection, not the end. The tab is dirty. The draft stores no caret, so the pre-crash caret can't be restored |
| 3 | Draft whose file is open in a background tab | **FAIL as written, setup invalid** | `file.draft.recover status:"fail" {"outcome":"in_use"} error:"OpenInWindow"`. The backend refuses Recover for a file open in that window, by design (`services/draft/guarded.rs`, ADR-0038). So the D146/D151 merge path the card targeted was never reached, and `q` went into A. The refusal was silent, and the draft later vanished: [D299](../plans/20260912-frontend-backend-sequencing-order.md#d299) |
| 4 | Click elsewhere cancels the hand-off | **NOT EXERCISED** (3 tries) | No `reason:"moved"` line. A 5 MB document degraded first and cancelled as `switched`. A 3.6 MB WYSIWYG placement blocked the page for about 7.2 s, so the click wasn't processed while the request was armed. Unit coverage: `tests/d291-recovery-focus-lifecycle.test.tsx` F-5 |

**Also observed:**
- A successful hand-off writes no log line (D300).
- The large-document degrade cancels the hand-off (D300).
- After ⌘N the editor takes no typing until clicked (D292).
