# Progress & Lessons Learned

## 2026-02-18 — Image Paste Feature Bugs

### Bug 1: Existing images not rendering in WYSIWYG mode

**Symptom:** Opening a `.md` file with `![](./assets/test-image.png)` in WYSIWYG mode (⌃4) showed a broken image — the PNG was not displayed.

**Root Cause:** Three missing pieces for the Tauri 2 asset protocol:

1. **`tauri.conf.json`** — Missing `assetProtocol` config. `convertFileSrc()` generates `asset://localhost/...` URLs, but the webview won't serve local files unless `assetProtocol.enable: true` and a `scope` are set.
2. **`Cargo.toml`** — Missing `protocol-asset` feature on the `tauri` dependency. Without it, Tauri's build script rejects the `assetProtocol` config.
3. **CSP** — Missing `https://asset.localhost` in `img-src`. Tauri 2 uses `https://asset.localhost` internally for the asset protocol.

**Fix:**
- `src-tauri/tauri.conf.json`: Added `"assetProtocol": { "enable": true, "scope": ["**/*"] }` and `https://asset.localhost` to CSP `img-src`.
- `src-tauri/Cargo.toml`: Added `"protocol-asset"` to tauri features.

**Lesson:** In Tauri 2, displaying local images via `convertFileSrc()` requires **three** things in sync:
1. `tauri.conf.json` → `security.assetProtocol.enable: true` + `scope`
2. `Cargo.toml` → `tauri` dependency must include `"protocol-asset"` feature
3. `tauri.conf.json` → CSP `img-src` must include `asset:` and `https://asset.localhost`, and on Windows also `http://asset.localhost` — Tauri 2 serves the asset protocol there over `http` unless `useHttpsScheme` is set (D190-WI-3)

Missing any one of these silently fails — the `<img>` tag gets a valid-looking `asset://` URL but the webview returns 403 or blocks the request.

---

### Bug 2: Image paste fails with `missing required key documentPath`

**Symptom:** Pasting a PNG in WYSIWYG mode showed toast: `Failed to paste image: invalid args documentPath for command upload_image : command upload_image missing required key documentPath`.

**Root Cause:** `src/services/imageService.ts` passed **snake_case** keys to `invoke()`:

```typescript
// WRONG — Tauri 2 expects camelCase
invoke("upload_image", { document_path: documentPath, image_data: imageData })

// CORRECT — Tauri 2 auto-converts camelCase → snake_case for Rust params
invoke("upload_image", { documentPath, imageData })
```

Tauri 2 changed the IPC serialization convention. The JS-side `invoke()` args must use **camelCase** keys. Tauri automatically converts them to **snake_case** when deserializing into Rust `#[tauri::command]` function parameters.

The existing working commands (e.g., `fileService.ts`) already used camelCase (`actionId`, `documentId`), but the image commands were written with snake_case — likely copied from the Rust function signatures.

**Fix:** Changed all `invoke()` calls in `imageService.ts` to use camelCase keys:
- `document_path` → `documentPath`
- `image_data` → `imageData`
- `asset_folder` → `assetFolder`
- `image_path` → `imagePath`
- `source_path` → `sourcePath`

Affected functions: `resolveImagePath`, `uploadImage`, `uploadImagesBatch`, `copyExternalImage`.

**Lesson:** When writing Tauri 2 IPC wrappers, always use **camelCase** keys in `invoke()` args, even though the Rust function uses snake_case parameters. Look at existing working commands in the same project as reference — don't copy from Rust signatures.

**Prevention:** Added unit tests (`markdown-editor-core.test.ts`) that verify the exact invoke arg keys for all image service functions.

---

## 2026-03-22 — Cross-Platform Line Ending (CRLF vs LF)

### Symptom

After pulling commits from the Mac device onto the WSL device, `git status` showed 46 modified files. `git diff --stat HEAD` showed identical insertion/deletion counts (19,837 each) — a strong signal that content is unchanged but every line differs.

### Root Cause

The Mac commits used **LF** line endings. The WSL device had files with **CRLF** line endings (Windows default). Git saw every line as "modified" because `\n` ≠ `\r\n`.

`git pull` updates the index but **never overwrites unstaged local changes** — so the CRLF local files persisted after the pull, appearing as modifications against the LF-committed versions.

### Diagnosis Commands

```bash
git diff --stat HEAD          # Same insertions = deletions → line ending issue
file src/App.tsx              # "CRLF line terminators" confirms it
xxd src/App.tsx | grep "0d 0a"  # Hex: 0d = CR, 0a = LF
```

### Fix (one-time recovery)

```bash
git checkout -- .   # Restore all tracked files to committed LF versions
```

### Permanent Fix

Added `.gitattributes` to enforce LF on all text files for all platforms:

```gitattributes
* text=auto eol=lf
*.png binary
*.dmg binary
# ... other binaries
```

Re-normalize all existing files:

```bash
git add --renormalize .
git commit -m "chore: add .gitattributes to enforce LF line endings"
```

### Lesson

**When developing across Mac + WSL/Windows:**
1. Always add `.gitattributes` with `* text=auto eol=lf` at project start.
2. Never rely on per-developer `core.autocrlf` settings — they're invisible and easy to forget.
3. When you see mass "modified" files after a pull with equal insertions/deletions, suspect line endings first.
4. `git checkout -- .` is safe when you know the committed version is correct.

