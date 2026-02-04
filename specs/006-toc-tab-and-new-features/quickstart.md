# Quickstart Guide: Feature 006 Implementation

**Feature Branch**: `006-toc-tab-and-new-features`
**Date**: 2026-02-03
**Prerequisites**: Working mdpro development environment

## Overview

This guide provides step-by-step instructions for implementing the five features in this bundle:
1. TOC Sidebar
2. Multi-Tab Support
3. Auto-Save
4. Table Editing
5. Image Rendering

## Development Setup

```bash
# Ensure you're on the feature branch
git checkout 006-toc-tab-and-new-features

# Install dependencies
pnpm install

# Start development
pnpm tauri dev
```

---

## Feature 1: TOC Sidebar

### Step 1: Create TOC Store

```bash
# Create the store file
touch src/stores/tocStore.ts
```

```typescript
// src/stores/tocStore.ts
import { create } from 'zustand';

interface TOCEntry {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  lineNumber: number;
  offset: number;
  isActive: boolean;
}

interface TOCState {
  entries: TOCEntry[];
  activeEntryId: string | null;
  isVisible: boolean;

  setEntries: (entries: TOCEntry[]) => void;
  setActiveEntry: (id: string | null) => void;
  toggleVisibility: () => void;
}

export const useTOCStore = create<TOCState>((set) => ({
  entries: [],
  activeEntryId: null,
  isVisible: false,

  setEntries: (entries) => set({ entries }),
  setActiveEntry: (activeEntryId) => set({ activeEntryId }),
  toggleVisibility: () => set((state) => ({ isVisible: !state.isVisible })),
}));
```

### Step 2: Create Rust Command

```bash
# Create the command file
touch src-tauri/src/commands/toc.rs
```

```rust
// src-tauri/src/commands/toc.rs
use pulldown_cmark::{Parser, Event, Tag, Options};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct HeadingInfo {
    pub id: String,
    pub level: u8,
    pub text: String,
    pub line: usize,
    pub offset: usize,
}

#[tauri::command]
pub fn get_document_headings(content: String) -> Vec<HeadingInfo> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(&content, options);
    let mut headings = Vec::new();
    let mut id_counts: HashMap<String, usize> = HashMap::new();
    let mut current_heading: Option<(u8, String, usize)> = None;

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::Heading(level, _, _)) => {
                let line = content[..range.start].matches('\n').count() + 1;
                current_heading = Some((level as u8, String::new(), line));
            }
            Event::Text(text) if current_heading.is_some() => {
                if let Some((_, ref mut content, _)) = current_heading {
                    content.push_str(&text);
                }
            }
            Event::End(Tag::Heading(..)) => {
                if let Some((level, text, line)) = current_heading.take() {
                    let id = generate_unique_id(&text, &mut id_counts);
                    headings.push(HeadingInfo {
                        id,
                        level,
                        text,
                        line,
                        offset: range.start,
                    });
                }
            }
            _ => {}
        }
    }

    headings
}

fn generate_unique_id(text: &str, counts: &mut HashMap<String, usize>) -> String {
    let base_id: String = text
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let base_id = base_id.trim_matches('-').to_string();

    let count = counts.entry(base_id.clone()).or_insert(0);
    let id = if *count == 0 {
        base_id.clone()
    } else {
        format!("{}-{}", base_id, count)
    };
    *count += 1;
    id
}
```

### Step 3: Register Command

```rust
// src-tauri/src/commands/mod.rs
pub mod toc;

// In handlers() function, add:
.invoke_handler(tauri::generate_handler![
    // ... existing handlers
    toc::get_document_headings,
])
```

### Step 4: Create TOC Component

```typescript
// src/components/Sidebar/TOCSidebar.tsx
import { useTOCStore } from '@/stores/tocStore';
import { useEffect, useRef } from 'react';

export function TOCSidebar() {
  const { entries, activeEntryId, setActiveEntry } = useTOCStore();
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Spy scrolling with Intersection Observer
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveEntry(entry.target.id);
          }
        }
      },
      { rootMargin: '0px 0px -66% 0px' }
    );

    // Observe all headings
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [entries]);

  const handleClick = (id: string, offset: number) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: 'smooth' });
    setActiveEntry(id);
  };

  if (entries.length === 0) {
    return (
      <div className="toc-empty">
        <p>No headings found</p>
        <p className="text-muted">Add headings (# H1, ## H2) to see the table of contents</p>
      </div>
    );
  }

  return (
    <nav className="toc-sidebar">
      <h3>Table of Contents</h3>
      <ul>
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={`toc-entry level-${entry.level} ${activeEntryId === entry.id ? 'active' : ''}`}
            style={{ paddingLeft: `${(entry.level - 1) * 12}px` }}
          >
            <button onClick={() => handleClick(entry.id, entry.offset)}>
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

### Step 5: Test TOC

1. Open a document with multiple headings
2. Press `Cmd+Shift+B` to toggle TOC
3. Verify headings appear hierarchically
4. Click entries to scroll
5. Verify active highlighting while scrolling

---

## Feature 2: Multi-Tab Support

### Step 1: Create Tab Store

```typescript
// src/stores/tabStore.ts
import { create } from 'zustand';
import { nanoid } from 'nanoid';

