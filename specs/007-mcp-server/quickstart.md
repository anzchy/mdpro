# mdpro MCP Server Quickstart

This guide explains how to configure Claude Code, Codex CLI, or other MCP clients to use mdpro's MCP server.

## Prerequisites

1. **mdpro** must be running
2. The MCP server binary (`mdpro_mcp`) must be available in your PATH or specified with full path

## Finding the Binary

After building mdpro, the MCP server binary is located at:

**Development**:
```
src-tauri/target/debug/mdpro_mcp
```

**Production (bundled with app)**:
```
/Applications/mdpro.app/Contents/MacOS/mdpro_mcp
```

## Claude Code Configuration

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "mdpro": {
      "command": "/path/to/mdpro_mcp"
    }
  }
}
```

For bundled app:
```json
{
  "mcpServers": {
    "mdpro": {
      "command": "/Applications/mdpro.app/Contents/MacOS/mdpro_mcp"
    }
  }
}
```

## Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mdpro": {
      "command": "/Applications/mdpro.app/Contents/MacOS/mdpro_mcp"
    }
  }
}
```

## Available Tools

### get_open_documents
Returns a list of all documents currently open in mdpro.

**Response**: JSON array of documents with id, title, path, and is_dirty fields.

### read_document
Read the content of a specific document.

**Parameters**:
- `id` (string): Document ID from get_open_documents

**Response**: Document content as plain text.

### write_document
Replace the entire content of a document.

**Parameters**:
- `id` (string): Document ID
- `content` (string): New content

**Note**: If mdpro is not focused, a confirmation dialog will appear.

### insert_content
Insert text at a specific position.

**Parameters**:
- `id` (string): Document ID
- `text` (string): Text to insert
- `position` (string): "cursor", "start", "end", or an offset number.
  Offsets are **UTF-16 code units** (ADR-0021) — an emoji counts as 2,
  not 1 and not its 4 bytes. An offset landing inside a character is
  snapped down to that character's start.

**Note**: If mdpro is not focused, a confirmation dialog will appear.

## Troubleshooting

### "mdpro not running" error

The MCP server requires mdpro to be running. Start mdpro before using the MCP tools.

### Connection refused

1. Check that mdpro is running
2. Verify `~/.mdpro/server.port` and `~/.mdpro/server.token` exist
3. These files are created when mdpro starts and removed when it quits

### Permission denied

Ensure the mdpro_mcp binary is executable:
```bash
chmod +x /path/to/mdpro_mcp
```

## How It Works

1. Claude Code spawns `mdpro_mcp` as a subprocess
2. `mdpro_mcp` reads connection info from `~/.mdpro/server.port` and `~/.mdpro/server.token`
3. MCP tool calls are forwarded to mdpro's internal HTTP API
4. Results are returned via MCP protocol
