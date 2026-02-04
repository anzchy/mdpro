# mdpro MCP Server 规格说明

**版本**: 0.1
**状态**: 草稿
**来源**: `mcp-server行业最佳实践调研结果.md`
**目标**: 在不改变现有窗口/文档体验的前提下，支持 Claude Code / Codex CLI / Gemini CLI 通过 MCP 与 mdpro 当前前台窗口交互，实现“读取上下文 + 写入文档”。

## 1. 背景与范围

### 1.1 背景
- MCP Client 通常以 `stdio` 启动 MCP Server。
- mdpro 为 GUI 应用，直接作为 MCP Server 子进程不易访问已有窗口与内存文档。
- 采用“Sidecar + IPC”模式：`mdpro-mcp` 作为 MCP Server（stdio），将请求转发给已运行的 mdpro 实例。

### 1.2 目标
- 支持 MCP 客户端通过工具调用写入 mdpro 文档。
- 支持读取当前打开文档列表与内容。
- 多窗口场景下，默认路由至**最近聚焦**窗口。
- 保证本地安全：仅 localhost、Origin 校验、Token 认证。

### 1.3 非目标
- 不做远程多用户协作。
- 不提供云端 MCP Server。
- 不保证旧版 HTTP+SSE 兼容（仅保留未来扩展的技术约束）。

## 2. 总体架构

### 2.1 组件
1. **mdpro App（Tauri/Rust + React）**
   - 启动本地 HTTP Server（localhost）。
   - 维护 Shadow Store（Rust 侧同步文档状态）。
   - 接收请求并路由到前台窗口。

2. **mdpro-mcp（stdio 代理）**
   - 被 MCP Client 启动。
   - 处理 MCP JSON-RPC 请求。
   - 转发到 mdpro HTTP Server。

3. **MCP Client（Claude/Codex/Gemini CLI）**
   - 通过 stdio 与 `mdpro-mcp` 通信。

### 2.2 交互流程
1. 用户在 MCP 客户端配置 `mdpro-mcp`。
2. MCP Client 启动 `mdpro-mcp`（stdio）。
3. `mdpro-mcp` 读取 `~/.mdpro/server.port` 与 `~/.mdpro/server.token`，连接本地 HTTP Server。
4. MCP Client 请求 `ListTools`，`mdpro-mcp` 返回工具列表。
5. MCP Client 调用工具（如 `insert_content`），`mdpro-mcp` 转发到 mdpro。
6. mdpro 将操作应用到**最近聚焦窗口**的文档。

## 3. 安全与约束

### 3.1 本地安全
- 仅监听 `127.0.0.1`。
- 校验 `Origin`（拒绝非允许源，防 DNS Rebinding）。
- 所有请求必须携带 `X-MDPRO-Token`。

### 3.2 Token 机制
- mdpro 启动时生成 token，写入 `~/.mdpro/server.token`。
- `mdpro-mcp` 启动时读取并带入请求头。

## 4. 本地 HTTP API（mdpro 内部）

> 仅供 `mdpro-mcp` 访问，不对外公开。

| Method | Endpoint | Description | Request/Response |
| --- | --- | --- | --- |
| `GET` | `/api/status` | 应用状态 | `{ "version": "0.1.5", "window_focused": true }` |
| `GET` | `/api/documents` | 打开的文档列表 | `[ { "id": "uuid", "title": "README.md", "path": "...", "is_dirty": false } ]` |
| `GET` | `/api/documents/:id` | 文档内容 | `{ "content": "...", "cursor": 120 }` |
| `POST` | `/api/documents/:id` | 全量更新 | `{ "content": "..." }` |
| `POST` | `/api/documents/:id/insert` | 插入/替换 | `{ "text": "...", "position": "cursor" | number }` |
| `POST` | `/api/documents/new` | 创建新文档 | `{ "content": "..." }` -> `{ "id": "..." }` |

**统一约束**
- 必须包含 `X-MDPRO-Token`。
- 必须校验 `Origin`。

## 5. MCP Tools

### Tool: `get_open_documents`
- **描述**: 获取 mdpro 当前打开的文档列表。
- **输入**: None
- **输出**: `[{ id, title, path, is_dirty }]`

### Tool: `read_document`
- **描述**: 读取指定文档内容。
- **输入**: `{ id }`
- **输出**: `{ content }`

### Tool: `write_document`
- **描述**: 全量覆盖文档内容。
- **输入**: `{ id, content }`
- **确认机制**:
  - 若 mdpro 窗口处于前台聚焦状态，自动批准写入。
  - 若 mdpro 处于后台，弹出原生对话框请求用户确认。

### Tool: `insert_content`
- **描述**: 在文档中插入文本。
- **输入**: `{ id, text, position }`
- **position**: `cursor | start | end | number`

### Resource: `mdpro://current/active`
- **描述**: 当前激活文档的内容。

## 6. 前台窗口路由

- Rust 侧记录最近聚焦窗口 label（`WindowEvent::Focused`）。
- 所有 MCP 写操作默认路由到该窗口。
- 若无聚焦窗口，使用最近聚焦记录；再无则 fallback 到第一个窗口。

## 7. 状态同步（Shadow Store）

**问题**: 文档状态主要在前端 Zustand。

**方案**: 前端将文档状态同步到 Rust Shadow Store。

### 7.1 同步内容
- id, title, path, is_dirty, content, cursor, active

### 7.2 同步触发
- 文档内容变更（debounce 300ms）
- 文档切换（立即）
- 文档打开/关闭（立即）

### 7.3 调用方式
- 前端通过 `invoke("mcp_sync_documents", payload)` 更新 Rust Shadow Store。

## 8. 实施计划

### Phase 1: Local HTTP Server
- 新增 Rust HTTP Server（`axum`/`warp`）。
- 绑定 `127.0.0.1`。
- 实现 `/api/status`、`/api/documents`、`/api/documents/:id`。
- 实现 Shadow Store 同步。

### Phase 2: MCP Server CLI
- 新增 `mdpro-mcp` Rust 二进制（`src-tauri/bin/mcp_server.rs`）。
- 使用 `mcp-rs` crate 实现 MCP Server。
- stdio -> HTTP 转发。

### Phase 3: 集成测试
- Claude Desktop 配置 `mdpro-mcp`。
- 测试“读取当前文档并总结”。
- 测试“在光标处插入代码段”。

## 9. 兼容性与扩展

- 若未来支持 Streamable HTTP MCP Server，需要处理 `MCP-Protocol-Version` 头。
- Tool 结构可扩展 `create_tab`、`close_tab` 等编辑器能力。

## 10. 错误处理

### 10.1 mdpro 未运行
- 当 `mdpro-mcp` 启动时若 mdpro 未运行或 HTTP Server 不可达，立即返回错误给 MCP Client 并退出。
- 错误信息应明确指出 "mdpro not running" 以便用户采取行动。

### 10.2 用户拒绝写入
- 当用户在确认对话框中拒绝 `write_document` 操作时，返回错误给 MCP Client。
- 错误信息: "User rejected write operation"。

## Clarifications

### Session 2026-02-04
- Q: When `mdpro-mcp` starts but mdpro is not running, what should happen? → A: Return error to MCP client immediately and exit
- Q: How frequently should frontend sync document state to Shadow Store? → A: Debounce 300ms after content changes
- Q: How should `write_document` user confirmation work? → A: Auto-approve if focused, dialog if backgrounded
- Q: Which technology for `mdpro-mcp`? → A: Rust with `mcp-rs` (single binary)
- Q: What to return when user rejects write confirmation? → A: Return error "User rejected write operation"

