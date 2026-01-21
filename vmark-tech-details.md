# VMark Technical Details

> Analysis of [xiaolai/vmark](https://github.com/xiaolai/vmark) - A local-first Markdown editor with AI assistant integration

## Overview

VMark is a macOS Markdown editor built with Tauri v2, featuring a dual-engine architecture for WYSIWYG and source mode editing. It emphasizes AI assistant integration through MCP (Model Context Protocol).

**Version**: 0.2.0
**Target**: macOS (Apple Silicon + Intel)

---

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Tauri | 2.x |
| Frontend | React | 19.x |
| Language | TypeScript | 5.8 |
| Build Tool | Vite | 7.x |
| WYSIWYG Editor | Tiptap (ProseMirror) | Latest |
| Source Editor | CodeMirror | 6.x |
| State Management | Zustand | 5.x |
| Styling | Tailwind CSS | 4.x |
| Math Rendering | KaTeX | - |
| Diagrams | Mermaid | - |

---

## Architecture

### Directory Structure

```
src/
├── components/           # React UI components
│   ├── editor/          # Editor-related components
│   ├── sidebar/         # File browser, outline
│   ├── toolbar/         # Formatting toolbar
│   └── settings/        # Settings panel
├── plugins/             # 40+ editor plugins
│   ├── alertBlock/      # Alert/callout blocks
│   ├── autoPair/        # Auto bracket/quote pairing
│   ├── focusMode/       # Dimming non-focused paragraphs
│   ├── latex/           # LaTeX math rendering
│   ├── mermaid/         # Diagram support
│   ├── spellCheck/      # Spell checking
│   ├── syntaxReveal/    # Show/hide markdown syntax
│   ├── tableUI/         # Table operations
│   └── ... (40+ total)
├── stores/              # 30+ Zustand stores
├── utils/               # Utility functions
└── hooks/               # React hooks

src-tauri/               # Rust backend
├── src/
│   ├── main.rs
│   ├── commands/
│   └── services/
└── binaries/
    └── vmark-mcp-server  # External MCP server binary

vmark-mcp-server/        # MCP server (separate Rust crate)
├── src/
│   ├── main.rs
│   ├── tools/
│   └── websocket/
└── README.md
```

### WYSIWYG Implementation (Tiptap/ProseMirror)

VMark uses **Tiptap** (a headless ProseMirror wrapper) for its WYSIWYG editor. Key implementation details:

#### Core Editor Setup

```typescript
// Uses Tiptap Extension API for custom behaviors
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const editorKeymapExtension = Extension.create({
  name: "editorKeymaps",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: editorKeymapPluginKey,
        props: {
          handleKeyDown(view, event) {
            return handler(view, event);
          },
        },
      }),
    ];
  },
});
```

#### Mark Toggle System

VMark implements an "expanded toggle mark" system that intelligently handles:
- Selection-based formatting
- Word expansion when no selection
- Mark boundary escape with Escape key

```typescript
// Smart link insertion with clipboard URL detection
function handleSmartLinkShortcut(view: EditorView): boolean {
  const clipboardUrl = await readClipboardUrl();
  if (clipboardUrl && from !== to) {
    applyLinkWithUrl(view, from, to, clipboardUrl);
    return;
  }
  // Falls back to word expansion or link popup
}
```

#### Inline Math Handling

Special handling for math nodes with toggle behavior:
- Cursor at math node → unwrap to text
- Selection → wrap in math_inline
- No selection → insert empty math, enter edit mode

### Source Mode (CodeMirror 6)

Separate source editing mode using CodeMirror 6 with:
- Markdown syntax highlighting
- Syntax reveal (progressive disclosure of markdown tokens)
- Cursor context tracking

### State Management (Zustand v5)

VMark uses 30+ Zustand stores for fine-grained state management:

| Store | Purpose |
|-------|---------|
| `documentStore` | Document content, dirty state |
| `tabStore` | Multi-tab management |
| `editorStore` | Editor mode, cursor position |
| `settingsStore` | User preferences (13KB+ of settings) |
| `shortcutsStore` | Customizable keyboard shortcuts |
| `uiStore` | UI visibility states |
| `spellCheckStore` | Spell check suggestions |
| `searchStore` | Find/replace state |
| `workspaceStore` | Workspace/folder management |
| `terminalStore` | Built-in terminal state |
| Various popup stores | Link, image, math, footnote popups |

---

## Features

### Editor Features

| Feature | Description |
|---------|-------------|
| **Dual Engine** | Tiptap WYSIWYG + CodeMirror source mode |
| **Focus Mode** | Dims non-focused paragraphs |
| **Typewriter Mode** | Keeps cursor centered vertically |
| **Source Peek** | Quick view/edit markdown source |
| **Syntax Reveal** | Progressive disclosure of markdown syntax |
| **Multi-Selection** | Multi-cursor editing support |
| **IME Guard** | Proper CJK input method handling |

### Markdown Features

| Feature | Plugin |
|---------|--------|
| GFM Tables | `tableUI` |
| Task Lists | `checkbox` |
| Alert/Callout Blocks | `alertBlock` |
| Mermaid Diagrams | `mermaid` |
| LaTeX Math | `latex`, `blockMath` |
| Footnotes | `footnote` |
| Wiki Links | `wikiLink` |
| HTML Blocks | `htmlBlock` |
| Emoji | `emoji` |
| Highlight | `highlight` |
| Subscript/Superscript | `subscript`, `superscript` |
| Underline | `underline` |

### Full Plugin List (40+)

```
alertBlock          autoPair            blockMath
blockMathEditing    blockMathShortcuts  checkbox
cjkNewline          cjkPunctSpacing     cjkTrimSpaces
clipboardImagePaste codecopyButton      disableDropCursor
emoji               expandedToggleMark  findReplace
focusMode           footnote            globalStyles
hardBreak           heading             headingCursor
highlight           htmlBlock           htmlBlockEditing
htmlBlockPopup      htmlBlockShortcuts  imagePaste
inlineNodeEditing   latex               lineNumber
linkCursor          linkPopup           listItemText
markdownPaste       mermaid             mermaidEditing
multiSelection      openLink            placeholderCommand
scrollToFragment    smartNewline        smartTab
sourceCursorContext sourcePeek          spellCheck
strikethrough       subscript           superscript
syntaxReveal        tableUI             textAlign
toolbarActions      typewriterMode      underline
wikiLink            wikiLinkPopup
```

### Text Processing

- **CJK Support**: Proper handling of Chinese/Japanese/Korean text
  - `cjkNewline`: Smart line breaks for CJK
  - `cjkPunctSpacing`: Spacing around CJK punctuation
  - `cjkTrimSpaces`: Trim unnecessary spaces
- **Smart Newline**: Context-aware Enter behavior
- **Smart Tab**: Tab/Shift-Tab for list indentation
- **Hard Break Styles**: Configurable line break handling

### Spell Check

- Built-in spell checking
- Custom dictionary support
- Real-time suggestions

### File Management

- Multi-tab interface
- Workspace/folder support
- Recent files tracking
- File associations: `.md`, `.markdown`, `.mdown`, `.mkd`

---

## MCP (Model Context Protocol) Integration

VMark includes a standalone MCP server as an external binary, enabling AI assistant integration.

### Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│   VMark     │◄──────────────────►│  MCP Server      │
│   (Tauri)   │   localhost:4242   │  (Rust binary)   │
└─────────────┘                    └────────┬─────────┘
                                            │
                                            │ STDIO
                                            ▼
                                   ┌──────────────────┐
                                   │   Claude Code    │
                                   │   (AI Client)    │
                                   └──────────────────┘
```

### MCP Server Configuration

```json
{
  "mcpServers": {
    "vmark": {
      "command": "/path/to/vmark-mcp-server",
      "args": []
    }
  }
}
```

### MCP Tools (45 Tools)

#### Document Operations
| Tool | Description |
|------|-------------|
| `get_current_document` | Get active document info |
| `get_document_content` | Get document text content |
| `set_document_content` | Replace entire document |
| `insert_at_cursor` | Insert text at cursor |
| `insert_at_line` | Insert at specific line |

#### Selection Operations
| Tool | Description |
|------|-------------|
| `get_selection` | Get selected text and position |
| `set_selection` | Select text range |
| `select_all` | Select entire document |
| `select_block` | Select current block |
| `replace_selection` | Replace selected text |

#### Formatting Operations
| Tool | Description |
|------|-------------|
| `toggle_bold` | Toggle bold formatting |
| `toggle_italic` | Toggle italic |
| `toggle_code` | Toggle inline code |
| `toggle_strikethrough` | Toggle strikethrough |
| `toggle_highlight` | Toggle highlight |
| `set_heading` | Set heading level |
| `toggle_blockquote` | Toggle blockquote |
| `toggle_code_block` | Toggle code block |
| `insert_horizontal_rule` | Insert HR |

#### Block Operations
| Tool | Description |
|------|-------------|
| `insert_alert` | Insert alert/callout block |
| `insert_math` | Insert math block |
| `insert_mermaid` | Insert Mermaid diagram |
| `insert_image` | Insert image |
| `insert_link` | Insert hyperlink |

#### List Operations
| Tool | Description |
|------|-------------|
| `toggle_bullet_list` | Toggle bullet list |
| `toggle_numbered_list` | Toggle numbered list |
| `toggle_task_list` | Toggle task list |
| `toggle_task` | Toggle task completion |
| `indent_list` | Indent list item |
| `outdent_list` | Outdent list item |

#### Table Operations
| Tool | Description |
|------|-------------|
| `insert_table` | Create table |
| `add_table_row` | Add row |
| `add_table_column` | Add column |
| `delete_table_row` | Delete row |
| `delete_table_column` | Delete column |

#### Workspace Operations
| Tool | Description |
|------|-------------|
| `list_tabs` | List open tabs |
| `switch_tab` | Switch to tab |
| `create_document` | Create new document |
| `open_file` | Open file from path |
| `save_document` | Save current document |
| `close_tab` | Close tab |

#### AI-Specific Operations
| Tool | Description |
|------|-------------|
| `ai_continue` | Continue writing from cursor |
| `ai_rewrite` | Rewrite selected text |
| `ai_complete` | Auto-complete current line |
| `show_diff` | Show diff for proposed changes |

---

## Tauri Configuration

```json
{
  "productName": "VMark",
  "version": "0.2.0",
  "identifier": "app.vmark",
  "app": {
    "windows": [{
      "title": "VMark",
      "width": 800,
      "height": 600,
      "minWidth": 480,
      "minHeight": 400,
      "titleBarStyle": "Overlay",
      "hiddenTitle": true
    }],
    "security": {
      "csp": "default-src 'self'; img-src 'self' asset: https://asset.localhost blob: data:; style-src 'self' 'unsafe-inline'",
      "assetProtocol": {
        "enable": true,
        "scope": ["**/*"]
      }
    }
  },
  "bundle": {
    "fileAssociations": [{
      "ext": ["md", "markdown", "mdown", "mkd"],
      "mimeType": "text/markdown"
    }],
    "externalBin": ["binaries/vmark-mcp-server"]
  }
}
```

---

## Key Technical Decisions

### Why Tiptap over Other WYSIWYG Solutions?

1. **ProseMirror Foundation**: Battle-tested, well-documented schema system
2. **Headless Architecture**: Full control over rendering
3. **Plugin System**: Extensible without core modifications
4. **React Integration**: Clean React bindings
5. **TypeScript First**: Full type safety

### Why Separate MCP Server?

1. **Process Isolation**: MCP server runs independently
2. **Binary Distribution**: Bundled with app via `externalBin`
3. **WebSocket Bridge**: Connects STDIO-based MCP to GUI app
4. **Flexibility**: Can be used with other MCP clients

### Why Zustand v5?

1. **Minimal Boilerplate**: Simpler than Redux
2. **TypeScript Native**: Excellent type inference
3. **Performance**: Selective subscriptions
4. **DevTools Support**: Redux DevTools compatible

---

## Comparison: VMark vs mdpro

| Aspect | VMark | mdpro |
|--------|-------|-------|
| **Version** | 0.2.0 | 0.1.3 |
| **Framework** | Tauri 2.0 | Tauri 2.0 |
| **WYSIWYG Engine** | Tiptap (ProseMirror) | Milkdown (ProseMirror) |
| **Source Editor** | CodeMirror 6 | CodeMirror 6 |
| **State Management** | Zustand 5 | Zustand 4 |
| **Styling** | Tailwind CSS 4 | CSS Variables |
| **View Modes** | WYSIWYG, Source | Editor, Preview, Split, WYSIWYG |
| **Plugins** | 40+ | ~10 |
| **MCP Support** | Yes (WebSocket bridge) | No |
| **Focus Mode** | Yes | No |
| **Typewriter Mode** | Yes | No |
| **Spell Check** | Yes | No |
| **LaTeX Math** | Yes (KaTeX) | Planned |
| **Mermaid Diagrams** | Yes | Planned |
| **Multi-Window** | Yes | No |
| **Built-in Terminal** | Yes | No |
| **Min Window Size** | 480 x 400 | 400 x 640 |
| **File Extensions** | .md, .markdown, .mdown, .mkd | .md, .markdown |
| **CJK Support** | Dedicated plugins | Basic |
| **Markdown Parser (Rust)** | - | pulldown-cmark |
| **Markdown Parser (JS)** | markdown-it (via Tiptap) | marked + DOMPurify |

### Architecture Comparison

```
VMark Architecture:
┌─────────────────────────────────────────┐
│                 Tiptap                   │
│  ┌─────────────┐    ┌────────────────┐  │
│  │ ProseMirror │    │   40+ Plugins  │  │
│  │   Schema    │    │  (Extensions)  │  │
│  └─────────────┘    └────────────────┘  │
└─────────────────────────────────────────┘
         ↕ Bidirectional sync
┌─────────────────────────────────────────┐
│              CodeMirror 6               │
│         (Source Mode Only)              │
└─────────────────────────────────────────┘

mdpro Architecture:
┌─────────────────────────────────────────┐
│    CodeMirror 6 (Primary Editor)        │
│  ┌─────────────┐    ┌────────────────┐  │
│  │   Source    │    │    Split       │  │
│  │    Mode     │    │     View       │  │
│  └─────────────┘    └────────────────┘  │
└─────────────────────────────────────────┘
         ↓ One-way render
┌─────────────────────────────────────────┐
│    marked + DOMPurify (Preview)         │
│         OR                              │
│    Milkdown (WYSIWYG Mode)              │
└─────────────────────────────────────────┘
```

### Feature Gap Analysis

**VMark has, mdpro lacks:**
- MCP/AI assistant integration
- Focus mode (dim non-focused paragraphs)
- Typewriter mode (keep cursor centered)
- Spell checking
- LaTeX math rendering
- Mermaid diagram support
- Multi-window support
- Built-in terminal
- CJK-specific text processing
- 40+ editor plugins

**mdpro has, VMark lacks:**
- Preview-only mode
- Split view (editor + preview)
- Draft auto-save recovery
- HTML export with pulldown-cmark

### Recommendation for mdpro

Based on VMark's implementation, consider:

1. **WYSIWYG Plugin System**: Milkdown supports ProseMirror plugins similar to Tiptap
2. **Focus Mode**: Can be implemented with CSS opacity on non-focused blocks
3. **MCP Integration**: Consider WebSocket bridge pattern for AI assistant support
4. **Math/Diagrams**: KaTeX and Mermaid integration would enhance technical writing

---

*Generated: 2025-01-21*