interface Tab {
  id: string;
  documentId: string;
  title: string;
  isDirty: boolean;
  isPinned: boolean;
  order: number;
  state: TabState;
  lastActiveAt: number;
}

interface TabState {
  scrollTop: number;
  cursorPosition: { line: number; column: number };
  viewMode: 'split' | 'editor' | 'preview' | 'wysiwyg';
}

interface TabStore {
  tabs: Tab[];
  activeTabId: string | null;
  closedTabs: Tab[];

  openTab: (documentId: string, title: string) => string;
  closeTab: (tabId: string) => void;
  switchToTab: (tabId: string) => void;
  setTabDirty: (tabId: string, isDirty: boolean) => void;
  // ... more actions
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  closedTabs: [],

  openTab: (documentId, title) => {
    // Check if already open
    const existing = get().tabs.find(t => t.documentId === documentId);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const id = nanoid();
    const newTab: Tab = {
      id,
      documentId,
      title,
      isDirty: false,
      isPinned: false,
      order: get().tabs.length,
      state: { scrollTop: 0, cursorPosition: { line: 1, column: 0 }, viewMode: 'wysiwyg' },
      lastActiveAt: Date.now(),
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id,
    }));

    return id;
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId, closedTabs } = get();
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Add to closed tabs (max 10)
    const newClosedTabs = [tab, ...closedTabs].slice(0, 10);

    // Find next tab (MRU)
    let nextTabId: string | null = null;
    if (activeTabId === tabId && tabs.length > 1) {
      const sorted = [...tabs]
        .filter(t => t.id !== tabId)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      nextTabId = sorted[0]?.id ?? null;
    }

    set({
      tabs: tabs.filter(t => t.id !== tabId),
      activeTabId: activeTabId === tabId ? nextTabId : activeTabId,
      closedTabs: newClosedTabs,
    });
  },

  switchToTab: (tabId) => {
    set((state) => ({
      activeTabId: tabId,
      tabs: state.tabs.map(t =>
        t.id === tabId ? { ...t, lastActiveAt: Date.now() } : t
      ),
    }));
  },

  setTabDirty: (tabId, isDirty) => {
    set((state) => ({
      tabs: state.tabs.map(t =>
        t.id === tabId ? { ...t, isDirty } : t
      ),
    }));
  },
}));
```

### Step 2: Create TabBar Component

```typescript
// src/components/TabBar/TabBar.tsx
import { useTabStore } from '@/stores/tabStore';

export function TabBar() {
  const { tabs, activeTabId, switchToTab, closeTab } = useTabStore();

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => switchToTab(tab.id)}
          onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
        >
          <span className="tab-title">{tab.title}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            {tab.isDirty ? '●' : '×'}
          </button>
        </div>
      ))}
      <button className="new-tab" onClick={() => {/* create new doc */}}>
        +
      </button>
    </div>
  );
}
```

### Step 3: Add CSS Animation

```css
/* src/styles/tabs.css */
.tab-content {
  opacity: 0;
  transition: opacity 300ms ease-in-out;
}

.tab-content.active {
  opacity: 1;
}

/* Never use transform for tab transitions */
```

---

## Feature 3: Auto-Save

### Step 1: Update useAutoSave Hook

```typescript
// src/hooks/useAutoSave.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface UseAutoSaveOptions {
  documentId: string;
  content: string;
  filePath: string | null;
  debounceMs?: number;
}

