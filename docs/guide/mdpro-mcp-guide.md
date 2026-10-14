# mdpro MCP Guide

Purpose: set up mdpro's MCP server and connect clients to it, look up its
tools, and drive the local HTTP API by hand with curl (`write_document`,
`insert_content`, `create_document`, table tools) against a running app, for
device and QA checks. Routes and handlers:
`src-tauri/src/services/http_server.rs` (`create_router`); request bodies:
`src-tauri/src/models/mcp.rs`. Table payload semantics are in
[`tables.md` § MCP table tools](./tables.md#mcp-table-tools-external-automation).

## 1. Prerequisites

- **App running**: `pnpm tauri dev`, with at least one document open.
- **Server enabled**: Settings → Integrations → **Enable MCP Server**
  (`mcp.serverEnabled` in `~/.mdpro/config.json`, default on). The toggle takes
  effect live through `mcp_set_server_enabled` (ADR-0040); no restart needed.
- **Port and token** are written by `mcp_controller/files.rs` into the platform
  data dir, **not** `~/.mdpro/`:
  `~/Library/Application Support/mdpro/server.port` and `server.token` (0600).
  Both are removed when the server stops, and **every start mints a new
  token**, so re-run the preamble after a toggle or relaunch.
- The server binds the fixed address `127.0.0.1:55045` (`MCP_SERVER_PORT`). If
  another mdpro (e.g. `/Applications/mdpro.app`) already holds it, the dev
  build's server fails to bind and Settings shows the failed status.

## 2. Starting the MCP server in a built app

There are two pieces. The **HTTP server** runs inside the app on
`127.0.0.1:55045` (section 1). The **`mdpro_mcp` binary**
(`src-tauri/src/bin/mdpro_mcp.rs`) is a stdio MCP server that an AI client
spawns. It reads `server.port` / `server.token` from
`~/Library/Application Support/mdpro/` and forwards each tool call to the HTTP
server. The bundle ships it next to the app binary:
`mdpro.app/Contents/MacOS/mdpro_mcp` beside `tauri-app`.

- **The app must be running with the server enabled.** On its own the binary
  does nothing: at startup it calls `GET /api/status` and exits with "Make sure
  mdpro is running." if that fails.
- **Which binary a client runs**: the in-app install button (section 3) writes
  the path from `get_mcp_binary_path()` (`src-tauri/src/commands/mcp.rs`). It
  checks, in order: next to the running executable, then
  `src-tauri/target/debug/mdpro_mcp`, then `target/release/mdpro_mcp`, then
  `/Applications/mdpro.app/Contents/MacOS/mdpro_mcp` (used without checking
  that it exists). A config that points at `/Applications` runs the **older
  installed** `mdpro_mcp` against your dev app. The protocol is the same, so
  this works, but you are not testing the new sidecar.
- **Dev build**: `pnpm tauri dev` builds only `tauri-app`, so run
  `cargo build --bin mdpro_mcp` in `src-tauri/` first (see section 9).

## 3. Adding mdpro to Claude Code (and other clients)

Recommended for Claude Code: register the binary with the CLI.

```sh
# Release bundle built from this repo
claude mcp add mdpro -s user -- \
  "<repo>/src-tauri/target/release/bundle/macos/mdpro.app/Contents/MacOS/mdpro_mcp"
# Installed app
claude mcp add mdpro -s user -- /Applications/mdpro.app/Contents/MacOS/mdpro_mcp
```

Check it with `claude mcp list`, and with `/mcp` inside a session. A session
that is already running does not pick up the new server: restart it, or
reconnect the server from `/mcp`, before the tools appear.

**The in-app install button** (Settings → Integrations → Install MCP
Configuration, `mcp_install_config`) writes these files:

| Client | File | Entry written |
|---|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `"mcpServers": {"mdpro": {"command": "<binary>"}}` |
| Claude Code | `~/.claude/settings.json` | same JSON |
| Gemini CLI | `~/.config/gemini/settings.json` | same JSON |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.mdpro]` / `command = "<binary>"` |

The JSON writer (`install_json_config`) keeps other keys and overwrites
`mcpServers.mdpro` on every click. The TOML writer (`install_toml_config`)
does nothing if `[mcp_servers.mdpro]` already exists, so an old path stays
until you use Remove and then Install again.

**Unverified, likely a bug:** for Claude Code the button writes
`mcpServers.mdpro` into `~/.claude/settings.json`. As far as I know, Claude Code
reads user-scope MCP servers from `~/.claude.json` (written by
`claude mcp add`) or a project `.mcp.json`, not from `settings.json`. If so,
the button has no effect for Claude Code. This comes from my knowledge of the
Claude Code docs, not a fetched copy, and was not tested on this machine. Use
`claude mcp add`.

## 4. Tool reference

Every tool is defined in `src-tauri/src/bin/mdpro_mcp.rs`; there are no others.
"Gated" means the ADR-0042 confirm prompt (section 7).

| Tool | Parameters | Does | HTTP route | Gated | Errors | Notes |
|---|---|---|---|---|---|---|
| `get_open_documents` | none | Lists open documents | `GET /api/documents` | No | 401, 500 | Returns `id`, `title`, `path`, `is_dirty`, plus `over_limit: true` on a document over 10 MiB (D98) |
| `read_document` | `id: string` | Reads one document | `GET /api/documents/{id}` | No | 404 `NOT_FOUND`, 413 `DOCUMENT_TOO_LARGE` | Returns `content` only (the route also has `cursor`) |
| `write_document` | `id: string`, `content: string` | Replaces the whole document | `POST /api/documents/{id}` | Yes (`replace`) | 403 `USER_REJECTED`, 408 `CONFIRM_TIMEOUT`, 503 `CONFIRM_CANCELLED`, 404 `NOT_FOUND`, 413 `DOCUMENT_TOO_LARGE`, 500 `EMIT_FAILED` | Rebuilds WYSIWYG (ADR-0044) |
| `insert_content` | `id: string`, `text: string`, `position: string` | Inserts text | `POST /api/documents/{id}/insert` | Yes (`insert`) | same as `write_document` | `position` is `cursor` / `start` / `end` or digits (sent as a JSON number). UTF-16 offsets (ADR-0021) |

The binary reloads port and token after a `401` or a connection failure. It
retries a GET once and never replays a POST (`bin/mdpro_mcp/conn.rs`). The
write tools' descriptions tell the client not to retry 403 / 408 / 503.

**HTTP-only (no MCP tool):** `POST /api/documents/new` (create, not gated),
`GET /api/status`, and the six table routes `POST /api/v1/{insert_table,
set_cell, add_row, delete_row, add_column, delete_column}` (gated,
`table:<action>`). You can reach these only with curl (section 6).

## 5. Shell preamble

Paste into zsh or bash. It never echoes the token and keeps it out of `curl`'s
argv (so `ps` cannot see it) by feeding the header through `-H @file`.

```sh
MDPRO_DIR="$HOME/Library/Application Support/mdpro"
PORT=$(cat "$MDPRO_DIR/server.port") && TOKEN=$(cat "$MDPRO_DIR/server.token") \
  && echo "port $PORT, token loaded (${#TOKEN} chars)"
