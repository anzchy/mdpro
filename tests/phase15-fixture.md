# Phase 15 Fixture Document

This document is a manual fixture for Phase 15 testing. It is designed to touch all major areas that should be covered by unit, component, and E2E tests.

## 1. Headings and Paragraphs

### H3 Heading

Regular paragraph with **bold**, *italic*, and `inline code`.

Another paragraph to test line wrapping and preview rendering. This line is intentionally long to make scrolling easier. Repeat: long line to make scrolling easier. Repeat: long line to make scrolling easier.

## 2. Lists

- Unordered item A
- Unordered item B
  - Nested item B.1
  - Nested item B.2
- Unordered item C

1. Ordered item 1
2. Ordered item 2
3. Ordered item 3

## 3. Task List (GFM)

- [ ] Task item unchecked
- [x] Task item checked

## 4. Links and Images

- Link to external site: [Example](https://example.com)
- Link with title: [Example Title](https://example.com "Example Title")
- Image (expected to fail in offline tests): ![Broken Image](https://example.com/does-not-exist.png)

## 5. Blockquote

> This is a blockquote.
> It spans multiple lines.

## 6. Code Blocks

```ts
export function sum(a: number, b: number): number {
  return a + b;
}
```

```rust
pub fn greet(name: &str) -> String {
  format!("Hello, {}", name)
}
```

```json
{
  "name": "mdpro",
  "features": ["preview", "autosave", "export"],
  "enabled": true
}
```

## 7. Tables

| Feature | Status | Notes |
| --- | --- | --- |
| Preview | Ready | Should render in split and preview modes |
| Autosave | Ready | Should create draft entries |
| Export | Ready | Should export HTML |

## 8. Inline HTML (Mark and Underline)

<mark style="background: #FF5582A6;">Marked text for highlight rendering.</mark>

<u>Underlined text for custom tag rendering.</u>

## 9. Strikethrough

~~This line is struck through.~~

## 10. Horizontal Rule

---

## 11. Long Section for Scroll Sync

Paragraph 1. Scroll sync should keep editor and preview aligned.

Paragraph 2. Scroll sync should keep editor and preview aligned.

Paragraph 3. Scroll sync should keep editor and preview aligned.

Paragraph 4. Scroll sync should keep editor and preview aligned.

Paragraph 5. Scroll sync should keep editor and preview aligned.

Paragraph 6. Scroll sync should keep editor and preview aligned.

Paragraph 7. Scroll sync should keep editor and preview aligned.

Paragraph 8. Scroll sync should keep editor and preview aligned.

Paragraph 9. Scroll sync should keep editor and preview aligned.

Paragraph 10. Scroll sync should keep editor and preview aligned.

## 12. Autosave and Recovery Marker

Change this line to force an autosave draft entry. Save the file after editing to confirm the draft is removed.

## 13. Export Marker

Export this document to HTML and verify inline styles are applied in the output.

## 14. View Mode Marker

Switch between split, editor-only, preview-only, and WYSIWYG modes while this document is open.
