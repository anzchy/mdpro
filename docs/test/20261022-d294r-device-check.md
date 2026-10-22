# D294-R device check (Mac mini, 2026-10-22)

- **Build:** master `2d8d0f93`, D294-R, in `mdpro-wt/verify-2d8d0f9` on the mini, from `refs/verify/2d8d0f93…`. Variant A is the default (`hide_ack`); variant B was built with `--features d294-diag-no-hide`. The app shows 0.3.5 and `buildId` `"unknown"`, so the variant was confirmed from the first `window.close_order` line of each run.
- **Driven by:** claude-imple-1 through dtrack (rule 71), from the delegator's brief `~/.mdpro-redesign/device/D294R-brief.md`.
- **Full report:** `~/.mdpro-redesign/device/D294R-report.md`. Crash report: `~/.mdpro-redesign/device/D294R-dtrack/tauri-app-2026-10-22-135945.ips`.

**Result: the round cannot tell the variants apart.**

| Variant | Counted closes | Not exercised | Crashes | Sequence on every close |
|---|---|---|---|---|
| A, `hide_ack` (shipping default) | 16 | 0 | **1** | validate → hide → hide_ack → wait → complete, then `allowed_close` |
| B, `no_hide` (diagnostic only) | 16 | 0 | 0 | validate → wait → complete, with no hide line, then `allowed_close` |

- **The crash:** `EXC_BAD_ACCESS` at `0x638` on the main thread, top frame `WebKit::WebPageProxy::dispatchSetObscuredContentInsets`, about 14 ms after `allowed_close`. That is the same frame, address and timing as Phase B.
- **The acknowledgement changed nothing measurable.** `hide_ack` lands 0–1 ms after `hide`.
- **Pooled across every build that hides first:** 2 crashes in 46 counted closes, about 4 %. A count of 0 in 16 still fits a true rate of about 17 %.
- **B has a visible cost:** the emptied secondary window stays on screen for about 0.5–1 s before it closes.
- **Main window:** responsive after every close, and the unsaved sentinel was intact in every trial.

**Disposition:** the user's ruling before the round, 「One bounded test round, then B (Recommended)」, set what happens when the variants show no clear difference: v0.3.6 ships with a Known issues line, the D294 fix-by is 0.3.7, a report goes upstream, and an ADR records the decision. See the D294 row.