export function useAutoSave({
  documentId,
  content,
  filePath,
  debounceMs = 1500,
}: UseAutoSaveOptions) {
  const [saveInProgress, setSaveInProgress] = useState(false);
  const lastContent = useRef(content);
  const timerRef = useRef<NodeJS.Timeout>();

  const save = useCallback(async () => {
    if (!filePath || saveInProgress) return;
    if (content === lastContent.current) return;

    setSaveInProgress(true);
    try {
      await invoke('save_document_silent', {
        document_id: documentId,
        content,
      });
      lastContent.current = content;
    } catch (error) {
      console.error('Auto-save failed:', error);
      // Show toast notification
    } finally {
      setSaveInProgress(false);
    }
  }, [documentId, content, filePath, saveInProgress]);

  // Debounced save
  useEffect(() => {
    if (!filePath) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(save, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [content, debounceMs, save, filePath]);

  // Save on blur
  useEffect(() => {
    const handleBlur = () => save();
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [save]);

  return { saveInProgress };
}
```

### Step 2: Add Rust Command

```rust
// src-tauri/src/commands/file.rs (add to existing)

#[tauri::command]
pub async fn save_document_silent(
    document_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<SaveResult, CommandError> {
    let documents = state.documents.lock().await;
    let doc = documents.get(&document_id)
        .ok_or(CommandError::DocumentNotFound)?;

    let path = doc.path.as_ref()
        .ok_or(CommandError::NoFilePath)?;

    // Write content
    std::fs::write(path, &content)?;

    Ok(SaveResult {
        success: true,
        path: path.clone(),
        saved_at: chrono::Utc::now().timestamp_millis(),
    })
}
```

---

## Feature 4: Table Editing

### Step 1: Create Context Menu Component

```typescript
// src/components/Editor/TableContextMenu.tsx
import { useEffect, useRef } from 'react';

interface Props {
  position: { x: number; y: number };
  onAction: (action: string) => void;
  onClose: () => void;
}

const MENU_ITEMS = [
  { type: 'insertRowAbove', label: 'Insert Row Above' },
  { type: 'insertRowBelow', label: 'Insert Row Below', shortcut: '⌘⏎' },
  { type: 'separator' },
  { type: 'insertColumnLeft', label: 'Insert Column Left' },
  { type: 'insertColumnRight', label: 'Insert Column Right' },
  { type: 'separator' },
  { type: 'alignLeft', label: 'Align Left' },
  { type: 'alignCenter', label: 'Align Center' },
  { type: 'alignRight', label: 'Align Right' },
  { type: 'separator' },
  { type: 'deleteRow', label: 'Delete Row', destructive: true },
  { type: 'deleteColumn', label: 'Delete Column', destructive: true },
];

export function TableContextMenu({ position, onAction, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: position.y, left: position.x }}
    >
      {MENU_ITEMS.map((item, i) =>
        item.type === 'separator' ? (
          <div key={i} className="separator" />
        ) : (
          <button
            key={item.type}
            className={`menu-item ${item.destructive ? 'destructive' : ''}`}
            onClick={() => onAction(item.type)}
          >
            {item.label}
            {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}
```

### Step 2: Wire Up to Milkdown

See `contracts/table-commands.md` for full Milkdown plugin integration.

---

## Feature 5: Image Rendering

### Step 1: Create Image Service

```typescript
// src/services/imageService.ts
import { invoke } from '@tauri-apps/api/core';

export async function resolveImagePath(
  documentPath: string,
  imagePath: string
) {
  return invoke<ResolveImagePathResult>('resolve_image_path', {
    document_path: documentPath,
    image_path: imagePath,
  });
}

export async function uploadImage(
  documentPath: string,
  imageData: string,
  filename: string
) {
  return invoke<UploadImageResult>('upload_image', {
    document_path: documentPath,
    image_data: imageData,
    filename,
  });
}
```

### Step 2: Create useImageUpload Hook

```typescript
// src/hooks/useImageUpload.ts
import { useCallback } from 'react';
import { uploadImage } from '@/services/imageService';

export function useImageUpload(documentPath: string | null) {
  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    if (!documentPath) return;

    const files = Array.from(e.dataTransfer?.files ?? [])
      .filter(f => f.type.startsWith('image/'));

    for (const file of files) {
      const base64 = await fileToBase64(file);
      const result = await uploadImage(documentPath, base64, file.name);
      // Insert markdown at cursor
      insertAtCursor(result.markdownSyntax);
    }
  }, [documentPath]);

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!documentPath) return;

    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return;

    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;

    const base64 = await fileToBase64(file);
    const filename = `image-${Date.now()}.png`;
    const result = await uploadImage(documentPath, base64, filename);
    insertAtCursor(result.markdownSyntax);
  }, [documentPath]);

  return { handleDrop, handlePaste };
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // Remove data:... prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

---

## Testing Checklist

### TOC Sidebar
- [ ] Headings H1-H6 are extracted
- [ ] Hierarchical indentation is correct
- [ ] Clicking entry scrolls to heading
- [ ] Active entry highlights on scroll
- [ ] Duplicate headings have unique IDs
- [ ] Empty state shows when no headings

### Multi-Tab
- [ ] New tab opens for new documents
- [ ] Switching tabs preserves scroll position
- [ ] Dirty indicator shows for unsaved changes
- [ ] Cmd+W closes active tab
- [ ] Middle-click closes tab
- [ ] Closing dirty tab prompts to save
- [ ] Undo close tab restores last closed

### Auto-Save
- [ ] Auto-saves after typing pause
- [ ] Cmd+S saves silently for existing files
- [ ] Cmd+S shows Save As for new files
- [ ] Save-in-progress prevents double-save
- [ ] Saves on window blur
- [ ] Configurable intervals work

### Table Editing
- [ ] Context menu appears on right-click
- [ ] Insert row/column works
- [ ] Delete row/column works
- [ ] Alignment persists to Markdown
- [ ] Tab navigates between cells
- [ ] Cmd+Enter inserts row below

### Image Rendering
- [ ] Local images render
- [ ] Remote URLs render
- [ ] Broken images show placeholder
- [ ] Drag-drop inserts image
- [ ] Paste from clipboard works
- [ ] Images saved to ./assets folder

---

## Next Steps

After completing basic implementation:
1. Run `/speckit.tasks` to generate detailed tasks.md
2. Create PR for code review
3. Run E2E tests with Playwright
