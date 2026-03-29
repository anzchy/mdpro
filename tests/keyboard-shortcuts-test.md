# Keyboard Shortcuts Test Suite

> 目标：系统化测试 mdpro 的所有键盘快捷键，特别是 WYSIWYG 模式。每个用例标注通过/失败状态，并链接相关 GitHub issue。
>
> **测试依据**：静态代码分析 (`menu.rs`, `useKeyboardShortcuts.ts`, `typoraKeymapPlugin.ts`, `preferences.ts`, `keyboard-shortcuts.md`)。
> **测试日期**：2026-03-21

## 1. 使用说明

- `范围`：所有文档中标注的键盘快捷键，重点测试 WYSIWYG 模式。
- `执行方式`：
  - 自动化：部分快捷键可用 Playwright 覆盖 `pnpm dev` 模式。
  - 手工：需要 `pnpm tauri dev` 测试原生菜单快捷键和 Tauri API 行为。
- `通过标准`：
  - 快捷键触发预期行为，不崩溃。
  - 行为与 `docs/guide/keyboard-shortcuts.md` 文档一致。

## 2. 优先级定义

- `P0`：快捷键完全无效或触发错误行为（数据丢失风险）。
- `P1`：核心编辑快捷键失效或行为异常。
- `P2`：边缘场景偏差、文档与实现不一致。

---

## A. 全局快捷键（所有模式）

| ID | 快捷键 | 预期行为 | 状态 | 备注 |
|----|--------|----------|------|------|
| `KC-GLOBAL-001` (P1) | ⌘N | 新建文档 | ✅ | `useKeyboardShortcuts.ts:76` |
| `KC-GLOBAL-002` (P1) | ⌘O | 打开文件对话框 | ✅ | `useKeyboardShortcuts.ts:94` |
| `KC-GLOBAL-003` (P0) | ⌘S | 保存当前文档 | ✅ | `useKeyboardShortcuts.ts:100` |
| `KC-GLOBAL-004` (P1) | ⌘W | 关闭文档 | ✅ | `useKeyboardShortcuts.ts:106` |
| `KC-GLOBAL-005` (P1) | ⌘, | 打开偏好设置 | ✅ | `useKeyboardShortcuts.ts:118` |
| `KC-GLOBAL-006` (P2) | ⌘⇧B | 切换侧边栏 | ❌ **BUG** | 文档说 ⌘⇧B，实际实现为 ⌘⇧L；见 issue #? |
| `KC-GLOBAL-007` (P1) | ⌘⇧L | 切换侧边栏 | ✅ | `useKeyboardShortcuts.ts:88`（未文档化的实际快捷键）|
| `KC-GLOBAL-008` (P1) | ⌘/ | 循环视图模式 | ✅ | `useKeyboardShortcuts.ts:112` |

---

## B. 视图模式快捷键（原生菜单）

| ID | 快捷键 | 预期行为 | 状态 | 备注 |
|----|--------|----------|------|------|
| `KC-VIEW-001` (P1) | ⌃1 | 切换到分屏视图 | ✅ | `menu.rs:284` → `set-view-mode`:`split` |
| `KC-VIEW-002` (P1) | ⌃2 | 仅编辑器模式 | ✅ | `menu.rs:285` → `set-view-mode`:`editor-only` |
| `KC-VIEW-003` (P1) | ⌃3 | 仅预览模式 | ✅ | `menu.rs:286` → `set-view-mode`:`preview-only` |
| `KC-VIEW-004` (P1) | ⌃4 | WYSIWYG 模式 | ✅ | `menu.rs:287` → `set-view-mode`:`wysiwyg` |
| `KC-VIEW-005` (P2) | — | `useMenuEvents.ts` 中存在废弃的 `view.split` 等 case | ❌ **代码债** | 见 issue #?；`set-view-mode` 路径才是实际路径 |

---

## C. WYSIWYG 模式 — 标题快捷键（Milkdown）