API="http://127.0.0.1:$PORT"
mcurl() {  # usage: mcurl [curl args] URL
  curl -sS -H @<(printf 'X-MDPRO-Token: %s\n' "$TOKEN") \
       -H 'Content-Type: application/json' "$@"; echo
}
```

Add `-w '%{http_code}\n'` to any call to see the status code.

## 6. One curl per route

```sh
mcurl "$API/api/status"                   # {"version":"…","window_focused":bool}
mcurl "$API/api/documents" | jq           # [{id,title,path,is_dirty}, …]
DOC=$(mcurl "$API/api/documents" | jq -r '.[0].id')
mcurl "$API/api/documents/$DOC"           # {"content":"…","cursor":N}

# write_document: full replace -> 200 {"success":true}
mcurl -X POST "$API/api/documents/$DOC" -d '{"content":"# Replaced\n\nBody.\n"}'

# insert_content -> 200 {"success":true,"new_cursor":N}
mcurl -X POST "$API/api/documents/$DOC/insert" -d '{"text":"\nAppended.\n","position":"end"}'
mcurl -X POST "$API/api/documents/$DOC/insert" -d '{"text":"Top. ","position":"start"}'
mcurl -X POST "$API/api/documents/$DOC/insert" -d '{"text":"X","position":"cursor"}'
mcurl -X POST "$API/api/documents/$DOC/insert" -d '{"text":"X","position":12}'

