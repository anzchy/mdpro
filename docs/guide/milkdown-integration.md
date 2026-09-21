# Milkdown Integration

This document explains how Milkdown is integrated into mdpro for WYSIWYG editing.

## What is Milkdown?

[Milkdown](https://milkdown.dev/) is a plugin-driven WYSIWYG Markdown editor built on:
- **ProseMirror** - The underlying rich text editing framework
- **remark** - Markdown parsing and serialization

Unlike CodeMirror (which shows markdown source), Milkdown renders markdown as rich text while maintaining full markdown compatibility.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MilkdownEditor.tsx                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  MilkdownProvider (React Context)                     │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  MilkdownEditorInner                            │  │  │
│  │  │  - Reads from documentStore                     │  │  │
│  │  │  - Calls useMilkdown() hook                     │  │  │
│  │  │  - Renders <Milkdown /> component               │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     useMilkdown.ts                           │
│                                                              │
│  - Creates Milkdown Editor instance                          │
│  - Configures core plugins (commonmark, history, listener)   │
│  - Loads Milkdown plugins from pluginRegistry                │
│  - Handles markdown change events                            │
│  - Provides getMarkdown() for serialization                  │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### MilkdownEditor.tsx

The React component that renders the Milkdown editor.

```tsx
export function MilkdownEditor() {
  return (
    <div className="milkdown-editor">
      <MilkdownProvider>
        <MilkdownEditorInner />
      </MilkdownProvider>
    </div>
  );
}
```

**Key implementation details:**

1. **Provider Pattern**: `MilkdownProvider` provides React context for Milkdown
2. **Store Integration**: Reads `activeDocumentId` and `content` from `documentStore`
3. **Memoized Initial Content**: Uses `useMemo` with `activeDocumentId` dependency to prevent re-initialization during typing

### useMilkdown.ts Hook

Custom hook that manages the Milkdown editor lifecycle.

```tsx
export function useMilkdown({
  markdown,
  documentId,
  onMarkdownChange,
}: UseMilkdownOptions): MilkdownApi & { loading: boolean }
```

**Plugin Stack:**

| Plugin | Purpose |
|--------|---------|
| `commonmark` | Standard Markdown syntax support |
| `history` | Undo/redo functionality |
| `listener` | Document change notifications |
| `typoraKeymap` | Custom keyboard shortcuts (plugin) |
| `inlineEdit` | Typora-style inline editing (plugin) |

## Content Synchronization

### Problem: Infinite Render Loop

Early implementation had a cleanup effect that called `onSerialize()` on unmount, which updated the store, triggered a re-render, and caused an infinite loop.

### Solution: Listener-Based Sync

Content sync now uses Milkdown's `markdownUpdated` listener:

```tsx
instance.action((ctx) => {
  const manager = ctx.get(listenerCtx);
  manager.markdownUpdated((_ctx, nextMarkdown) => {
    if (nextMarkdown === lastMarkdownRef.current) return;
    lastMarkdownRef.current = nextMarkdown;
    onMarkdownChangeRef.current?.(nextMarkdown);
  });
});
```

**Key safeguards:**
1. **Ref-based callbacks**: `onMarkdownChangeRef` prevents effect re-runs
2. **Deduplication**: Skip update if content hasn't changed
3. **No cleanup serialization**: Removed the problematic cleanup effect

## Typora-Style Keymap

Custom keymap providing familiar shortcuts via `src/plugins/milkdown/typoraKeymapPlugin.ts`:

```tsx
const createTyporaKeymap = () =>
  $useKeymap("typora", {
  heading1: { shortcuts: "Mod-1", command: ... },
  heading2: { shortcuts: "Mod-2", command: ... },
  // ... heading3-6
  paragraph: { shortcuts: "Mod-0", command: ... },
  bold: { shortcuts: "Mod-b", command: ... },
  italic: { shortcuts: "Mod-i", command: ... },
  link: { shortcuts: "Mod-k", command: ... },
});
```

| Shortcut | Action |
|----------|--------|
| ⌘1-6 | Heading 1-6 |
| ⌘0 | Paragraph |
| ⌘B | Bold |
| ⌘I | Italic |
| ⌘K | Insert link |

## Editor Instance Management

### Creating the Editor

```tsx
const editor = useEditor(
  (root) =>
    pluginRegistry.getMilkdownPlugins().reduce(
      (builder, plugin) => builder.use(plugin),
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialMarkdown);
        })
        .use(commonmark)
        .use(history)
        .use(listener),
    ),
  [documentId],  // Recreate when document changes
);
```

### Getting Markdown Content

```tsx
const getMarkdown = useCallback(() => {
  const instance = editor.get();
  if (!instance) return null;
  return instance.action((ctx) => {
    const serializer = ctx.get(serializerCtx);
    const view = ctx.get(editorViewCtx);
    return serializer(view.state.doc);
  });
}, [editor]);
```

## Dependencies

```json
{
  "@milkdown/kit": "^7.x",
  "@milkdown/react": "^7.x"
}
```

## Troubleshooting

### Black Screen in WYSIWYG Mode

**Cause**: Infinite render loop from cleanup effect
**Solution**: Remove `onSerialize` cleanup, use listener-based sync

### Content Not Syncing

**Check**:
1. `onMarkdownChange` callback is provided
2. `documentId` is not null
3. No errors in console from Milkdown

### Performance Issues with Large Files

**Solution**: App auto-switches to source mode for documents whose source
structure score (lines + table cells) exceeds 25,000 — see
[ADR-0016](../adr/0016-large-document-guard-predicate-is-a-source-structure-score.md)
— or whose longest single line exceeds 1,000,000 characters, see
[ADR-0019](../adr/0019-large-document-guard-adds-a-longest-line-trigger.md).
File size is not the judgement variable.

## Related Documentation

- [Architecture Overview](./architecture.md)
- [View Modes](./view-modes.md)
- [State Management](./state-management.md)
