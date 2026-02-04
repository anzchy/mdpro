# Quickstart: mdpro MCP Server

## Prerequisites

- mdpro built and running
- Claude Code, Codex CLI, or another MCP-compatible client

## Architecture Overview

```
┌─────────────────┐     stdio      ┌─────────────────┐     HTTP      ┌─────────────────┐
│   MCP Client    │ ◄──────────► │   mdpro-mcp     │ ◄──────────► │    mdpro App    │
│ (Claude/Codex)  │   JSON-RPC    │  (Rust binary)  │  localhost    │  (Tauri + React)│
└─────────────────┘               └─────────────────┘               └─────────────────┘
                                          │
                                          ▼
                                  ~/.mdpro/server.port
                                  ~/.mdpro/server.token
```

## Setup Steps

### 1. Build mdpro-mcp

```bash
cd src-tauri
cargo build --bin mdpro_mcp --release
```

Binary location: `target/release/mdpro_mcp`

### 2. Configure MCP Client

**Claude Code** (`~/.claude_code/mcp.json`):
```json
{
  "mcpServers": {
    "mdpro": {
      "command": "/Applications/mdpro.app/Contents/MacOS/mdpro-mcp"
    }
  }
}
```

**Alternative (development)**:
```json
{
  "mcpServers": {
    "mdpro": {
      "command": "/path/to/mdpro/src-tauri/target/release/mdpro_mcp"
    }
  }
}
```

### 3. Start mdpro

Launch mdpro.app normally. The HTTP server starts automatically and writes connection info to:
- `~/.mdpro/server.port` - Port number
- `~/.mdpro/server.token` - Auth token

### 4. Verify Connection

In Claude Code:
```
> What documents are open in mdpro?
```

Expected: List of open document titles and paths.

## Available Tools

| Tool | Description |
|------|-------------|
| `get_open_documents` | List all open documents with IDs, titles, paths |
| `read_document` | Read content of a specific document by ID |
| `write_document` | Replace entire document content (may prompt for confirmation) |
| `insert_content` | Insert text at cursor, start, end, or specific offset |

## Example Workflows

### Read and Summarize Current Document

```
> Read the active document in mdpro and summarize it
```

### Insert Generated Code

```
> Insert a TypeScript interface for a User at the cursor position in mdpro
```

### Update Document Content

```
> Replace the content of the README.md in mdpro with an improved version
```

## Troubleshooting

### "mdpro not running"

- Ensure mdpro.app is running before starting the MCP client
- Check that `~/.mdpro/server.port` exists and contains a valid port

### "Invalid token"

- Restart mdpro to regenerate the token
- Restart the MCP client to pick up the new token

### "User rejected write operation"

- User declined the confirmation dialog for a write operation
- Either accept the dialog or use `insert_content` for less intrusive edits

### Connection Refused

- Check if another process is using the port
- Look at `~/.mdpro/mdpro.log` for HTTP server startup errors

## Development

### Run HTTP Server Manually (Testing)

```bash
cd src-tauri
cargo run -- --http-only  # (if implemented)
```

### Test mdpro-mcp Standalone

```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | ./target/release/mdpro_mcp
```

### View Logs

```bash
tail -f ~/.mdpro/mdpro.log | jq .
```

Filter for MCP events:
```bash
tail -f ~/.mdpro/mdpro.log | jq 'select(.event | startswith("mcp."))'
```