# create_document -> 201 {"id":"<uuid>"}; body may be {} (content defaults to "")
# The tab opens in one window: the focused one, else the most recently focused
# (D161). With no mdpro window open -> 503 {"code":"NO_WINDOW"}, nothing created.
mcurl -X POST "$API/api/documents/new" -d '{"content":"# New from curl\n"}'

# Table tools -> 202 {"scheduled":true}; GET the document to see the result
mcurl -X POST "$API/api/v1/insert_table"  -d "{\"document_id\":\"$DOC\",\"rows\":3,\"cols\":2}"
mcurl -X POST "$API/api/v1/set_cell"      -d "{\"document_id\":\"$DOC\",\"table_index\":0,\"row\":1,\"col\":0,\"content\":\"hi\"}"
mcurl -X POST "$API/api/v1/add_row"       -d "{\"document_id\":\"$DOC\",\"after\":1}"
mcurl -X POST "$API/api/v1/delete_row"    -d "{\"document_id\":\"$DOC\",\"index\":2}"
mcurl -X POST "$API/api/v1/add_column"    -d "{\"document_id\":\"$DOC\",\"after\":0}"
mcurl -X POST "$API/api/v1/delete_column" -d "{\"document_id\":\"$DOC\",\"index\":1}"
```

- `position` is lowercase `"cursor"` / `"start"` / `"end"`, or a bare JSON
  number. Offsets and `cursor` are **UTF-16 code units** (ADR-0021), not bytes.
- `insert_table` with `rows` or `cols` = 0 returns `400 INVALID_PAYLOAD`.
- A document id that is not open returns `404 NOT_FOUND`.
- A document over 10 MiB returns `413 DOCUMENT_TOO_LARGE` on every read and
  write route, the six table routes included, before any confirm prompt (D98).
  mdpro does not mirror its content to the MCP server; the rest of that
  window's documents sync as usual.
- **Rows wider than the header** (D49,
  [ADR-0064](../adr/0064-mcp-table-actions-widen-and-keep-header-width-coordinates.md)):
  every table route except `insert_table` first widens the table to its widest
  row, the same as ⌘S. The extra cells become new columns under an empty header
  cell, and the frontend logs `editor.table.edit-widened`. `set_cell`'s `col` is
  still checked against the header width, so a `col` pointing at an overflow
  cell is dropped (warn line, `reason: "invalid payload"`) until the first write
  has widened the header. After that, the same `col` is valid. The 202 doesn't
  say whether widening happened; `GET` the document to find out (D57).

## 7. The confirm flow (ADR-0042)

**Gated:** write, insert and all six table routes (`confirm_gate` in
`services/mcp_confirm/http.rs`). **Not gated:** `GET`s, `/api/status` and
`POST /api/documents/new`.

A gated write applies at once only if the window that **owns the document** is
focused. Otherwise that window shows a Reject / Approve dialog, one at a time,
FIFO per window, and **curl blocks** until it ends:

| What happens in the app | curl sees |
|---|---|
| Owning window focused, no prompt | `200` (`202` for tables) immediately |
| Approve | `200` / `202` |
| Reject | `403 {"code":"USER_REJECTED"}` |
| No answer within 60 s | `408 {"code":"CONFIRM_TIMEOUT"}` |
| Window closed, server switched off, or app quit | `503 {"code":"CONFIRM_CANCELLED"}` |
| Document closed while the prompt was up, then approved | `404 NOT_FOUND` |
| You press Ctrl-C in curl | prompt withdrawn (`mcp:confirm_resolved` `withdrawn`) |

Running curl from Terminal takes focus away from mdpro, so you will almost
always get the prompt. To test the no-prompt path, run
`sleep 5; mcurl …` and click into the mdpro window during the sleep. After an
approval the insert is computed from the content **as it is then**, so edits
made while the prompt was up survive. Escape rejects the prompt, the same as
the Reject button (fixed by D34, verified on a device on 2026-10-02). With an
input method that swallows Escape, such as WeType, Esc does nothing; switch to
ABC or click Reject
([ADR-0048](../adr/0048-escape-swallowed-by-an-ime-is-not-recovered-from-keyup.md)).
`mcp.autoApproveEdits` is
not consumed by this flow.

## 8. Verify in the log

`~/.mdpro/mdpro.log` (JSONL; written only while logging is enabled, and
nothing is written if `config.json` is unreadable):

```sh
tail -f ~/.mdpro/mdpro.log | jq -c 'select(.event | startswith("mcp."))
  | {ts, event, status, context, error}'
