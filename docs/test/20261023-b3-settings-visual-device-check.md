# Device check B3: Settings and visual, Mac mini, 2026-10-23

Committed by herdr-delegator from the tester's report (gpt-imple-3, Codex Computer Use). Build: the same verify build
of master `ed958b26` as B1 and B2, launched by exact path, `releaseId:"unknown"`. Screenshots are window captures
(`screencapture -l`), kept on the mini under `~/.mdpro-redesign/device/B3-evidence/screenshots/`.

## Delegator's check against the cards

| Item | Verdict | Note |
|---|---|---|
| D258 | **PASS** | 2px ring on Tab focus in both themes (checked the light window capture) |
| WI-4.3b states | **PASS** (load failure, save failure + rollback); "Loading…" not observable | failure forced with mode `000`; the brief's `chmod 444` does not fail an atomic replace, so it is not a valid failure setup |
| D260, D262, D257, D227 | **PASS** (re-smokes) | see sections 3–6 |
| D222 (Mac) | **PASS**, 5.209:1 | flat-area pixel sample of the window capture (`#2354C1` on `#D9E2F9`), replacing the earlier 4.13 whole-screen sample |

---

## Tester's report (verbatim)

# B3 report: Settings and visual, Mac mini (gpt-imple-3, 2026-10-23)

- **Build:** existing `/Users/jack/Documents/mac-app/mdpro-wt/verify-ed958b2/src-tauri/target/release/bundle/macos/mdpro.app`, master `ed958b26f69b7b8a0d8c1ea608056d5f6dbdbf6d` (no rebuild).
- **Run:** 2026-10-23 16:02:15–16:14:25 +08:00. One launch, by the exact path in the brief.
- **Identity proof:** before any UI step, `pgrep -lf 'verify-ed958b2/.*/mdpro.app/Contents/MacOS'` showed exactly PID `71534`; the all-mdpro query showed only that process. The newest ready line was:
  - `{"ts":"2026-10-23T16:02:15.731+08:00","event":"app.ready","status":"success","context":{"appVersion":"0.3.5","buildId":"unknown","pid":71534,"platform":"macos","releaseId":"unknown","startupTimeMs":182}}`
- **Screenshot method:** `screencapture -l 7182` against the mdpro window ID returned by `CGWindowListCopyWindowInfo`. Only the `*-window.png` files below are cited. Pixel measurements decoded those PNGs into canonical 8-bit sRGB and used WCAG relative luminance.
- **Evidence root:** `/Users/jack/.mdpro-redesign/device/B3-evidence/`.

## Counts

**PASS 7 · FAIL 0 · NOT EXERCISED 0.** The transient `Loading…` state was not observable; the brief explicitly conditions that check on observability.

## 1. D258 — Settings select focus ring

**Verdict: PASS.**

Steps actually run:

1. Opened Settings → General in light theme.
2. Mouse-clicked Default View Mode, closed its popup, and captured the focused select.
3. Used Shift-Tab then Tab to return keyboard focus to that select and captured it.
4. Repeated both paths in dark theme.

Pixel scan:

- Light: the keyboard-focus image contains solid `#2563EB` bands across rows 296–297 and 323–324 around the control: a 2 px ring. Dark contains the corresponding solid `#60A5FA` band.
- WebKit painted the same ring after a mouse click in both themes; the mouse and keyboard crops had the same 886 solid ring pixels. This is recorded rather than treated as a failure because B3's stated failure condition is no ring on Tab.

Screenshots:

- `B3-evidence/screenshots/d258-light-keyboard-focus-window.png`
- `B3-evidence/screenshots/d258-light-mouse-focus-window.png`
- `B3-evidence/screenshots/d258-dark-keyboard-focus-window.png`
- `B3-evidence/screenshots/d258-dark-mouse-focus-window.png`

## 2. WI-4.3b — Settings loading, load failure, save failure and rollback

**Verdict: PASS.**

Steps actually run:

1. Opened Settings repeatedly on normal config; loading completed before Computer Use could observe an intermediate frame, so `Loading…` was not observable.
2. Set `config.json` to mode `000` temporarily and opened every Settings category. General, Editor, Markdown, Image, Export, Appearance and Keyboard Shortcuts showed exactly `Failed to load preferences. Please close and reopen settings.` with no path or raw backend error. Integrations, Advanced and About do not use that preferences-read path and continued to render their own content.
3. With the same deliberate I/O failure, selected Light while dark was saved. Exactly one `Failed to save preferences` toast appeared and the UI stayed dark, proving rollback to the saved value.
4. Repeated the brief's requested `chmod 444` setup separately. That did **not** make the write fail: the atomic writer replaced the file, returned success, changed its mode back to `0600`, and the select kept the newly saved Source value. The actual failure/rollback behavior was therefore exercised with mode `000`, then the backup was restored.

Decisive log lines:

- `preferences.read` `fail`, `purpose:"settings_general"`, `reason:"invoke_rejected"` at `16:13:24.257` (paired with the fixed UI message).
- `preferences.set` `fail`, `error:"IoError"`, action `3870d400-786c-411a-888d-bdb3f422051d` at `16:13:32.069`.
- `ui.preferences.save` `fail`, `reason:"invoke_rejected"`, action `f3cd3871-c322-42fe-ad45-c117b21baa9a` at `16:13:32.080`.
- The `chmod 444` control run instead logged `preferences.set` `success`, action `93900a45-06c7-4535-a942-fd6493ee949f`, at `16:06:04.247`.

