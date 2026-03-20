---
name: milkdown-dev
description: Milkdown 7 development patterns for mdpro — plugin system, content sync, ProseMirror commands, and WYSIWYG editor integration.
---

# Milkdown Dev Skill

Reference guide for building features in mdpro's Milkdown WYSIWYG editor (`src/components/Editor/MilkdownEditor.tsx`).

---

## 1. Architecture Overview

```
MilkdownEditor.tsx
  └── useEditor() (from @milkdown/react)
        └── Editor.make()
              ├── commonmark preset    (@milkdown/kit/preset/commonmark)
              ├── gfm preset           (@milkdown/kit/preset/gfm)
              ├── history plugin       (@milkdown/kit/plugin/history)
              ├── clipboard plugin     (@milkdown/kit/plugin/clipboard)
              ├── imagePastePlugin     (src/plugins/milkdown/imagePastePlugin.ts)
              └── ... more plugins
```

The editor is initialized once with `defaultValueCtx` for initial content. Content sync back to the Zustand store requires `@milkdown/plugin-listener`.

---

## 2. Editor Factory Pattern

```typescript
// src/components/Editor/MilkdownEditor.tsx
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { useEditor, Milkdown } from '@milkdown/react';

const { get } = useEditor((root) =>
  Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, initialContent);

      // Register onChange listener (CRITICAL for content sync)
      ctx.get(listenerCtx).markdownUpdated((ctx, markdown) => {
        onContentChange(markdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)          // must be used before .config() registers listener
    // ... add more plugins
);
```

**Common mistake:** Forgetting to `.use(listener)` before registering `listenerCtx` callbacks causes a silent no-op — the onChange never fires.

---

## 3. Content Sync to Zustand (CRIT-02 fix pattern)

The canonical pattern for syncing Milkdown content back to the document store:

```typescript
// In MilkdownEditor.tsx
import { useDocumentStore } from '../../stores/documentStore';

const { get } = useEditor((root) =>
  Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, content);
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        // Update store — debounce if needed for performance
        useDocumentStore.getState().updateContent(activeDocId, markdown);
      });
    })
    .use(listener)
    .use(commonmark)
    .use(gfm)
    // ...
);
```

**Why `getState()` not a hook:** The listener callback runs outside React's render cycle. Use `useXStore.getState()` for imperative access in event handlers.

---

## 4. Writing a Milkdown Plugin

A Milkdown plugin is a factory function returning a `MilkdownPlugin`:

```typescript
// src/plugins/milkdown/myPlugin.ts
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

const myPluginKey = new PluginKey('myPlugin');

export const myPlugin = $prose(() => {
  return new Plugin({
    key: myPluginKey,
    props: {
      handleDOMEvents: {
        paste: (view, event) => {
          // handle paste
          return false; // return true to consume event
        },
      },
    },
  });
});
```

Register in `src/plugins/index.ts`:
```typescript
import { myPlugin } from './milkdown/myPlugin';
// add to the milkdown plugin array
```

Use in the editor factory:
```typescript
.use(myPlugin)
```

**Reference implementation:** `src/plugins/milkdown/imagePastePlugin.ts` — a complete paste-handling plugin with Tauri IPC integration.

---

## 5. ProseMirror Transaction Basics

Milkdown uses ProseMirror under the hood. For direct document manipulation:

```typescript
import { commandsCtx } from '@milkdown/kit/core';
import { wrapInList } from '@milkdown/kit/prose/commands';

// Execute a command via the editor instance
const editor = get(); // from useEditor's return
editor?.action((ctx) => {
  const commands = ctx.get(commandsCtx);
  commands.call(myCommandKey);
});
```

For custom ProseMirror commands:

```typescript
import { EditorView } from '@milkdown/kit/prose/view';

function myCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  if (!dispatch) return true; // dry run check
  const tr = state.tr.insertText('hello', state.selection.from);
  dispatch(tr);
  return true;
}
```

---

## 6. Applying External Content Changes

When the MCP server or file watcher changes the document, apply to Milkdown:

```typescript
import { replaceAll } from '@milkdown/kit/utils';

// Replace entire document content
editor?.action(replaceAll(newMarkdown));
```

This fires through the normal ProseMirror transaction flow and triggers `listenerCtx` callbacks — so Zustand stays in sync.

---

## 7. Plugin Registration Pattern

```typescript
// src/plugins/index.ts
import { imagePastePlugin } from './milkdown/imagePastePlugin';
import { myNewPlugin } from './milkdown/myNewPlugin';

export const milkdownPlugins = [
  imagePastePlugin,
  myNewPlugin,
  // ...
];

// src/components/Editor/MilkdownEditor.tsx
import { milkdownPlugins } from '../../plugins';

Editor.make()
  // ...
  .use(milkdownPlugins)  // spread array or chain individually
```

---

## 8. Content Mode Switching

mdpro has three view modes (WYSIWYG / Source / Split). When switching:

1. Read current content from `documentStore`
2. Pass as `defaultValueCtx` to new editor instance (Milkdown remounts on mode switch)
3. The `listenerCtx` callback ensures Milkdown → store sync continues

The store is the **single source of truth** for document content. Neither Milkdown nor CodeMirror is authoritative — both read from and write to the store.

---

## 9. Testing Milkdown Plugins

Test the logic layer, not the editor integration:

```typescript
// src/plugins/milkdown/myPlugin.test.ts
import { extractImageFromClipboard } from './imagePastePlugin';

it('extracts PNG from clipboard items', () => {
  const mockItem = { type: 'image/png', getAsFile: () => new File([], 'img.png') };
  const result = extractImageFromClipboard([mockItem] as any);
  expect(result).not.toBeNull();
});
```

Mock the editor APIs at boundaries — don't render the full Milkdown editor in unit tests.
