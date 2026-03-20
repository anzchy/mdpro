# CLI vs MCP: Roadmap Evaluation for mdpro Terminal Integration

**Date:** 2026-03-12
**Context:** Users will increasingly interact with markdown documents from the terminal. Two architectural paths are viable: a **dedicated CLI** (`mdpro` binary) or an **MCP server** (Claude tool protocol). This document evaluates both.

---

## 1. The Question

As mdpro matures, power users want to do things like:

```bash
# Read a doc
mdpro read ~/notes/architecture.md

# Create / edit
mdpro create --title "Sprint Notes" --content "..."
mdpro append ~/notes/sprint.md "- new item"

# List / search
mdpro list
mdpro search "TDD workflow"
```

The question is: should this surface be a **standalone CLI binary**, an **MCP server** (so Claude has native tool access), or both?

---

## 2. Reference Projects Studied

### gws — Google Workspace CLI (googleworkspace/cli)

A unified CLI over all Google Workspace APIs. Key design decisions relevant here:

- **Dynamic command surface**: reads Google's Discovery Service at runtime instead of hardcoding commands. New API endpoints appear automatically.
- **Structured JSON output**: every response is JSON, making it agent-friendly.
- **Gemini CLI Extension**: ships a first-class AI agent integration so Gemini CLI can invoke `gws` commands as tools.
- **100+ agent skills**: pre-written task definitions that teach AI models *how* to use the CLI. This is their workaround for the fact that CLIs are not auto-loaded into AI context.

### gogcli — Google Suite CLI (steipete/gogcli)

A script-friendly CLI for Gmail, Drive, Docs, Sheets, Calendar, etc. Key design decisions:

- **Multiple output modes**: human tables (default), `--plain` (TSV), `--json` (structured). This dual-mode design lets the same tool serve both humans and agents.
- **Least-privilege auth flags**: `--readonly`, `--drive-scope` — important for sandboxed agent runs.
- **`--no-input` flag**: disables all prompts, enabling non-interactive agent automation.
- **Agent restrictions**: can lock down which top-level commands are available for sandboxed agent runs.

**Key observation from both projects**: Neither CLI is automatically available in Claude's context. Both require explicit integration work — either via a CLI extension (gws → Gemini) or by documenting the tool in a system prompt / CLAUDE.md. They solve the agent-discoverability problem at the *skill/instruction* layer, not the protocol layer.

---

## 3. How Each Approach Works Under the Hood

### 3A. CLI Approach

```
User / Claude
     |
     | shell invocation (subprocess / Bash tool)
     v
mdpro binary (Rust or Node)
     |
     |-- Direct FS: read/write .md files via std::fs
     |-- HTTP API: POST to Tauri embedded server (localhost:PORT)
     |-- IPC socket: Unix domain socket to running Tauri instance
     v
~/.mdpro/ + ~/Documents/*.md
```

**Transport options ranked by complexity:**

| Transport | How | Complexity | Notes |
|-----------|-----|------------|-------|
| Direct filesystem | Read/write `.md` files directly | Low | No app needed; bypasses Tauri state |
| Embedded REST API | Tauri app runs `localhost:PORT`; CLI hits it | Medium | Already planned in `007-feat/mcp-server` spec |
| Unix socket / named pipe | CLI talks to running Tauri app process | High | True IPC; complex cross-process lifecycle |

For mdpro, the embedded REST API is the pragmatic middle ground — it lets the CLI and the GUI share state (open documents, unsaved changes, preferences) without complex process binding.

**Command lifecycle in Claude:**

```
User says: "search my notes for TDD"
  -> Claude uses Bash tool: `mdpro search "TDD"`
  -> CLI exits with JSON to stdout
  -> Claude reads stdout, continues reasoning
```

Claude must *already know* the CLI exists and its syntax. It does not discover the CLI automatically.

---

### 3B. MCP Approach

```
Claude (host)
     |
     | JSON-RPC 2.0 over stdio or HTTP+SSE
     v
mdpro MCP Server (TypeScript or Rust process)
     |
     |-- Direct FS operations
     |-- OR: HTTP calls to Tauri embedded API
     v
~/.mdpro/ + ~/Documents/*.md
```

**Tool definition example (TypeScript MCP server):**

```typescript
server.tool("read_document", {
  path: z.string().describe("Absolute path to the .md file"),
}, async ({ path }) => {
  const content = await fs.readFile(path, "utf-8");
  return { content: [{ type: "text", text: content }] };
});

server.tool("list_documents", {
  dir: z.string().optional().describe("Directory to list; defaults to ~/Documents"),
}, async ({ dir }) => {
  const files = await glob("**/*.md", { cwd: dir ?? os.homedir() + "/Documents" });
  return { content: [{ type: "text", text: JSON.stringify(files) }] };
});
```

**Tool lifecycle in Claude:**

```
Session start
  -> Claude loads MCP server config (~/.claude.json or claude_desktop_config.json)
  -> MCP server process starts
  -> Tool schemas are injected into Claude's context automatically
  -> Claude knows read_document, create_document, list_documents exist
  -> No user instruction needed to discover the tools
```

---

## 4. The Critical Context Difference

This is the most important difference between the two approaches.

| Aspect | CLI | MCP |
|--------|-----|-----|
| **Auto-loaded into Claude's context?** | **No** | **Yes** |
| How Claude discovers it | User tells Claude, or CLAUDE.md documents it | Tool schemas injected at session start |
| Claude's knowledge of available commands | Fuzzy — must infer from docs or prior conversation | Precise — typed schemas with descriptions |
| Parameter validation | Claude guesses arg syntax; errors surface at runtime | Schema-validated before invocation |
| Error feedback to Claude | Parses stdout/stderr as text | Structured error responses via JSON-RPC |
| Multi-step tool chaining | Claude manually pipes outputs | Claude can chain tool calls natively |

