# 用 Tauri 架构开发 macOS App 最佳实践

> 基于 mdpro 项目开发经验总结，适用于 Tauri 2.0 + React + TypeScript 技术栈

## 目录

1. [项目架构](#项目架构)
2. [开发环境配置](#开发环境配置)
3. [调试策略](#调试策略)
4. [前后端通信](#前后端通信)
5. [状态管理](#状态管理)
6. [日志系统](#日志系统)
7. [版本发布](#版本发布)
8. [常见陷阱与解决方案](#常见陷阱与解决方案)

---

## 项目架构

### 推荐目录结构

```
project/
├── src/                    # React 前端
│   ├── components/         # UI 组件
│   ├── hooks/              # 自定义 Hooks
│   ├── services/           # Tauri IPC 封装
│   ├── stores/             # Zustand 状态管理
│   ├── types/              # TypeScript 类型定义
│   └── App.tsx
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs         # 入口、事件处理
│   │   ├── lib.rs          # 模块导出
│   │   ├── menu.rs         # 原生菜单
│   │   ├── commands/       # IPC 命令处理
│   │   ├── services/       # 业务逻辑
│   │   └── models/         # 数据结构
│   ├── Cargo.toml
│   └── tauri.conf.json
├── specs/                  # 功能规格文档
└── .github/workflows/      # CI/CD
```

### 技术栈选择

| 层级 | 推荐技术 | 说明 |
|------|---------|------|
| 框架 | Tauri 2.0 | 比 Electron 更轻量，原生性能 |
| 前端 | React 19 + TypeScript | 生态成熟，类型安全 |
| 构建 | Vite 7 | 极快的 HMR |
| 状态 | Zustand | 比 Redux 更简洁 |
| 编辑器 | CodeMirror 6 / Milkdown | 按需选择 |
| 样式 | CSS Modules / Tailwind | 避免全局污染 |

---

## 开发环境配置

### 必备命令

```bash
# 开发模式（三种方式）
pnpm dev              # 仅前端，localhost:1420，无 Tauri API
pnpm tauri dev        # 完整 Tauri 窗口，支持所有功能
pnpm dev & pnpm tauri dev  # 同时运行，互相配合

# 构建
pnpm build            # 仅前端
pnpm tauri build      # 完整 macOS App (.dmg)

# Rust 开发
cd src-tauri
cargo check           # 快速检查编译
cargo clippy          # Lint
cargo fmt             # 格式化
```

### DevToolbar 开发辅助

在开发模式下添加调试工具栏，方便测试：

```tsx
// src/components/DevToolbar.tsx
export function DevToolbar({ onOpenFile, onNewDocument, onOpenDialog }) {
  const isTauri = "__TAURI__" in window;

  if (!import.meta.env.DEV) return null;  // 生产环境隐藏

  return (
    <div className="dev-toolbar">
      <span>DEV MODE</span>
      <button onClick={onNewDocument}>New</button>
      <button onClick={isTauri ? onOpenDialog : handleBrowserOpen}>Open</button>
    </div>
  );
}
```

---

## 调试策略

### 调试工具选择矩阵

| 问题类型 | 推荐工具 | 操作方式 |
|---------|---------|---------|
| React/UI 渲染 | Chrome DevTools | `pnpm dev` → localhost:1420 |
| Tauri 集成问题 | WebView DevTools | `pnpm tauri dev` → **右键 Inspect Element** |
| IPC 通信 | JSONL 日志 | `tail -f ~/.mdpro/mdpro.log \| jq .` |
| Rust 后端 | println! + 日志 | 查看终端输出 |
| 异步/竞态 | 结构化日志 | 按 actionId 追踪完整流程 |

### WebView DevTools（关键技巧）

**在 `pnpm tauri dev` 中，右键点击窗口任意位置 → "Inspect Element"**

提供完整的调试能力：
- Elements：DOM 结构检查
- Console：JavaScript 日志
- Network：网络请求监控
- Sources：断点调试
- Performance：性能分析

### 生产环境 DevTools（内部测试版）

```json
// src-tauri/tauri.conf.json
{
  "app": {
    "windows": [{
      "devtools": true  // 仅用于内部测试，发布前移除
    }]
  }
}
```

### 调试工作流

```
1. 先用 localhost 快速迭代 UI
   ↓
2. 涉及 Tauri API 时切换到 tauri dev
   ↓
3. 右键 Inspect 打开 DevTools
   ↓
4. IPC 问题查看 JSONL 日志
   ↓
5. 问题复现困难时增加日志点
```

---

## 前后端通信

### IPC 命令定义（Rust）

```rust
// src-tauri/src/commands/file.rs
#[tauri::command]
pub async fn open_file(path: String) -> Result<Document, String> {
    // 业务逻辑
    Ok(document)
}

// src-tauri/src/commands/mod.rs
pub fn handlers() -> impl Fn(tauri::ipc::Invoke) + Send + Sync + 'static {
    tauri::generate_handler![
        file::open_file,
        file::save_file,
        // ...
    ]
}
```

### IPC 调用封装（TypeScript）

```typescript
// src/services/fileService.ts
import { invoke } from '@tauri-apps/api/core';

export const fileService = {
  async openFile(path: string): Promise<Document> {
    return invoke('open_file', { path });
  },

  async saveFile(path: string, content: string): Promise<void> {
    return invoke('save_file', { path, content });
  },
};
```

### 事件通信（Rust → Frontend）

```rust
// Rust 发送事件
window.emit("file:changed", payload)?;

// TypeScript 监听
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  const unlisten = listen('file:changed', (event) => {
    console.log('File changed:', event.payload);
  });
  return () => { unlisten.then(fn => fn()); };
}, []);
```

### 浏览器兼容性处理

```typescript
// src/services/preferencesService.ts
const isTauri = "__TAURI__" in window;

export const preferencesService = {
  async getPreferences(): Promise<UserPreferences> {
    if (!isTauri) {
      return DEFAULT_PREFERENCES;  // 浏览器模式返回默认值
    }
    return invoke('get_preferences');
  },
};
```

---

## 状态管理

### Zustand Store 模式

```typescript
// src/stores/documentStore.ts
import { create } from 'zustand';

interface DocumentState {
  documents: Document[];
  activeDocumentId: string | null;

  // Actions
  addDocument: (doc: Document) => void;
  setActiveDocument: (id: string) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  documents: [],
  activeDocumentId: null,

  addDocument: (doc) => set((state) => ({
    documents: [...state.documents, doc],
  })),

  setActiveDocument: (id) => set({ activeDocumentId: id }),
}));
```

### 选择性订阅（性能优化）

```typescript
// 只订阅需要的字段，避免不必要的重渲染
const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);

// 使用 shallow 比较对象
import { shallow } from 'zustand/shallow';
const { documents, activeDocumentId } = useDocumentStore(
  (state) => ({ documents: state.documents, activeDocumentId: state.activeDocumentId }),
  shallow
);
```

---

## 日志系统

### 日志设计原则

1. **结构化**: 使用 JSONL 格式，便于 `jq` 查询
2. **可追踪**: 使用 `actionId` 关联一个操作的多个日志
3. **分级别**: debug / info / warn / error
4. **双端记录**: 前端 + Rust 后端都要记录

### 前端日志

```typescript
// src/services/loggingService.ts
loggingService.logEventSync({
  level: 'info',
  event: 'file.open',
  status: 'start',
  actionId: loggingService.generateActionId(),
  context: { path: '/path/to/file.md' },
});
```

### Rust 日志

```rust
use crate::services::logger;

logger::log_event(LogEntryPayload {
    level: LogLevel::Info,
    event: "file.open".to_string(),
    status: LogStatus::Success,
    context: Some(json!({ "path": path })),
    duration_ms: Some(elapsed),
    ..Default::default()
});
```

### 日志查询

```bash
# 实时查看
tail -f ~/.mdpro/mdpro.log | jq .

# 按事件过滤
tail -f ~/.mdpro/mdpro.log | jq 'select(.event | startswith("file."))'

# 只看错误
tail -f ~/.mdpro/mdpro.log | jq 'select(.level == "error")'

# 追踪特定操作
grep "actionId.*abc123" ~/.mdpro/mdpro.log | jq .
```

---

## 版本发布

### GitHub Actions 自动构建

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ["v*"]

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      # 从 tag 提取版本号
      - name: Extract version
        id: version
        run: echo "VERSION=${GITHUB_REF_NAME#v}" >> $GITHUB_OUTPUT

      # 更新配置文件中的版本
      - name: Update version
        run: |
          sed -i '' 's/"version": "[^"]*"/"version": "${{ steps.version.outputs.VERSION }}"/' src-tauri/tauri.conf.json
          sed -i '' 's/^version = "[^"]*"/version = "${{ steps.version.outputs.VERSION }}"/' src-tauri/Cargo.toml

      - name: Build
        uses: tauri-apps/tauri-action@v0
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "App ${{ github.ref_name }}"
```

### 发布流程

```bash
# 1. 更新 CHANGELOG
# 2. 提交代码
git add .
git commit -m "chore: prepare release v0.2.0"

# 3. 打 tag 并推送（自动触发构建）
git tag v0.2.0
git push origin v0.2.0

# 4. 等待 GitHub Actions 完成
# 5. 在 GitHub Releases 页面检查构建产物
```

---

## 常见陷阱与解决方案

### 1. Milkdown Schema 错误

**问题**: `Schema is missing its top node type ('doc')`

**原因**: `gfm` 预设只包含扩展功能，不包含基础节点

**解决**:
```typescript
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";

Editor.make()
  .use(commonmark)  // 必须先加载 commonmark
  .use(gfm)
  .use(history);
```

### 2. 浏览器模式 Tauri API 报错

**问题**: `Cannot read properties of undefined (reading 'invoke')`

**原因**: `pnpm dev` 运行在浏览器，无 Tauri 运行时

**解决**:
```typescript
const isTauri = "__TAURI__" in window;

if (!isTauri) {
  return DEFAULT_VALUE;  // 提供降级方案
}
return invoke('command_name');
```

### 3. React StrictMode 导致双重渲染

**问题**: 编辑器初始化两次，状态异常

**解决**: 开发阶段可禁用 StrictMode
```tsx
// src/main.tsx
ReactDOM.createRoot(document.getElementById("root")).render(
  <App />  // 不包裹 StrictMode
);
```

### 4. 文件打开时机问题

**问题**: 从 Finder 打开文件时，viewMode 切换与文件加载存在竞态

**解决**: 使用标志位控制时序
```typescript
const [launchPathsComplete, setLaunchPathsComplete] = useState(false);

useEffect(() => {
  if (!launchPathsComplete) return;
  // 等待文件加载完成后再应用 viewMode
}, [launchPathsComplete]);
```

### 5. macOS 菜单事件处理

**问题**: 多窗口时菜单事件被所有窗口接收

**解决**: 检查窗口焦点状态
```typescript
const shouldHandle = async () => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().isFocused();
};

listen('menu:action', async (event) => {
  if (!(await shouldHandle())) return;
  // 处理菜单事件
});
```

---

## 总结

### 开发效率优先级

1. **充分利用 WebView DevTools** - 右键 Inspect 是最被低估的调试工具
2. **localhost 快速迭代** - 纯 UI 问题不需要启动 Tauri
3. **结构化日志** - 生产环境唯一可靠的调试手段
4. **浏览器兼容降级** - 让代码在 localhost 也能跑

### 代码质量保障

1. TypeScript 严格模式
2. 前后端类型共享（考虑 typeshare crate）
3. IPC 命令集中管理
4. 错误边界处理

### 发布流程自动化

1. Git tag 触发构建
2. 版本号自动同步
3. 多平台并行构建
4. Release 自动发布
