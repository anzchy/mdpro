# Milkdown 深度调研报告

## 目录

1. [项目概述](#项目概述)
2. [核心架构](#核心架构)
3. [Plugin-Driven 机制详解](#plugin-driven-机制详解)
4. [与 ProseMirror 的关系](#与-prosemirror-的关系)
5. [与 remark 的关系](#与-remark-的关系)
6. [三者关系图解](#三者关系图解)
7. [mdpro 整合方案](#mdpro-整合方案)

---

## 项目概述

### 基本信息

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/Milkdown/milkdown |
| 官网 | https://milkdown.dev |
| Stars | 11k+ |
| 语言 | TypeScript (91.2%) |
| 许可证 | MIT |
| 当前版本 | v7.18.0 |

### 设计理念

Milkdown 是一个**插件驱动的 WYSIWYG Markdown 编辑器框架**，灵感来自 Typora。其核心设计哲学是：

> "Everything in Milkdown are plugins."

与 Typora 等闭源编辑器不同，Milkdown 为开发者提供了一个开源解决方案，让他们可以：
- 按需选择功能，而非捆绑所有特性
- 构建自定义扩展（如 vim 键位映射）
- 完全控制编辑器样式（Headless 架构）

---

## 核心架构

### 包结构

Milkdown 采用 monorepo 结构，核心包如下：

```
packages/
├── core/           # 编辑器核心，管理插件生命周期
├── ctx/            # Context 系统，实现依赖注入
├── transformer/    # Markdown ↔ ProseMirror 转换器
├── prose/          # ProseMirror 封装
├── utils/          # 可组合插件工具函数
├── plugins/        # 官方插件集合
│   ├── preset-commonmark/   # CommonMark 语法支持
│   ├── preset-gfm/          # GFM 语法支持
│   ├── plugin-history/      # 撤销/重做
│   ├── plugin-clipboard/    # 剪贴板
│   ├── plugin-tooltip/      # 工具提示
│   ├── plugin-slash/        # 斜杠命令
│   ├── plugin-block/        # 块级编辑
│   ├── plugin-collab/       # 协同编辑 (Y.js)
│   └── ...
├── kit/            # 预打包的功能集合
├── components/     # UI 组件
└── integrations/   # 框架集成 (React, Vue, etc.)
```

### 技术栈依赖

```
┌─────────────────────────────────────────────┐
│                 Milkdown                     │
│  (Plugin-Driven WYSIWYG Markdown Editor)    │
└──────────────────┬──────────────────────────┘
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ProseMirror│ │  remark  │ │   Y.js   │
│ (Editor)  │ │(Markdown)│ │ (Collab) │
└──────────┘ └──────────┘ └──────────┘
```

---

## Plugin-Driven 机制详解

### 1. 插件类型定义

```typescript
// packages/ctx/src/plugin/types.ts

// 清理函数
export type Cleanup = () => void | Promise<void>

// Runner 返回类型
export type RunnerReturnType = void | Promise<void> | Cleanup | Promise<Cleanup>

// Context Runner
export type CtxRunner = () => RunnerReturnType

// 核心插件类型
export type MilkdownPlugin = { meta?: Meta } & ((ctx: Ctx) => CtxRunner)
```

**关键点**：
- 插件是一个接收 `Ctx` (上下文) 并返回 `CtxRunner` 的函数
- 支持异步操作和清理函数
- 可附加元数据 (meta) 用于调试和发现

### 2. Context 系统 (依赖注入)

`Ctx` 类是插件系统的核心，提供：

```typescript
// 状态管理
ctx.inject(slice)      // 注入状态切片
ctx.use(slice)         // 使用状态切片
ctx.get(slice.key)     // 获取值
ctx.set(slice.key, v)  // 设置值

// 定时器管理 (用于插件间依赖)
ctx.record(timer)      // 注册定时器
ctx.wait(timer)        // 等待定时器
ctx.done(timer)        // 完成定时器

// 上下文派生
ctx.produce(meta)      // 创建带元数据的新上下文
```

### 3. 编辑器插件加载流程

```typescript
// packages/core/src/editor/editor.ts 简化版

class Editor {
  #sysPluginStore  // 系统插件存储
  #usrPluginStore  // 用户插件存储

  // 使用插件
  use(plugin: MilkdownPlugin) {
    this.#usrPluginStore.add(plugin)
    if (this.status === 'Created') {
      this.#prepare(plugin)
    }
    return this
  }

  // 创建编辑器
  async create() {
    await this.#loadInternal()  // 加载内部插件
    await this.#loadPluginInStore(this.#usrPluginStore)  // 加载用户插件
  }

  // 销毁时调用清理函数
  async destroy() {
    for (const cleanup of this.#cleanups) {
      await cleanup()
    }
  }
}
```

### 4. 可组合插件工具 (@milkdown/utils)

Milkdown 提供了一组工厂函数来简化插件创建：

| 工厂函数 | 用途 | 示例 |
|---------|------|------|
| `$nodeSchema` | 定义节点 schema | 段落、标题、代码块 |
| `$markSchema` | 定义 mark schema | 粗体、斜体、链接 |
| `$command` | 创建命令 | undo, redo, toggleBold |
| `$inputRule` | 输入规则 | `> ` 创建引用块 |
| `$shortcut` / `$useKeymap` | 键盘快捷键 | Mod-B 加粗 |
| `$prose` | 封装 ProseMirror 插件 | history, collab |
| `$view` | 自定义节点视图 | 代码块语法高亮 |
| `$ctx` | 创建状态切片 | 配置项存储 |

### 5. 完整插件示例：History

```typescript
// packages/plugins/plugin-history/src/index.ts

import { commandsCtx } from '@milkdown/core'
import { history as prosemirrorHistory, redo, undo } from '@milkdown/prose/history'
import { $command, $ctx, $prose, $useKeymap } from '@milkdown/utils'

// 1. 命令定义
export const undoCommand = $command('Undo', () => () => undo)
export const redoCommand = $command('Redo', () => () => redo)

// 2. 配置上下文
export const historyProviderConfig = $ctx<
  { depth?: number; newGroupDelay?: number },
  'historyProviderConfig'
>({}, 'historyProviderConfig')

// 3. ProseMirror 插件封装
export const historyProviderPlugin = $prose((ctx) =>
  prosemirrorHistory(ctx.get(historyProviderConfig.key))
)

// 4. 键盘快捷键
export const historyKeymap = $useKeymap('historyKeymap', {
  Undo: {
    shortcuts: 'Mod-z',
    command: (ctx) => {
      const commands = ctx.get(commandsCtx)
      return () => commands.call(undoCommand.key)
    },
  },
  Redo: {
    shortcuts: ['Mod-y', 'Shift-Mod-z'],
    command: (ctx) => {
      const commands = ctx.get(commandsCtx)
      return () => commands.call(redoCommand.key)
    },
  },
})

// 5. 导出插件数组
export const history: MilkdownPlugin[] = [
  historyProviderConfig,
  historyProviderPlugin,
  historyKeymap,
  undoCommand,
  redoCommand,
].flat()
```

### 6. 节点 Schema 插件示例：Blockquote

```typescript
// 简化的 blockquote 定义

export const blockquoteSchema = $nodeSchema('blockquote', () => ({
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'blockquote' }],
  toDOM: () => ['blockquote', 0],
  parseMarkdown: {
    match: node => node.type === 'blockquote',
    runner: (state, node, type) => {
      state.openNode(type)
      state.next(node.children)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'blockquote',
    runner: (state, node) => {
      state.openNode('blockquote')
      state.next(node.content)
      state.closeNode()
    },
  },
}))

// 输入规则：> 开头创建引用
export const blockquoteInputRule = $inputRule(
  () => wrappingInputRule(/^\s*>\s$/, blockquoteSchema.type())
)

// 命令
export const wrapInBlockquoteCommand = $command('WrapInBlockquote', () =>
  () => wrapIn(blockquoteSchema.type())
)

// 快捷键
export const blockquoteKeymap = $useKeymap('blockquoteKeymap', {
  WrapInBlockquote: {
    shortcuts: 'Mod-Shift-b',
    command: (ctx) => {
      const commands = ctx.get(commandsCtx)
      return () => commands.call(wrapInBlockquoteCommand.key)
    },
  },
})
```

---

## 与 ProseMirror 的关系

### ProseMirror 简介

[ProseMirror](https://prosemirror.net/) 是一个功能强大的富文本编辑器框架：

- **不可变架构**：采用函数式、不可变的架构设计
- **结构化文档**：支持自定义文档结构的 schema
- **插件系统**：可扩展的插件机制
- **协同编辑**：原生支持协同编辑

### Milkdown 如何使用 ProseMirror

```
┌────────────────────────────────────────┐
│              Milkdown                   │
│  ┌──────────────────────────────────┐  │
│  │         @milkdown/prose          │  │
│  │  (ProseMirror 的 re-export)       │  │
│  └──────────────────────────────────┘  │
│                   │                     │
│                   ▼                     │
│  ┌──────────────────────────────────┐  │
│  │        ProseMirror 核心           │  │
│  │  - prosemirror-model (Schema)    │  │
│  │  - prosemirror-state (State)     │  │
│  │  - prosemirror-view (View)       │  │
│  │  - prosemirror-transform (Tr)    │  │
│  │  - prosemirror-commands          │  │
│  │  - prosemirror-keymap            │  │
│  │  - prosemirror-inputrules        │  │
│  │  - prosemirror-history           │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**关键整合点**：

1. **Schema 系统**：Milkdown 的 `$nodeSchema` 和 `$markSchema` 构建 ProseMirror Schema
2. **State 管理**：编辑器状态由 ProseMirror EditorState 管理
3. **View 渲染**：使用 ProseMirror EditorView 渲染文档
4. **Transaction**：所有编辑操作通过 ProseMirror Transaction
5. **Commands**：Milkdown 的 `$command` 封装 ProseMirror commands
6. **Plugins**：Milkdown 的 `$prose` 可直接使用 ProseMirror 插件

---

## 与 remark 的关系

### remark 简介

[remark](https://github.com/remarkjs/remark) 是 unified 生态系统中的 Markdown 处理器：

```
           remark 架构
┌────────────────────────────────────┐
│           remark-parse             │
│    (Markdown → mdast AST)          │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│          mdast (AST)               │
│    JSON-like 抽象语法树             │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│        remark-stringify            │
│    (mdast AST → Markdown)          │
└────────────────────────────────────┘
```

**核心特点**：
- 基于 AST 的转换
- 150+ 插件生态
- CommonMark / GFM 支持
- 底层使用 micromark 解析

### Milkdown 如何使用 remark

Milkdown 的 `@milkdown/transformer` 包负责桥接 remark 和 ProseMirror：

```
      Markdown ↔ ProseMirror 转换流程

┌──────────────┐
│   Markdown   │
│   (String)   │
└──────┬───────┘
       │ remark.parse()
       ▼
┌──────────────┐
│    mdast     │
│    (AST)     │
└──────┬───────┘
       │ ParserState.run()
       │ (遍历 AST，匹配 schema)
       ▼
┌──────────────┐
│ ProseMirror  │
│   Document   │
└──────┬───────┘
       │ SerializerState.run()
       │ (遍历 PM Doc，输出 mdast)
       ▼
┌──────────────┐
│    mdast     │
│    (AST)     │
└──────┬───────┘
       │ remark.stringify()
       ▼
┌──────────────┐
│   Markdown   │
│   (String)   │
└──────────────┘
```

**转换核心代码**：

```typescript
// packages/transformer/src/parser/state.ts

class ParserState {
  run = (remark: RemarkParser, markdown: string) => {
    // 1. 使用 remark 解析 Markdown 为 AST
    const tree = remark.runSync(remark.parse(markdown), markdown)
    // 2. 遍历 AST 构建 ProseMirror 文档
    this.next(tree)
  }

  // 匹配 mdast 节点到 schema
  #matchTarget = (node: Node) => {
    // 遍历所有注册的 schema，找到匹配的 parseMarkdown.match
  }

  // 运行匹配的 runner
  #runNode = (node: Node) => {
    const { runner } = this.#matchTarget(node)
    runner(this, node, type)
  }

  // 构建 ProseMirror 节点
  openNode(type, attrs)   // 打开容器节点
  addNode(type, attrs)    // 添加叶子节点
  addText(text)           // 添加文本
  closeNode()             // 关闭容器节点
}
```

---

## 三者关系图解

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Milkdown                                    │
│                    (Plugin-Driven Editor Framework)                      │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         Plugin System                               │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │ │
│  │  │  Syntax  │  │ Commands │  │ Keymaps  │  │  Themes  │           │ │
│  │  │ Plugins  │  │ Plugins  │  │ Plugins  │  │ Plugins  │           │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │ │
│  │       │             │             │             │                  │ │
│  │       └─────────────┴──────┬──────┴─────────────┘                  │ │
│  │                            │                                       │ │
│  │                    ┌───────▼───────┐                               │ │
│  │                    │  Ctx (Context)│                               │ │
│  │                    │   DI System   │                               │ │
│  │                    └───────┬───────┘                               │ │
│  └────────────────────────────┼────────────────────────────────────────┘│
│                               │                                          │
│          ┌────────────────────┼────────────────────┐                    │
│          ▼                    ▼                    ▼                    │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           │
│  │  @milkdown/   │    │  @milkdown/   │    │     Y.js      │           │
│  │     prose     │    │  transformer  │    │   (Collab)    │           │
│  └───────┬───────┘    └───────┬───────┘    └───────────────┘           │
│          │                    │                                         │
└──────────┼────────────────────┼─────────────────────────────────────────┘
           │                    │
           ▼                    ▼
┌───────────────────┐  ┌───────────────────┐
│    ProseMirror    │  │      remark       │
│                   │  │                   │
│ ┌───────────────┐ │  │ ┌───────────────┐ │
│ │ prosemirror-  │ │  │ │ remark-parse  │ │
│ │    model      │ │  │ │ (Markdown→AST)│ │
│ │  (Schema)     │ │  │ └───────────────┘ │
│ └───────────────┘ │  │                   │
│                   │  │ ┌───────────────┐ │
│ ┌───────────────┐ │  │ │    mdast      │ │
│ │ prosemirror-  │ │  │ │   (AST)       │ │
│ │    state      │ │◄─┼─┤               │ │
│ │(EditorState)  │ │  │ └───────────────┘ │
│ └───────────────┘ │  │                   │
│                   │  │ ┌───────────────┐ │
│ ┌───────────────┐ │  │ │remark-stringify│
│ │ prosemirror-  │ │  │ │(AST→Markdown) │ │
│ │    view       │ │  │ └───────────────┘ │
│ │ (Rendering)   │ │  │                   │
│ └───────────────┘ │  │ ┌───────────────┐ │
│                   │  │ │   micromark   │ │
│ ┌───────────────┐ │  │ │  (Parser)     │ │
│ │ prosemirror-  │ │  │ └───────────────┘ │
│ │  commands     │ │  │                   │
│ └───────────────┘ │  └───────────────────┘
│                   │
└───────────────────┘
```

**数据流总结**：

1. **输入 (Markdown → Editor)**
   - Markdown 字符串 → remark → mdast AST → transformer → ProseMirror Document

2. **编辑 (Editor 内部)**
   - ProseMirror State + Transactions + Commands + View

3. **输出 (Editor → Markdown)**
   - ProseMirror Document → transformer → mdast AST → remark → Markdown 字符串

---

## mdpro 整合方案

### 方案一：直接使用 Milkdown

**优点**：
- 即插即用，生态成熟
- 维护成本低
- TypeScript 支持完善

**缺点**：
- 引入大量依赖
- 定制化受限于 Milkdown API
- 与现有 CodeMirror 架构冲突

**实施步骤**：
```bash
pnpm add @milkdown/core @milkdown/prose @milkdown/transformer
pnpm add @milkdown/preset-commonmark @milkdown/kit
pnpm add @milkdown/react  # React 集成
```

### 方案二：借鉴 Plugin 架构，自建系统

这是更适合 mdpro 的方案，可以在不引入 Milkdown 依赖的情况下获得插件化能力。

#### 2.1 设计 mdpro 插件系统

```typescript
// src/plugins/types.ts

export interface MdproPluginContext {
  // 编辑器状态
  getContent: () => string
  setContent: (content: string) => void

  // 命令注册
  registerCommand: (name: string, handler: CommandHandler) => void

  // 菜单扩展
  registerMenuItem: (item: MenuItem) => void

  // 快捷键
  registerKeymap: (key: string, command: string) => void

  // 事件系统
  on: (event: string, handler: EventHandler) => void
  emit: (event: string, payload: any) => void
}

export type MdproPluginCleanup = () => void | Promise<void>

export interface MdproPlugin {
  name: string
  version: string
  setup: (ctx: MdproPluginContext) => MdproPluginCleanup | void
}
```

#### 2.2 插件管理器

```typescript
// src/plugins/PluginManager.ts

export class PluginManager {
  private plugins: Map<string, MdproPlugin> = new Map()
  private cleanups: Map<string, MdproPluginCleanup> = new Map()

  async register(plugin: MdproPlugin) {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} already registered`)
    }

    this.plugins.set(plugin.name, plugin)
    const ctx = this.createContext(plugin.name)
    const cleanup = await plugin.setup(ctx)

    if (cleanup) {
      this.cleanups.set(plugin.name, cleanup)
    }
  }

  async unregister(name: string) {
    const cleanup = this.cleanups.get(name)
    if (cleanup) {
      await cleanup()
    }
    this.plugins.delete(name)
    this.cleanups.delete(name)
  }

  private createContext(pluginName: string): MdproPluginContext {
    return {
      // ... 实现上下文方法
    }
  }
}
```

#### 2.3 示例插件：Vim Mode

```typescript
// src/plugins/builtin/vim-mode.ts

import type { MdproPlugin } from '../types'

export const vimModePlugin: MdproPlugin = {
  name: 'vim-mode',
  version: '1.0.0',
  setup: (ctx) => {
    // 注册 vim 键位
    ctx.registerKeymap('Escape', 'vim:normalMode')
    ctx.registerKeymap('i', 'vim:insertMode')
    ctx.registerKeymap(':', 'vim:commandMode')

    // 注册命令
    ctx.registerCommand('vim:normalMode', () => {
      // 切换到 normal 模式
    })

    // 清理函数
    return () => {
      // 移除键位绑定
    }
  }
}
```

#### 2.4 与 Rust 后端集成

```rust
// src-tauri/src/plugins/mod.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PluginManifest {
    name: String,
    version: String,
    main: String,  // JS 入口文件
    capabilities: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum PluginCapability {
    FileSystem,     // 文件系统访问
    Network,        // 网络访问
    Shell,          // Shell 命令
    Clipboard,      // 剪贴板
}

#[tauri::command]
pub async fn load_plugin(path: String) -> Result<PluginManifest, String> {
    // 读取插件目录的 manifest.json
    // 验证能力声明
    // 返回给前端加载
}
```

### 方案对比

| 维度 | 方案一 (直接使用) | 方案二 (自建系统) |
|------|------------------|------------------|
| 开发成本 | 低 | 中 |
| 维护成本 | 低 (依赖社区) | 中 (自行维护) |
| 定制灵活度 | 中 | 高 |
| 与现有架构兼容 | 需要重构 | 无缝集成 |
| 学习曲线 | 需学 Milkdown API | 基于已有知识 |
| 包体积 | 增加 ~300KB | 增加 ~20KB |

### 建议

对于 mdpro 项目，**推荐方案二**，原因如下：

1. **现有架构**：mdpro 已经使用 CodeMirror 6，直接引入 Milkdown (基于 ProseMirror) 会造成冲突
2. **轻量化**：mdpro 定位是本地 Markdown 编辑器，不需要 Milkdown 的全部功能
3. **可控性**：自建系统可以更好地与 Tauri 后端集成
4. **渐进增强**：可以先实现核心插件机制，再逐步添加功能

### 实施路线图

1. **Phase 1**：定义插件接口和上下文
2. **Phase 2**：实现插件管理器
3. **Phase 3**：迁移现有功能为内置插件 (history, clipboard, theme)
4. **Phase 4**：添加插件加载/卸载 UI
5. **Phase 5**：文档和示例插件

---

## 参考资料

- [Milkdown Documentation](https://milkdown.dev/docs)
- [ProseMirror Guide](https://prosemirror.net/docs/guide/)
- [remark - unified](https://github.com/remarkjs/remark)
- [Milkdown Source Code](https://github.com/Milkdown/milkdown)

---

*文档生成时间：2026-01-19*
