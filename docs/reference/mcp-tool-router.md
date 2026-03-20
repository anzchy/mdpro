# MCP Tool Router: Lazy-Loading Tools on Demand

**Date:** 2026-03-12
**Context:** How to avoid loading all MCP tools into Claude's context at once — exposing only a minimal "core" set and activating additional tool groups on explicit user request.

---

## 1. The Problem

When Claude Code connects to an MCP server, the protocol flow is:

```
Claude Code startup
  → sends initialize
  → sends tools/list
  ← server responds with ALL registered tools
  → all tool schemas injected into context window
```

With 30+ tools, this has real costs:
- Each tool schema (name + description + parameter types) consumes context tokens
- Claude's tool selection becomes noisier — irrelevant tools get considered
- Users may not want all capabilities exposed by default (security, focus)

---

## 2. The Protocol Mechanism That Makes Routing Possible

The MCP spec defines a **dynamic tool list** system:

```
Server → Client:  notifications/tools/list_changed
Client → Server:  tools/list  (re-fetch)
```

When your MCP server sends `notifications/tools/list_changed`, Claude Code **re-fetches the tool list**. If your server now returns a different (larger or smaller) set of tools, Claude's available tools update mid-session.

This is the foundation of the router pattern: start minimal, expand on demand.

---

## 3. The Router Pattern: Implementation

### Architecture

```
Claude Code (session start)
    ↓ tools/list
MCP Server returns ONLY:
    - mdpro_activate(module)   ← the router meta-tool

User: "activate file tools"
Claude calls: mdpro_activate({ module: "files" })
    ↓ server adds file tools to active set
    ↓ server sends notifications/tools/list_changed
    ↓ Claude re-fetches tools/list
Claude now has: read_file, write_file, delete_file, ...
```

### Full TypeScript Implementation

Use the **low-level MCP `Server`** (not `McpServer`) for dynamic control:

```typescript
// src-mcp/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// --- Tool Module Definitions ---

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const MODULES: Record<string, ToolDef[]> = {
  core: [
    {
      name: "mdpro_activate",
      description:
        "Activate a tool group. Call this when you need file, search, export, or bulk operations. " +
        "Available modules: files, search, export, bulk.",
      inputSchema: {
        type: "object",
        properties: {
          module: {
            type: "string",
            enum: ["files", "search", "export", "bulk"],
            description: "The tool group to activate",
          },
        },
        required: ["module"],
      },
      handler: async ({ module }) => {
        // handled specially below — triggers tool list refresh
        return { activated: module };
      },
    },
    {
      name: "list_documents",
      description: "List all markdown documents in the workspace",
      inputSchema: {
        type: "object",
        properties: {
          dir: { type: "string", description: "Directory to list (optional)" },
        },
      },
      handler: async ({ dir }) => {
        // ... implementation
        return { documents: [] };
      },
    },
  ],

  files: [
    {
      name: "read_file",
      description: "Read the content of a markdown file",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      handler: async ({ path }) => {
        const { readFile } = await import("fs/promises");
        return { content: await readFile(path as string, "utf-8") };
      },
    },
    {
      name: "write_file",
      description: "Write or overwrite a markdown file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      handler: async ({ path, content }) => {
        const { writeFile } = await import("fs/promises");
        await writeFile(path as string, content as string, "utf-8");
        return { ok: true };
      },
    },
    {
      name: "delete_file",
      description: "Delete a markdown file (moves to trash)",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      handler: async ({ path }) => {
        // ... implementation
        return { ok: true };
      },
    },
  ],

  search: [
    {
      name: "search_content",
      description: "Full-text search across all markdown files",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          dir: { type: "string" },
        },
        required: ["query"],
      },
      handler: async ({ query, dir }) => {
        // ... implementation
        return { results: [] };
      },
    },
  ],

  export: [
    {
      name: "export_html",
      description: "Export a markdown file to HTML",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      handler: async ({ path }) => {
        // ... implementation
        return { html: "" };
      },
    },
  ],

  bulk: [
    {
      name: "bulk_rename",
      description: "Rename multiple files matching a pattern",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          replacement: { type: "string" },
          dir: { type: "string" },
        },
        required: ["pattern", "replacement"],
      },
      handler: async (args) => {
        // ... implementation
        return { renamed: [] };
      },
    },
  ],
};

// --- Server Setup ---

const activeModules = new Set<string>(["core"]);

const server = new Server(
  { name: "mdpro", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Dynamic tools/list — only return active modules
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [];
  for (const mod of activeModules) {
    for (const tool of MODULES[mod] ?? []) {
      tools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
  }
  return { tools };
});

// Dynamic call routing
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  // Special handling for the router itself
  if (name === "mdpro_activate") {
    const module = args.module as string;
    if (!MODULES[module]) {
      return {
        content: [{ type: "text", text: `Unknown module: ${module}` }],
        isError: true,
      };
    }
    activeModules.add(module);

    // Notify Claude to re-fetch tool list
    await server.sendNotification({
      method: "notifications/tools/list_changed",
    });

    const newTools = MODULES[module].map((t) => t.name).join(", ");
    return {
      content: [
        {
          type: "text",
          text: `Activated '${module}' module. New tools available: ${newTools}. You can now use these tools directly.`,
        },
      ],
    };
  }

  // Route to the correct module's handler
  for (const mod of activeModules) {
    const tool = MODULES[mod]?.find((t) => t.name === name);
    if (tool) {
      const result = await tool.handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  }

  return {
    content: [{ type: "text", text: `Tool not found: ${name}` }],
    isError: true,
  };
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## 4. What Happens Mid-Session (The Refresh Cycle)

```
1. Session starts
   Claude sees: [mdpro_activate, list_documents]

