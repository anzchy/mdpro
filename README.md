<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="mdpro" width="128">
</p>

# mdpro

**A local Markdown editor with Typora-style WYSIWYG, ready for AI through MCP.**

Local files only. No account, no cloud. Your Markdown stays the Markdown you wrote.

mdpro edits `.md` files on your disk in two views, a rich-text WYSIWYG view and a
source view, and lets AI assistants such as Claude Code read and edit the documents
you have open, with your approval. Built with Tauri 2, React and Rust.

**[Download](https://github.com/anzchy/mdpro/releases)** · **[Changelog](CHANGELOG.md)** · **[Feature ledger](docs/feature-ledger.md)** · **[MCP guide](docs/guide/mdpro-mcp-guide.md)**

---

## Highlights

- **Two views of one file**: WYSIWYG (Milkdown) and Source (CodeMirror 6). `⌘/` switches
  between them, `⌃4` / `⌃2` go straight to one. In WYSIWYG, links and inline code show
  their Markdown when the cursor enters them (`⌃` `` ` `` toggles it by hand).
- **Your Markdown survives editing** (0.3.2): empty paragraphs are saved as blank lines,
  the way Typora writes them, not as `<br />`; inline `<br>` tags and reference-link
  definitions are kept.
- **Tables**: insert dialog, a right-click menu to insert, delete and move rows and
  columns, column alignment, Tab / Shift-Tab between cells, column resizing in WYSIWYG,
  and tables tidied on save.
- **Images**: paste or drag an image in and it is saved to an `assets/` folder next to
  the document; right-click to resize (25–100 % or a custom width), written back to
  the Markdown.
- **Never lose work**: drafts are saved every 30 seconds and offered back after a crash;
  saves are atomic; quitting with unsaved changes asks first.
- **No silent overwrites** (0.3.2): a file changed outside mdpro raises "External change
  detected", also in background tabs, in other windows and under another spelling of the
  same path (a symlink, `/tmp` versus `/private/tmp`). ⌘S will not write over it until
  you choose Reload or Ignore.
- **Tabs and windows**: several documents per window in a bottom tab bar, several
  windows (`⌘⇧N`), and an outline sidebar (`⌘⇧L`).
- **Encodings kept**: UTF-8, UTF-16 (with BOM) and other encodings are detected on open
  and kept on save, line endings included.
- **HTML export** (`⌘⇧E`): a standalone, styled HTML file, with math (as MathML),
  footnotes, GFM, autolinks and emoji.
- **AI through MCP**: Claude Desktop, Claude Code, Codex CLI and Gemini CLI can list,
  read, write and insert into your open documents.
- **Themes**: light, dark or follow the system; editor font, size, line height and
  content width in Settings (`⌘,`).
- **In-app updates**: Settings → About checks for a new version, downloads it and
  restarts into it.

Several of these are marked Partial in the **[feature ledger](docs/feature-ledger.md)**,
the full inventory of what each feature does today; each such row names its limit, and
the ones you are likely to meet are listed under [Known limits](#known-limits).

---

## Install

**macOS** (13 or later): download from the
[Releases page](https://github.com/anzchy/mdpro/releases).

- Apple Silicon: `mdpro_x.y.z_aarch64.dmg`
- Intel: `mdpro_x.y.z_x64.dmg`

If macOS refuses to open the app after download, clear the quarantine flag:

```bash
sudo xattr -dr com.apple.quarantine /Applications/mdpro.app
```

**Windows** (since 0.3.2): `mdpro_x.y.z_x64-setup.exe` from the same page. Shortcuts use
Ctrl in place of ⌘.

**Linux**: `.deb`, `.rpm` and AppImage packages are attached to each release, but they
are untested.

---

## AI Integration (MCP)

mdpro runs a local server for the [Model Context Protocol](https://modelcontextprotocol.io)
and ships a companion binary, `mdpro_mcp`, that AI clients start.

1. **Settings → Integrations → Enable MCP Server.**
2. **Install** next to your client: Claude Desktop, Claude Code, Codex CLI or Gemini CLI.
   mdpro writes that client's config file for you.

Or add it by hand, for example with Claude Code:

```bash
claude mcp add mdpro -s user -- /Applications/mdpro.app/Contents/MacOS/mdpro_mcp
```

**Tools:** `get_open_documents` · `read_document` · `write_document` · `insert_content`

mdpro must be running. A write goes through at once only while the window holding that
document is focused; otherwise the window asks you to **Approve** or **Reject** it, and
an unanswered request times out after 60 seconds.

See the **[MCP guide](docs/guide/mdpro-mcp-guide.md)** for every client's config file,
the tool reference and the local HTTP API.

---

## Known limits

- WYSIWYG does not typeset math or render footnote links; they work in HTML export.
  `$…$` and `[^1]` stay as plain text in the editor.
- Find and replace (`⌘F`) works in Source view only.
- A reference-style link such as `[docs][r]` is saved as an inline link after an edit;
  the definition line itself is kept.
- Leading and trailing empty paragraphs of a document, quote or list item are not saved.
- Shortcut remapping in Settings is not wired up yet.
- Files larger than 10 MB are refused; very large documents open in Source view.
- No PDF or Word export, no cloud sync, no plugin marketplace (by design: local files,
  HTML export only).

---

## Reporting Issues

Bug reports and feature requests go to
[GitHub Issues](https://github.com/anzchy/mdpro/issues). mdpro writes a structured log
that helps with a bug report:

```bash
tail -f ~/.mdpro/mdpro.log | jq .
```

---

## Building from Source

**Prerequisites:** [pnpm](https://pnpm.io/) 10.26.1 (pinned in `package.json`; don't use
npm or yarn), [Rust](https://www.rust-lang.org/tools/install) stable, and Xcode Command
Line Tools on macOS ([Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
git clone https://github.com/anzchy/mdpro.git
cd mdpro
pnpm install

pnpm tauri dev            # run the desktop app with hot reload
pnpm build                # type-check and bundle the frontend
pnpm test:run             # frontend unit tests (Vitest)
cd src-tauri && cargo test   # Rust backend tests
```

`pnpm tauri build` produces the `.app` and `.dmg`. It bundles the `mdpro_mcp` sidecar,
which is a gitignored build artifact: build it first with
`cargo build --release --bin mdpro_mcp` in `src-tauri/` and copy it to
`src-tauri/binaries/mdpro_mcp-<target-triple>`.

Releases are built by a manually dispatched GitHub Actions workflow, not by pushing a
tag; see the [release runbook](docs/guide/release-runbook.md).

**Tech stack:** Tauri 2 (Rust), React 19, Vite 7, TypeScript, Zustand, Milkdown,
CodeMirror 6, pulldown-cmark.

**AI-assisted development:** the repo carries its Claude Code configuration:
`CLAUDE.md` for conventions and `.claude/` for rules, skills and agents.