Screenshots:

- `B3-evidence/screenshots/wi43b-load-failure-light-window.png`
- `B3-evidence/screenshots/wi43b-load-failure-dark-window.png`
- `B3-evidence/screenshots/wi43b-save-failure-rollback-dark-window.png`

## 3. D260 — Settings rail

**Verdict: PASS.**

Steps actually run:

1. Inspected the rail in both themes: monochrome outline icons, neutral selected row, normal-weight label, and no footer Close button.
2. Tab focus used an inset ring without changing the selected row's neutral fill.
3. Closed once with header × and once with Escape.

Decisive log lines:

- `ui.button.click` success with `controlId:"settings.close"`, action `d0f1831e-a695-4b06-9b28-f3629ffe0770`.
- `ui.dialog.cancel` success with `controlId:"settings.dialog.escape"`, action `fe9c9d2f-6b85-4aa4-969a-2f1afd4d767e`.

Screenshots: the four D258 window images above show the rail in both themes, including its selected state and absence of a footer.

## 4. D262 — short-window Settings scrolling

**Verdict: PASS.**

Steps actually run:

1. Dragged the bottom window edge upward. macOS/mdpro clamped the window at `1200×640` rather than the brief's approximate 500 px height.
2. Opened About from the bottom of the rail; it was fully reachable and visible with no rail item clipped. At this Mac minimum height the full rail fits, so rail overflow was not needed.
3. Opened the long Keyboard Shortcuts page and scrolled several pages down. The page scrollbar moved and later Format/View rows became visible while the rail remained intact.

Screenshots:

- `B3-evidence/screenshots/d262-short-dark-about-visible-window.png`
- `B3-evidence/screenshots/d262-short-dark-page-scrolled-window.png`

## 5. D257 — Settings error text contrast

**Verdict: PASS.**

Steps actually run:

1. In Keyboard Shortcuts, changed New to `Cmd+Shift+N`, deliberately conflicting with New Window.
2. Captured the conflict bar in both themes and clicked Save; Save was refused.
3. Discarded the temporary shortcut change.

Pixel measurements:

- Light solid glyph `#B91C1C` on flat fill `#FAE5E5`: **5.362:1**.
- Dark solid glyph `#F87171` on flat fill `#3D282F`: **4.920:1**.

Decisive log line:

- `ui.settings.shortcuts.save` with `context:{"refusing":1,"status":"refused"}`, action `da9def87-4e17-4329-b9ad-bfdaa24a2ae7`.

Screenshots:

- `B3-evidence/screenshots/d257-shortcut-conflict-light-window.png`
- `B3-evidence/screenshots/d257-shortcut-conflict-dark-window.png`

## 6. D227 — form-control border contrast

**Verdict: PASS.**

Steps actually run:

1. Inspected General selects, the Insert Link URL input, and Insert Table's Rows/Cols controls in both themes.
2. Also inspected the CodeMirror Find/Replace fields in both themes. The cited window captures use the table and link controls; the D258 captures cover Settings selects.

Pixel measurements on the unfocused Cols control in Insert Table:

- Light border `#8C8C8C` against input fill `#FFFFFF`: **3.363:1**.
- Dark border `#7A7C80` against input fill `#0F1115`: **4.519:1**.

Screenshots:

- `B3-evidence/screenshots/d227-link-input-light-window.png`
- `B3-evidence/screenshots/d227-link-input-dark-window.png`
- `B3-evidence/screenshots/d227-table-input-light-window.png`
- `B3-evidence/screenshots/d227-table-input-dark-window.png`

## 7. D222 — light accent-text contrast

**Verdict: PASS.**

Steps actually run:

1. Created a temporary heading in mdpro, selected it in the Outline sidebar, and captured the light-theme selected row.
2. Sampled the most frequent solid accent glyph pixel and the flat selected-row fill from the mdpro-only window PNG.

Pixel measurement: foreground `#2354C1` on fill `#D9E2F9`: **5.209:1**, above 4.5:1. This avoids the earlier whole-screen/anti-aliased-edge sampling error.

Screenshot: `B3-evidence/screenshots/d222-accent-text-light-window.png`.

## Cleanup proof

- The temporary heading was saved only to the allowed evidence root as `B3-evidence/temporary-accent.md`; `file.save` logged success for that exact path at `16:14:12.415`.
- After mdpro quit, `cmp /Users/jack/.mdpro-redesign/device/B3-evidence/config-backup/config.json /Users/jack/.mdpro/config.json` returned 0.
- Restored config mode: `-rw-------` (`0600`); restored size/mtime: 5808 bytes, `2026-10-20T13:26:23+0800`.
- `pgrep -lf 'mdpro.app/Contents/MacOS'` returned no process after quit; log: `app.quit` success at `16:14:15.977`.
- `$HOME/.cache/desktop-gui.lock` was removed after the process check and config restore.
- The verify worktree and build were left in place. No repository file was changed, no code was fixed, and nothing was committed.

## Surprise

`chmod 444 ~/.mdpro/config.json` does not make preference saving fail in this build. The writer replaces the file atomically and leaves a new `0600` file. The failure/rollback UX itself passed when exercised with mode `000`; the brief's proposed `444` failure setup is not effective on this implementation.