2. User: "I need to read some markdown files"
   Claude calls: mdpro_activate({ module: "files" })

3. Server:
   - adds "files" to activeModules
   - sends notifications/tools/list_changed

4. Claude Code:
   - receives the notification
   - re-fetches tools/list
   - now has: [mdpro_activate, list_documents, read_file, write_file, delete_file]

5. Claude's next response can use read_file directly
   (the activation response text also guides Claude)
```

**Important nuance:** Claude does not automatically call the newly available tools — it needs to complete the current tool-call cycle first, then the new tools are available for the next step. The activation response message ("New tools available: read_file, write_file...") is what guides Claude to use them immediately.

---

## 5. Three Alternative Approaches

### Approach A: Multiple MCP Servers (Config-Time Routing)

Split into separate server processes, each registered in `~/.claude.json`:

```json
{
  "mcpServers": {
    "mdpro-core": {
      "command": "node",
      "args": ["/path/to/mdpro-mcp/core.js"]
    },
    "mdpro-files": {
      "command": "node",
      "args": ["/path/to/mdpro-mcp/files.js"],
      "disabled": true
    },
    "mdpro-search": {
      "command": "node",
      "args": ["/path/to/mdpro-mcp/search.js"],
      "disabled": true
    }
  }
}
```

User enables servers by editing config and restarting Claude Code. No dynamic loading — but dead simple.

**Tradeoff:** Manual, requires restart. Good for coarse-grained profiles ("writing mode" vs "dev mode").

---

### Approach B: ENV-Var Profiles (Startup-Time Routing)

Single server, but controlled by env vars set in the MCP config:

```json
{
  "mcpServers": {
    "mdpro": {
      "command": "node",
      "args": ["/path/to/mdpro-mcp/server.js"],
      "env": {
        "MDPRO_MODULES": "core,files,search"
      }
    }
  }
}
```

Server reads `process.env.MDPRO_MODULES` at startup and registers only those tools:

```typescript
const enabled = (process.env.MDPRO_MODULES ?? "core").split(",");
for (const mod of enabled) {
  registerModule(mod);
}
```

**Tradeoff:** No mid-session changes, but zero complexity. User edits one JSON line to change the profile.

---

### Approach C: Tool Namespacing with Inline Filter

Keep all tools registered but use a naming convention + description filter. Tools outside the "active" set have their descriptions replaced with a deactivation notice:

```typescript
// All tools registered, but "inactive" ones have stripped descriptions
// and return an error asking user to activate them first
{
  name: "search_content",
  description: "(INACTIVE - call mdpro_activate({module:'search'}) first)",
  inputSchema: { type: "object", properties: {} }
}
```

This is the least clean approach — still loads all schemas — but avoids the `notifications/tools/list_changed` complexity.

---

## 6. Comparison Table

| Approach | Dynamic? | Claude auto-discovers new tools | Implementation | Restart needed |
|----------|----------|--------------------------------|----------------|----------------|
| Router meta-tool + `tools/list_changed` | Yes | Yes (after activation call) | High | No |
| Multiple MCP servers | No | Yes (within each server) | Low | Yes |
| ENV-var profiles | No | Yes (within profile) | Low | Yes |
| Tool namespacing with filter | Fake | No (all schemas loaded) | Medium | No |

---

## 7. Recommended Pattern for mdpro

Given mdpro's use case (personal local editor, single user, Claude Code as primary AI client):

**Use ENV-var profiles for now, plan for the router pattern later.**

**Phase 1 (simple):** ENV-var profile in `~/.claude.json`:
```json
{
  "env": { "MDPRO_MODULES": "core,files" }
}
```
Server reads this at startup. User edits config to enable search/export/bulk when needed.

**Phase 2 (dynamic):** Add the router meta-tool (`mdpro_activate`) once the tool surface grows beyond ~10 tools or users request it. The `notifications/tools/list_changed` mechanism is supported by Claude Code and the MCP SDK.

### Why not start with the router?

- The router adds complexity: you need the low-level `Server` (not `McpServer`), manual `setRequestHandler` calls, and careful wording on the activation response to guide Claude.
- For a local single-user tool with a modest number of tools, the ENV-var approach covers 90% of the need with 10% of the code.
- Add the router when you actually have the pain (too many tools cluttering Claude's context).

---

## 8. UX Guidance: Writing Good Activation Responses

The activation tool's response text is what guides Claude after the new tools load. Make it explicit:

```typescript
// Good — Claude knows exactly what to do next
return {
  content: [{
    type: "text",
    text: `Activated 'search' module. You can now use: search_content(query, dir?), find_by_tag(tag). These tools are immediately available — proceed with the user's search request.`
  }]
};

// Bad — Claude has to guess
return {
  content: [{ type: "text", text: "Done." }]
};
```

Also: document available modules in the `mdpro_activate` tool description itself, so Claude knows what it can activate before the user asks:

```typescript
description:
  "Activate additional tool groups for this session. " +
  "Modules: 'files' (read/write/delete .md files), " +
  "'search' (full-text search), " +
  "'export' (HTML/PDF export), " +
  "'bulk' (batch rename/move). " +
  "Call this when the user's request requires tools not currently available."
```
