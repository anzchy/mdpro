# Quickstart: Polish WYSIWYG Editor

**Feature**: 002-polish-wysiwyg | **Date**: 2026-01-19

## Prerequisites

- Node.js 18+ with pnpm
- Rust toolchain (for Tauri)
- Xcode Command Line Tools (macOS)

## Setup Steps

### 1. Install Milkdown Dependencies

```bash
cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro
pnpm add @milkdown/kit @milkdown/react
```

### 2. Verify Installation

```bash
pnpm tauri dev
```

The app should launch without errors. Milkdown packages are now available.

---

## Implementation Order

Follow this sequence to implement the feature incrementally:

### Phase 1: View Mode Cycling (P1)

1. **Update `editorStore.ts`**: Add `cycleViewMode()` method
2. **Update `useKeyboardShortcuts.ts`**: Add ⌘/ handler
3. **Update `menu.rs`**: Change ⌃1-4 shortcuts, add ⌘/ menu item
4. **Test**: Verify cycling works with all four modes

### Phase 2: Preview Mode Fix (P2)

1. **Update `SplitView.tsx`**: Route `preview-only` to `Preview` component
2. **Remove WYSIWYG from preview**: Ensure preview is read-only HTML
3. **Test**: Verify preview matches split view right pane

### Phase 3: Milkdown Integration (P3)

1. **Create `MilkdownEditor.tsx`**: New WYSIWYG component
2. **Create `useMilkdown.ts`**: Hook for editor lifecycle
3. **Update `App.tsx`**: Route `wysiwyg` mode to MilkdownEditor
4. **Remove `WysiwygView.tsx`**: Delete old CodeMirror-based WYSIWYG
5. **Test**: Verify WYSIWYG editing with round-trip to Editor mode

---

## Key Files to Create/Modify

### New Files

| File | Description |
|------|-------------|
| `src/components/Editor/MilkdownEditor.tsx` | Milkdown WYSIWYG component |
| `src/hooks/useMilkdown.ts` | Milkdown editor hook |

### Modified Files

| File | Changes |
|------|---------|
| `src/App.tsx` | Add view mode routing logic |
| `src/stores/editorStore.ts` | Add `cycleViewMode()` |
| `src/hooks/useKeyboardShortcuts.ts` | Add ⌘/ and ⌃1-4 handlers |
| `src/components/Editor/SplitView.tsx` | Fix preview-only routing |
| `src-tauri/src/menu.rs` | Update View menu shortcuts |
| `src-tauri/src/commands/preferences.rs` | Add lastViewMode field |

### Removed Files

| File | Reason |
|------|--------|
| `src/components/Editor/WysiwygView.tsx` | Replaced by MilkdownEditor |

---

## MilkdownEditor Skeleton

```tsx
// src/components/Editor/MilkdownEditor.tsx

import { useEffect } from 'react'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { useDocumentStore } from '../../stores/documentStore'

function MilkdownEditorInner() {
  const content = useDocumentStore(s => s.content)
  const setContent = useDocumentStore(s => s.setContent)

  const { get } = useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, content)
        ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
          setContent(markdown)
        })
      })
      .use(commonmark)
      .use(history)
      .use(listener)
  )

  return <Milkdown />
}

export function MilkdownEditor() {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner />
    </MilkdownProvider>
  )
}
```

---

## Testing Checklist

- [ ] ⌘/ cycles through all four modes in order
- [ ] ⌃1 switches to Split view
- [ ] ⌃2 switches to Editor-only view
- [ ] ⌃3 switches to Preview view (read-only HTML)
- [ ] ⌃4 switches to WYSIWYG view
- [ ] Preview mode matches split view right pane
- [ ] WYSIWYG mode: typing `# Hello` creates heading
- [ ] WYSIWYG mode: typing `**bold**` creates bold text
- [ ] Switching WYSIWYG → Editor preserves Markdown
- [ ] ⌘1-6 creates H1-H6 in WYSIWYG mode
- [ ] Documents >500KB auto-switch to Editor mode with toast

---

## Common Issues

### Milkdown not rendering
- Ensure `MilkdownProvider` wraps the component
- Check that `rootCtx` is properly set

### Content not syncing
- Verify `listenerCtx.markdownUpdated` callback is registered
- Check Zustand store connection

### Shortcuts not working
- Verify Rust menu emits correct events
- Check React hook is mounted
