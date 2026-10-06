# Migrating mdpro work to a remote Mac over Tailscale

**Status:** runbook, written 2026-10-04 for the WI-0.4 device-test handoff to `mac-mini`. It is reusable for any session that moves in-flight work from the MacBook to another Mac on the tailnet.

**Default target:** `mac-mini`, an SSH alias for `jack@jacks-mac-mini` (100.124.189.67). The checkout lives at **`/Users/jack/Documents/mac-app/mdpro`**.

Connection details and SSH failure causes are in the `remote-ssh` skill (`.claude/skills/remote-ssh/SKILL.md`, added on `frontend-backend-redesign` in `1f8e012`; `docs/stage-0-redesign` branched before it, so it appears here only after the merge). This doc does not repeat them.

---

## 1. Before you migrate: what can and cannot move

| Moves cleanly | Does not move |
|---|---|
| Commits, branches, fixtures, scripts, docs (git over SSH) | **Before/after screenshot pairs.** E5 requires the same window size *and* backing scale. Choose one machine per series and keep it for every later "after" shot. The mini is 1920×1080 **@1x**; the MacBook is **@2x**. |
| Evidence under `~/.mdpro-redesign/` (rsync) | **E5 computed-style JSON diffs** across machines. Compare only captures from the same machine. A remote that runs a Stage 1–2 gate recaptures its own baseline first. |
| The gitignored MCP sidecar binary (scp) | **Peer-session messaging.** SendMessage to a local session goes through a uds socket on that machine, so a remote session can't reach it. Results come back through git, and the MacBook session relays them. |
| | `~/.mdpro/` (logs, drafts, preferences). It is machine-local by design; don't copy it. |
| | macOS privacy grants (TCC). Grant them again on the remote (§3.4). |

---

## 2. Preflight (from the MacBook)

```bash
tailscale status | head            # the target must not be "offline"
route -n get 100.124.189.67 | grep interface   # must be a Tailscale utun, not Clash (198.18.0.1)
ssh -o BatchMode=yes -o ConnectTimeout=10 mac-mini 'hostname; whoami'   # → jacks-Mac-mini.local / jack
```

On failure, use the table in the `remote-ssh` skill. Never pass `StrictHostKeyChecking=no`.

---

## 3. What the remote Mac needs

Check each item over SSH. Prefix commands with `export PATH=/opt/homebrew/bin:$HOME/.cargo/bin:$PATH;`, because a non-interactive SSH shell doesn't load the brew PATH.

### 3.1 Toolchain

| Need | Check | Install |
|---|---|---|
| Xcode Command Line Tools | `xcode-select -p` | `xcode-select --install` (opens a GUI prompt on the remote) |
| Node | `node --version` | `brew install node` |
| pnpm 10.26.1 (pinned by `packageManager`) | `pnpm --version` | `corepack enable`. Corepack then provides the pinned version; never use npm or yarn |
| Rust stable | `rustc --version` | `brew install rustup && rustup-init -y --default-toolchain stable` |
| Free disk | `df -h ~` | `node_modules` plus `src-tauri/target` need roughly 5–10 GB |

### 3.2 Claude Code and user-level skills

The repo brings its own `.claude/` (rules, project skills such as `gui-acceptance`, `gui-manual-verify` and `remote-ssh`). User-level pieces must already exist on the remote:
- Claude Code itself (`claude --version`).
- gstack with `/browse` (`~/.claude/skills/gstack/browse/dist/browse`), and `plan-design-review`.
- The plugins tdd-guardian, nlpm and cc-suite (`jq -r '.plugins|keys[]' ~/.claude/plugins/installed_plugins.json`).

If one is missing, install it on the remote the same way it was installed locally. Don't copy `~/.claude/` wholesale, because it holds machine-specific state.

### 3.3 Repo-adjacent files git doesn't carry

- `src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` is the MCP sidecar. It is gitignored and `pnpm tauri build` needs it. Copy it with scp (§4.3).
- Evidence directories under `~/.mdpro-redesign/`. Copy them with rsync (§4.3).

### 3.4 GUI prerequisites (device tests only)

**The user has to do these at the remote, in person or through Screen Sharing.** None of them can be done over SSH.

1. **Run Claude Code from Terminal.app inside the logged-in console session.** A process started over SSH has no Screen Recording or Accessibility grant, so `screencapture`, System Events keystrokes and computer use all fail.
2. Give that terminal **Accessibility** and **Screen Recording** in System Settings › Privacy & Security. Approve computer-use access for mdpro when Claude asks.
3. Turn on **System Settings › Keyboard › Keyboard navigation**. Without it, WKWebView skips buttons when tabbing, and focus-ring rows can't be shot.
4. Set the input source to **ABC** before any Esc check. IMEs swallow the Escape keydown (ADR-0048), and computer-use `key escape` sends only a keyup. The user presses Esc and clicks Discard personally.
5. Record the display (`system_profiler SPDisplaysDataType | grep -E "Resolution|UI Looks like"`). Write its scale (@1x or @2x) into Appendix B next to every shot.

---

## 4. Moving the work

### 4.1 Why not GitHub