---

## A commit cannot record its own SHA (2026-09-23, D16 WI-4)

**Symptom.** The D16 sequencing row briefly recorded `ac99c4a` for WI-4 while
the branch actually held a different commit. Worse, `git log ac99c4a` still
*resolved* — to the orphaned pre-amend commit — so the reference looked valid
and pointed at a commit nobody had.

**Root cause.** CLAUDE.md requires a work item's status row to be updated *in
the same commit that finishes it*, and the row convention carries commit SHAs.
Those two rules collide for a self-record: the SHA is only known after the
commit exists, and amending the commit to insert it changes the SHA again.
Commit → read SHA → `sed` → `--amend` feels like it closes the loop, but it
writes the *previous* hash every time.

**Rule.** A row may cite a SHA only for a commit that already exists — i.e. a
*late* record such as WI-5 / WI-8. When a row records the commit it is part of,
reference it as `本行所在提交` and let `git log` supply the hash. Never run the
commit-then-amend-the-SHA dance; it cannot converge.

**Check.** Before committing a row edit, resolve every SHA in it and confirm the
commit is an ancestor of `HEAD` (`git merge-base --is-ancestor <sha> HEAD`).
Plain `git log <sha>` is not enough — it happily resolves orphans.

---

## A passing jsdom keydown test is not device evidence, and a 60 s budget needs one-step checks (2026-09-30, ADR-0042 WI-10)

**Symptom.** In the real app, Esc dismissed neither `McpWriteConfirmDialog` nor
the older `ConfirmDialog` ("Unsaved changes"), although both have a card-level
`onKeyDown` Escape branch whose jsdom tests pass (D34). In the same run,
several confirmation prompts timed out (`408`) before the answering click
landed.

**Root cause.**
- **(a)** A jsdom test dispatches the keydown at an element it chooses. It
  proves the handler works *when the event reaches it*. It says nothing about
  whether focus is inside the card in WKWebView. On device a physical Esc
  never reached either card's `onKeyDown`. The harness produced two false
  signals on the way:
  - Harness-injected keys are not the same event path as a physical keypress.
  - `osascript` System Events keystrokes go to the **frontmost app**. That was
    the terminal (Warp), not mdpro.
- **(b)** The agent's turn latency (~60 s) was as long as the confirmation
  budget. A check that fires the trigger in one turn and answers in the next
  lands after the timeout.

**Rule.**
- Keyboard behaviour in a dialog is settled only by a **physical keypress on
  device**, with the log line it should produce (`ui.dialog.cancel`) as
  evidence. Record injected or `osascript` keys as NOT VERIFIED, never as a
  pass or a fail.
- For GUI QA against a time budget, **batch the trigger, the answer and the
  evidence capture in one step**. Plan the run around the agent's turn latency,
  not the human's reaction time. Record a timeout caused by the harness as
  harness timing, not as a defect.

---

## A `.resolves` on RTL's `act()` thenable resumes before the awaited IPC rejects (2026-10-12, D184 second round)

**Symptom.** A hook test asserted `expect(act(() => result.current.save())).resolves.toBeUndefined()`
and passed, while the production path it covered threw: the mocked `invoke`
rejected, the hook caught nothing, and the error surfaced only in a later
`unhandledrejection` that vitest attributed to the *next* test file.

**Root cause.** `act()` from `@testing-library/react` returns a thenable, not a
native promise. Vitest's `.resolves` wraps it with `Promise.resolve()`, which
adopts the thenable's `then` callback as soon as the React work inside `act`
has flushed. The `await invoke(...)` inside the callback is still pending at
that point, so the assertion settles before the rejection exists. The test
proved only that `act` finished, not that `save()` resolved.

**Rule.**
- Await the action itself, then assert: `await act(async () => { await result.current.save(); })`,
  with the error-path test wrapping that in `await expect(...).rejects`.
- If a `.resolves` / `.rejects` on an `act()` call is unavoidable, pass it
  through `Promise.resolve(act(...))` first so the promise chain includes the
  awaited work, and make sure the test fails when the hook's catch is removed.
- A `.resolves` that cannot be made to fail by deleting the code under test is
  a wiring assertion. Treat it as red that never went red.

---

## Format before you record: a Rust red recorded on unformatted files cannot survive the fmt lane (2026-10-12, D173 commit 1 → D187)

**Symptom.** After `cargo fmt`, the tdd-guardian verify step reported the
recorded red spec files as changed in 8 of 9 Rust files, although no test had
been edited. The only option left that kept both lanes green was
`#[rustfmt::skip]` on those modules, freezing them unformatted.

**Root cause.** `receipt.js record` fingerprints a recorded test file by its
whole-file sha256. `cargo fmt` rewrites line layout, so a file recorded before
formatting never matches again. The line-subsequence fallback tolerates
*added* lines, not reflowed ones. Nothing in the record step checks that the
file is already `rustfmt`-clean.

**Rule.** Run `cargo fmt` on the test files **before** `receipt.js record`,
and never run it between record and verify. Until D187 makes `record` refuse
an unformatted `.rs` file, this is a manual step in every Rust red.
