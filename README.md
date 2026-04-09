# mdpro

A local Markdown editor for macOS. Typora-style WYSIWYG, AI-ready via MCP.

Built with Tauri 2 · React · Rust.

---

## Features

**Two view modes** — toggle with `⌃2` / `⌃4` or cycle with `⌃/`

| Mode | Shortcut | Description |
|---|---|---|
| WYSIWYG | `⌃4` | Rich-text editing; inline code/links reveal on cursor move or `⌃\`` |
| Source | `⌃2` | Full-width Markdown source with syntax highlighting |

**Typora-style keyboard shortcuts** — `⌘B/I/K` for bold/italic/link, `⌘0–6` for headings, `⌘⇧H` to highlight selection. All shortcuts are configurable in Preferences.

**Auto-save drafts** — work is saved continuously. If the app crashes or the file was never saved to disk, mdpro offers recovery on next open.

**Image paste** — paste screenshots or images directly into the WYSIWYG editor (`⌘V`). Images are saved to an `assets/` folder next to your `.md` file; the reference is inserted automatically.

**External file watching** — if a file is modified outside mdpro, the editor prompts to reload. No silent overwrites.

**Tab bar** — open multiple documents at once. Configurable position (top/bottom), close behavior, and max visible tabs.

**HTML export** — `⌘⇧E` exports the current document as a styled HTML file.

**MCP server** — expose open documents to Claude Code, Claude Desktop, Codex CLI, and Gemini CLI. AI tools can read and write your documents in real time.

---

## MCP Integration

mdpro runs a local HTTP server and ships a companion `mdpro_mcp` binary that speaks the [Model Context Protocol](https://modelcontextprotocol.io).

**Install the config from inside mdpro:** Settings → MCP → pick your client → Install.

Or add manually:

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "mdpro": { "command": "/Applications/mdpro.app/Contents/MacOS/mdpro_mcp" }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "mdpro": { "command": "/Applications/mdpro.app/Contents/MacOS/mdpro_mcp" }
  }
}
```

**Available tools:** `get_open_documents` · `read_document` · `write_document` · `insert_content`

mdpro must be running. Write operations show a confirmation dialog if the app is not in focus.

---

## Development

**Prerequisites:** Node.js + pnpm, Rust stable, Xcode Command Line Tools (macOS)

```bash
pnpm install          # install dependencies
pnpm tauri dev        # run the desktop app (hot reload)
pnpm build            # type-check + frontend bundle
pnpm test:run         # frontend unit tests (Vitest)
cd src-tauri && cargo test   # Rust backend tests
```

**Release build:**
```bash
pnpm tauri build      # produces .app + .dmg in src-tauri/target/
```

Tagging a `v*` commit triggers GitHub Actions and publishes a DMG to GitHub Releases.

---

## Logs

```bash
tail -f ~/.mdpro/mdpro.log | jq .
```

If macOS quarantines the app after download:
```bash
sudo find "/Applications/mdpro.app" -exec xattr -d com.apple.quarantine {} \;
```
