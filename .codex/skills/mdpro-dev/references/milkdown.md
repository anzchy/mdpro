# mdpro Milkdown Reference

## Architecture

```text
MilkdownEditor.tsx
  -> useEditor()
  -> Editor.make()
  -> commonmark, gfm, history, clipboard, listener
  -> project Milkdown plugins
```

The Zustand document store is the source of truth. Milkdown and CodeMirror both read from and write to the store.

## Editor Factory

Use `defaultValueCtx` for initial content and `listenerCtx.markdownUpdated` for sync.

The listener plugin must be used before listener callbacks are configured:

```ts
Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, root);
    ctx.set(defaultValueCtx, content);
    ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
      useDocumentStore.getState().updateContent(activeDocId, markdown);
    });
  })
  .use(listener)
  .use(commonmark)
  .use(gfm);
```

Common failure:
- Forgetting `.use(listener)` causes content sync to silently fail.

## Plugin Pattern

Plugins live under `src/plugins/milkdown/` and are registered through `src/plugins/index.ts`.

Plugin shape:

```ts
export const myPlugin = $prose(() => {
  return new Plugin({
    key: myPluginKey,
    props: {
      handleDOMEvents: {
        paste: (view, event) => false,
      },
    },
  });
});
```

Plugin CSS stays colocated with the plugin file.

## ProseMirror Commands

For direct document manipulation, prefer ProseMirror/Milkdown transactions rather than DOM mutation.

When dispatching after async UI callbacks:
- check the editor/view is still alive
- avoid captured stale `state`, `dispatch`, or selection
- re-read fresh editor state before applying changes

## External Content Changes

For MCP or file watcher updates, replace the full document through Milkdown utilities such as `replaceAll(newMarkdown)` so normal transaction/listener flow keeps Zustand synchronized.

## Mode Switching

On WYSIWYG, Source, and Split mode switches:
1. Read current content from the document store.
2. Initialize the remounted editor from that content.
3. Continue syncing edits back to the store.

## Testing

Test logic, not the full editor integration.

Good seams:
- clipboard item extraction
- markdown transforms
- command predicates
- position calculations

Mock editor APIs at boundaries. Avoid rendering the full Milkdown editor in unit tests unless the behavior cannot be isolated.