Work in flight is not pushed to origin, and commits for the redesign must not land on GitHub before review. The remote may also have no GitHub credentials (the mini doesn't: gh login fails and SSH to GitHub is denied). Pushing straight to the remote over Tailscale SSH avoids both problems.

### 4.2 Code

```bash
# remote: an empty repo with a placeholder branch, so pushing real branches never hits denyCurrentBranch
ssh mac-mini 'mkdir -p ~/Documents/mac-app && git init -b handoff-init ~/Documents/mac-app/mdpro'

# MacBook (main checkout): a named remote for the device, then push the branches the work needs
git remote add mac-mini ssh://mac-mini/Users/jack/Documents/mac-app/mdpro
git push mac-mini master frontend-backend-redesign docs/stage-0-redesign

# remote: check out the work branch, keep a GitHub origin for later, and verify
ssh mac-mini 'cd ~/Documents/mac-app/mdpro && git switch docs/stage-0-redesign \
  && git remote add origin https://github.com/anzchy/mdpro.git \
  && git log --oneline -1'
```

Compare the remote's `git log -1` SHA with the MacBook's. The `handoff-init` placeholder has no commits, so nothing needs deleting.

**Worktrees on the remote:** the remote clone serves one job, so the work branch can be checked out directly. If the remote needs parallel work, follow CLAUDE.md § Worktrees relative to the remote checkout (`~/Documents/mac-app/mdpro-wt/`).

### 4.3 Non-repo state

```bash
scp src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin \
    mac-mini:Documents/mac-app/mdpro/src-tauri/binaries/
rsync -a ~/.mdpro-redesign/ mac-mini:.mdpro-redesign/
```

After the rsync, rename any evidence that stays bound to the MacBook (e.g. `shots/` → `shots-macbook-2x/`), so nobody pairs it with remote shots.

### 4.4 Build on the remote

```bash
ssh mac-mini 'export PATH=/opt/homebrew/bin:$HOME/.cargo/bin:$PATH; cd ~/Documents/mac-app/mdpro \
  && pnpm install --frozen-lockfile && pnpm tauri build --bundles app'
```

The release app is `src-tauri/target/release/bundle/macos/mdpro.app`. Before any device test, go through the three traps in [`gui-acceptance` §3](../../.claude/skills/gui-acceptance/SKILL.md):
- launch by absolute path;
- check that the bundle postdates the source;
- check that a cold launch logs `appReady:false`.

---

## 5. Bringing the work back

**Division of labour (user decision, 2026-10-06):** the remote does **real-device tests only**, meaning work that needs its display, GUI session or WKWebView. All development happens on the MacBook: code, scripts (including `scripts/redesign/snapshot.js`), and plan and doc edits.
- The remote writes its results to a report **outside the repo**: `~/.mdpro-redesign/<stage>/reports/<date>-<topic>.md`.
- The MacBook reads that report over SSH and writes it into the repo docs.
- When the remote needs a MacBook change, the MacBook pushes it to a temporary branch on the remote (`git push mac-mini <branch>:refs/heads/macbook-sync`). The remote fast-forwards with `git merge --ff-only macbook-sync`, then deletes the temporary branch.

1. If the remote does have a commit to make (device evidence metadata only), it commits on the same branch, with explicit-path `git add` and the user's approval, and **does not push anywhere**.
2. The MacBook pulls it: `git fetch mac-mini docs/stage-0-redesign`, reviews `git log`/`git diff` against its own branch, then fast-forwards or merges.
3. The MacBook session reports to peer sessions (e.g. mdpro-delegator), because the remote can't.
4. Screenshots and other evidence stay in `~/.mdpro-redesign/` on the machine that took them. Commit only paths and metadata (Appendix B), never images.

---

## 6. Caveats

- **Untracked copies block later merges.** Copying a file that is untracked in the main checkout into a commit makes `git merge` refuse with "untracked working tree files would be overwritten". Diff the main copies against the committed versions, move the main copies aside once the user confirms, and then merge. Never `rm -r` them.
- **Rule 25 applies on the remote too.** Destructive commands need the same AskUserQuestion confirmation, whatever machine they run on.
- **Never print the MCP token.** On the remote it lives at `~/Library/Application Support/mdpro/server.token`; use `mcurl.sh`.
- **Don't copy `~/.mdpro/`.** It would carry the MacBook's drafts and recent-files list into the remote's app state.

---

## 7. Verification checklist

- [ ] The preflight in §2 passes.
- [ ] Every tool in §3.1 reports a version on the remote.
- [ ] The remote's `git log -1` matches the MacBook, and `git diff a5767d5 -- src src-tauri/src` gives the same answer on both (empty for the Stage 0 baseline).
- [ ] The sidecar exists on the remote, and `pnpm tauri build --bundles app` exits 0.
- [ ] GUI smoke test from the console-session Claude:
  - a cold launch logs `appReady:false`;
  - `scripts/redesign/device/theme.sh Dark` switches the theme;
  - `scripts/redesign/device/shot.sh probe-dark` writes a PNG whose size is the window size × the display scale (1200×800 px on the mini).
- [ ] Round trip: `git fetch mac-mini` from the MacBook succeeds.