| ID | 快捷键 | 预期行为 | 状态 | 备注 |
|----|--------|----------|------|------|
| `KC-WYS-H1` (P1) | ⌘1 | 设置为 H1 | ✅ | `typoraKeymapPlugin.ts:13-18` |
| `KC-WYS-H2` (P1) | ⌘2 | 设置为 H2 | ✅ | `typoraKeymapPlugin.ts:19-25` |
| `KC-WYS-H3` (P1) | ⌘3 | 设置为 H3 | ✅ | `typoraKeymapPlugin.ts:26-32` |
| `KC-WYS-H4` (P1) | ⌘4 | 设置为 H4 | ✅ | `typoraKeymapPlugin.ts:33-39` |
| `KC-WYS-H5` (P1) | ⌘5 | 设置为 H5 | ✅ | `typoraKeymapPlugin.ts:40-46` |
| `KC-WYS-H6` (P1) | ⌘6 | 设置为 H6 | ✅ | `typoraKeymapPlugin.ts:47-53` |
| `KC-WYS-P0` (P1) | ⌘0 | 转换为段落 | ⚠️ **疑似 BUG** | `wrapInHeadingCommand.key, 0`：level 0 未在 Milkdown 文档中定义；需运行时验证，见 issue #? |

---

## D. WYSIWYG 模式 — 格式化快捷键（Milkdown）