```

| Event | Emitted by |
|---|---|
| `mcp.list`, `mcp.read` | GET handlers (Rust) |
| `mcp.write`, `mcp.insert` | Rust handler `start` / `success` / `fail`; frontend `fail` when the window cannot apply it |
| `mcp.table.<action>` | Rust dispatch and frontend `mcpTableAction.ts` |
| `mcp.confirm`, `mcp.confirm.effect`, `mcp.confirm.reply` | Confirm broker; context `requestId`, `operation` (`replace` / `insert` / `table:<action>`), `outcome`, `waitedMs` |
| `mcp.http_server.start` / `.stop`, `mcp.server.toggle` | Server lifecycle and the Settings switch |
| `mcp.sync` | Frontend → shadow store sync |

`create_document` logs nothing on either side; check it by eye or with
`GET /api/documents`. Frontend events are the `mcp:*` rows of the CLAUDE.md
events table; watch them in DevTools ([`debugging.md`](./debugging.md)).

## 9. curl or an AI client?

A client connected as in sections 2 and 3 calls the four tools in section 4.
In dev, the install button finds the binary under `src-tauri/target/debug/`.
`pnpm tauri dev` builds only the `tauri-app` bin, so run
`cargo build --bin mdpro_mcp` in `src-tauri/` first.

- **Use curl** for exact status codes and bodies, error paths (401 / 403 /
  404 / 408 / 503), confirm timing, UTF-16 offsets, create and table routes,
  and repeatable scripted checks.
- **Use an AI client** to test the real end-to-end path: the sidecar, its
  reload of port and token after a server restart (GETs retried once, POSTs
  never replayed), and what a client sees in the tool error text.

## 10. Gotchas

- **Header is `X-MDPRO-Token`**, not `Authorization: Bearer`. Anything else is
  `401 UNAUTHORIZED`.
- **Origin**: no `Origin` header (curl) passes. `Origin: null` and any origin
  not starting with `http(s)://127.0.0.1` or `http(s)://localhost` get
  `403 {"code":"FORBIDDEN"}`, so a browser page on another origin cannot call
  the API.
- **POST bodies need `Content-Type: application/json`** (axum's `Json`
  extractor rejects the request otherwise). The preamble sets it.
- **Window routing**: Rust broadcasts `mcp:write_document`, `mcp:insert_content`
  and `mcp:table_action` with the `window_label` of the window that owns the
  document; every other window's `useMcpEvents` ignores the event. The confirm
  prompt also shows in the owning window only. `mcp:create_document` carries
  the label of the window that should open the new document: the focused
  window, else the most recently focused one (`ShadowStore::get_target_window`,
  the rule `GET /api/documents/active` uses). A create with a null label is
  refused (D161; before it, every open window applied it).
- **202 is not "done"** for tables: the frontend computes the edit and syncs it
  back. `GET` the document to confirm.
- **WYSIWYG insert is a wholesale replace** (D35 / D37,
  [ADR-0044](../adr/0044-mcp-insert-in-wysiwyg-is-a-wholesale-replace.md), still
  Proposed). Into the active WYSIWYG document, an insert rebuilds the editor:
  undo history is lost, collapsed TOC headings reopen, and focus and caret carry
  over only if the editor was focused. `position: "cursor"` resolves to 0 in
  WYSIWYG. If the pre-insert flush fails, the frontend refuses the insert after
  curl already got `200`, and the shadow store is out of step until the next
  sync (`mcp.insert` `fail`, reason `flush failed`). Test inserts in source mode
  as well.