**The analogy:** MCP tools are like imported TypeScript functions with full type signatures. CLI tools are like undocumented shell scripts that Claude heard about somewhere.

---

## 5. Pros and Cons

### CLI

**Pros:**
- **Human-first**: works without Claude — users can script it, alias it, use it in cron jobs, pipe it to `fzf`/`grep`/`jq`
- **Universal discoverability**: `mdpro --help` works anywhere; no AI dependency
- **Composable in shell pipelines**: `mdpro list | fzf | xargs mdpro read`
- **Simple deployment**: a single binary, no server process to manage
- **Works offline and without AI**: pure utility value independent of Claude
- **Lower attack surface**: no persistent server process listening
- **Familiar**: developers expect CLIs; no new protocol to learn

**Cons:**
- **Not in Claude's context**: must be documented in CLAUDE.md or system prompt to be useful to Claude
- **Claude uses it via Bash tool**: higher latency, more fragile (parses stdout text)
- **No live state sharing**: if Tauri app has unsaved buffer, CLI reading the file sees stale content
- **Schema-free**: Claude can't introspect what arguments are valid without docs
- **Each invocation is stateless**: no session concept; harder to do multi-step operations atomically

---

### MCP

**Pros:**
- **Always in Claude's context**: tools auto-load; Claude can use them without user instruction
- **Typed, schema-validated**: Claude knows exact parameter names, types, and descriptions
- **Structured error handling**: failures return typed error objects, not unparseable stderr
- **Stateful sessions possible**: MCP server can maintain a connection to the running Tauri app
- **Native tool chaining**: Claude can compose multiple MCP calls in one reasoning step
- **Live sync with GUI**: if MCP server talks to Tauri's embedded API, it sees current in-memory state
- **Access control built-in**: Claude Desktop's MCP config allows per-server permissions

**Cons:**
- **AI-only surface**: not useful from a regular terminal without Claude
- **Server management overhead**: process must be running; lifecycle complexity
- **Harder to debug**: JSON-RPC over stdio is less transparent than `mdpro --verbose`
- **No shell composability**: can't pipe MCP tool output to `grep` or `fzf`
- **Claude-centric**: ties the feature to Claude Desktop / Claude Code; other tools (Cursor, Zed) need separate integrations
- **Discoverability only within AI clients**: `which mdpro-mcp` tells a human nothing useful

---

## 6. The mdpro-Specific Recommendation

The spec already anticipates this (`007-feat/mcp-server` in `CLAUDE.md`). The right answer for mdpro is **both, sharing a common API backend**.

```
                    ┌─────────────────────────────────┐
                    │   Tauri App (embedded HTTP API)  │
                    │   localhost:PORT + secret token  │
                    └────────────┬────────────────────┘
                                 │
              ┌──────────────────┼─────────────────────┐
              │                  │                      │
              v                  v                      v
       mdpro CLI           MCP Server              Future: REST
    (human / scripts)   (Claude tools)           (web apps, etc.)
```

**Implementation order:**

1. **First: Embedded REST API in Tauri** (`007-feat/mcp-server`) — this is the shared backend. It handles auth (random token in `~/.mdpro/config.json`), exposes JSON endpoints for CRUD on documents.

2. **Second: MCP Server** — a thin TypeScript/Rust wrapper that maps MCP tool calls to the REST API. This gives Claude native, schema-typed access. Since tool schemas auto-load, users get immediate value without any CLAUDE.md documentation.

3. **Third: CLI** — another thin wrapper over the same REST API. Designed for humans: tables by default, `--json` for scripts, `--help` on everything. Add to CLAUDE.md so Claude can use it via Bash as fallback.

**Why this order?** The REST API is the hardest part and the shared foundation. MCP and CLI are both thin clients over it. Building the API first prevents divergence.

---

## 7. Design Principles Borrowed from gws / gogcli

For whichever surface you build first, apply these patterns:

| Pattern | Source | Apply to mdpro |
|---------|--------|----------------|
| JSON output flag | gogcli `--json` | `mdpro list --json` for agent use |
| Non-interactive mode | gogcli `--no-input` | `mdpro create --no-confirm` |
| Dry run preview | gws `--dry-run` | `mdpro delete --dry-run` |
| Structured error codes | gws JSON errors | `{"error": "FILE_NOT_FOUND", "path": "..."}` |
| Agent skill definitions | gws 100+ skills | Add to CLAUDE.md: "to search notes, run `mdpro search`" |
| Least-privilege scoping | gogcli `--readonly` | `mdpro --readonly` for safe agent sessions |

---

## 8. Summary Table

| Dimension | CLI | MCP | Winner |
|-----------|-----|-----|--------|
| Auto-loaded in Claude context | No | Yes | MCP |
| Human terminal usability | High | None | CLI |
| Shell pipeline composability | Yes | No | CLI |
| Parameter type safety for Claude | Low | High | MCP |
| Live state with GUI | Stale (file) | Real-time (API) | MCP |
| Deployment simplicity | Binary | Server process | CLI |
| Works without AI | Yes | No | CLI |
| Debug transparency | High | Low | CLI |
| Multi-step atomic operations | Manual | Native | MCP |
| Broader tool compatibility | Any shell | Claude/MCP clients | CLI |

**Bottom line:** MCP is better for Claude-native workflows. CLI is better for humans and general automation. They are not mutually exclusive — build the REST API backend once and expose it through both surfaces.