| ID | 快捷键 | 预期行为 | 状态 | 备注 |
|----|--------|----------|------|------|
| `KC-WYS-B` (P1) | ⌘B | 粗体 | ✅ | `typoraKeymapPlugin.ts:62-68` |
| `KC-WYS-I` (P1) | ⌘I | 斜体 | ✅ | `typoraKeymapPlugin.ts:69-75` |
| `KC-WYS-K` (P1) | ⌘K | 插入链接 | ❌ **BUG** | 使用 `window.prompt()` — Tauri WebView 中不可靠；应使用原生对话框，见 issue #? |
| `KC-WYS-U` (P1) | ⌘U | 下划线 | ❌ **BUG** | `preferences.ts:167` 定义但 `typoraKeymapPlugin.ts` 未绑定，见 issue #? |
| `KC-WYS-CODE` (P1) | ⌘⇧\` | 行内代码 | ❌ **BUG** | `preferences.ts:168` 定义但未在 WYSIWYG 中绑定，见 issue #? |
| `KC-WYS-STRIKE` (P1) | ⌃⇧\` | 删除线 | ❌ **BUG** | `preferences.ts:169` 定义但未在 WYSIWYG 中绑定，见 issue #? |
| `KC-WYS-HL` (P1) | ⌘⇧H | 高亮选区 | ❌ **BUG** | 在 WYSIWYG 中触发 CodeMirror 的 `highlightCommand`，但 CodeMirror EditorView 在 WYSIWYG 模式下未激活 → 静默失败，见 issue #? |

---

## E. CodeMirror 模式快捷键（分屏 / 纯编辑器）

| ID | 快捷键 | 预期行为 | 状态 | 备注 |
|----|--------|----------|------|------|
| `KC-CM-1` (P1) | ⌘1 | H1 | ✅ | `useKeyboardShortcuts.ts:61-71` |
| `KC-CM-2` (P1) | ⌘2 | H2 | ✅ | 同上 |
| `KC-CM-3` (P1) | ⌘3 | H3 | ✅ | 同上 |
| `KC-CM-4` (P1) | ⌘4 | H4 | ✅ | 同上 |
| `KC-CM-5` (P1) | ⌘5 | H5 | ✅ | 同上 |
| `KC-CM-6` (P1) | ⌘6 | H6 | ✅ | 同上 |
| `KC-CM-0` (P1) | ⌘0 | 段落 | ✅ | `useKeyboardShortcuts.ts:52-57` → `paragraphCommand` |
| `KC-CM-K` (P1) | ⌘K | 插入链接 | ✅ | `useKeyboardShortcuts.ts:46-51` → `insertLinkCommand` |
| `KC-CM-HL` (P1) | ⌘⇧H | 高亮选区 | ✅ | `Editor.tsx:51` → `highlightCommand(viewRef.current)` |
| `KC-CM-COMMENT` (P2) | ⌘/ | 切换注释 | ❌ **BUG** | 文档说 `⌘/` 是"切换行注释"，但 `useKeyboardShortcuts.ts:112` 已拦截用作循环视图模式；CodeMirror 永远收不到此事件，见 issue #? |
| `KC-CM-FIND` (P1) | ⌘F | 查找 | ✅ | CodeMirror 内置 `@codemirror/search` |
| `KC-CM-REPLACE` (P1) | ⌘H | 查找替换 | ❌ **BUG** | `preferences.ts:143` 定义 `editReplace: "Cmd+H"`，但 ⌘H 是 macOS 系统级"隐藏应用"快捷键，无法被 JavaScript 拦截，见 issue #? |

---

## F. 内置 ProseMirror 快捷键（WYSIWYG 模式）

| ID | 快捷键 | 预期行为 | 状态 | 备注 |
|----|--------|----------|------|------|
| `KC-PM-UNDO` (P1) | ⌘Z | 撤销 | ✅ | ProseMirror 内置 |
| `KC-PM-REDO` (P1) | ⌘⇧Z | 重做 | ✅ | ProseMirror 内置 |
| `KC-PM-ENTER` (P0) | Enter | 新行 / 继续列表 | ✅ | ProseMirror 内置 |
| `KC-PM-TAB` (P1) | Tab | 列表缩进 | ✅ | ProseMirror 内置 |
| `KC-PM-STAB` (P1) | ⇧Tab | 列表取消缩进 | ✅ | ProseMirror 内置 |

---

## 3. Bug 汇总

| ID | 快捷键 | 描述 | 严重程度 |
|----|--------|------|----------|
| BUG-01 | ⌘⇧B/⌘⇧L | 文档说 ⌘⇧B，实际为 ⌘⇧L | P2 — 文档错误 |
| BUG-02 | ⌘K (WYSIWYG) | 使用 `window.prompt()` — Tauri 中体验差 | P1 — 功能异常 |
| BUG-03 | ⌘0 (WYSIWYG) | `wrapInHeadingCommand` level 0 未定义 | P1 — 疑似失效 |
| BUG-04 | ⌘U / ⌘⇧\` / ⌃⇧\` (WYSIWYG) | 下划线、行内代码、删除线快捷键无绑定 | P1 — 功能缺失 |
| BUG-05 | ⌘⇧H (WYSIWYG) | 静默失败：触发了 CodeMirror 命令但 editor view 未激活 | P1 — 功能失效 |
| BUG-06 | ⌘/ (CodeMirror) | 被全局处理器拦截，CodeMirror toggle-comment 不可达 | P2 — 功能遮蔽 |
| BUG-07 | ⌘H (查找替换) | macOS 系统级快捷键无法被 JS 拦截 | P2 — 快捷键冲突 |
| BUG-08 | `useMenuEvents` | `view.split` 等 4 个 case 废弃但未删除 | P3 — 代码债 |

---

## 4. 最小回归样例（手工测试用例）

```
测试步骤：
1. pnpm tauri dev
2. 新建文档，输入多行文字
3. 按下每个快捷键，记录实际行为
4. 对比 docs/guide/keyboard-shortcuts.md 预期行为

重点关注：
- WYSIWYG 模式下的 ⌘K、⌘0、⌘⇧H、⌘U
- CodeMirror 模式下的 ⌘/ toggle-comment
- ⌘⇧B vs ⌘⇧L 的实际行为
```

## 5. TDD 执行建议

- 将 `BUG-01`、`BUG-05` 转化为回归测试（自动化可行）。
- `BUG-02`（window.prompt）需 E2E 测试（Playwright + Tauri）。
- 每次修复 keyboard bug 必须补一条 `KC-*` 回归用例并标注已修复。
