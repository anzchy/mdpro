# D15 / D16 / D17 真机复现结果（2026-09-22）

## 0. 测试条件

| 项 | 值 |
|---|---|
| 分支 / SHA | `frontend-backend-redesign` / `541010b` |
| 隔离 worktree | `/Users/jackcheng/Documents/01_Coding/mac-app/wt-repro`（detached HEAD） |
| 构建 | release bundle；`pnpm tauri build --bundles app` |
| bundle | `/Users/jackcheng/Documents/01_Coding/mac-app/wt-repro/src-tauri/target/release/bundle/macos/mdpro.app` |
| `tauri-app` SHA-256 | `e81385fd95f9a1da5ec9a39ea58f93ec32079788a91205438955863b39434558` |
| 构建时间 / 大小 | `2026-09-22 15:20:35 +0800` / 19,550,528 B |
| 构建备注 | 首次构建在 `.app` 生成前因 gitignored 的 `src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` 缺失而失败；从主仓库复制同架构 sidecar（SHA-256 `cf60d2c0e4c44c78d465218e59d251fb563ee1c9ce4064c014b6c4e35d869f08`）后重建。`.app` 成功生成，命令随后在 updater 签名阶段因缺少 `TAURI_SIGNING_PRIVATE_KEY` 返回 1 |
| 运行镜像确认 | PID 命令路径含上述 worktree bundle；冷启动日志为 `appReady:false`、窗口 `main` |
| 机器 | MacBook Pro（Mac16,1），Apple M4 10 核，24 GB |
| macOS | 26.3.1 (a)，Build `25D771280a` |
| 输入 | **仅合成输入**：computer-use 键盘/鼠标事件；输入源 `com.apple.keylayout.US`（ABC）。没有实体键盘试次 |
| 窗口 | computer-use 截图为 **1152×768**；不是指南指定的 1200×800，D17 结果只对本轮尺寸成立 |
| 夹具 | `~/mdpro-repro/repro-a.md`；每轮由 `repro-a.src.md` 重置；初始/最终 SHA-1 `9be3a2cc758c75c827124da198e8eaf2a9b60abc` |
| 日志 | `~/.mdpro/mdpro.log`；总窗口 12688–13353；各判据起点见下文 |

本轮只复现、记录，没有修改 `src/`、`src-tauri/`、`tests/`，没有提交或推送。

## 1. 总结

| 缺陷 | 本轮结论 | 边界 |
|---|---|---|
| D15：WYSIWYG 显示的输入不进文档 | **REPRODUCED** | 仅 computer-use 合成输入 + ABC；实体键盘未验证 |
| D16：有未保存改动时 app 级退出不提示 | **REPRODUCED** | Q3 ⌘Q、Q4 菜单 Quit、Q5 AppleScript quit 均复现；Q1 红色按钮、Q2 ⌘W 会提示；Q6 Dock 为 BLOCKED |
| D17：模式切换恢复正文位置后大纲高亮错误 | **REPRODUCED** | 1152×768；H06、H03、H09、H11 四个节中位置均复现；S5 对照预期也失败 |

## 2. D15：WYSIWYG 输入未进入 document store

日志起点：12717。

| 步骤 | 输入 / 观察 | 结论 |
|---|---|---|
| R1 | 冷启动 release bundle，打开 `repro-a.md`；WYSIWYG；computer-use 合成输入；ABC | 已执行 |
| R2 | 在 `A-H01-P01` 末尾输入 `x`；WYSIWYG 辅助功能树显示行尾为 `aliqua.x`；等 2 秒后标签按钮仍为 `repro-a.md ×`，没有观察到脏标记；日志没有内容更新事件 | `x` 只在 ProseMirror 画面里 |
| R3 | 第一遍坐标点击误把 `yz` 输入到 `A-H03-P06`，该试次判为**无效定位试次并保留**。随后通过 AX 元素重新定位 `A-H01-P01`，画面显示 `aliqua.xyz`；日志仍没有内容更新事件 | 有效试次画面为 `xyz` |
| R4 | 合成 ⌃2 后点击大纲 `A H01` 定位；Source 中 `A-H01-P01` 行尾仍为 `aliqua.`，`x`、`xyz` 均不存在。误输入到 H03 的 `yz` 也不存在 | **REPRODUCED**：一个字符都没有进入 store |
| R5 | 合成 ⌃4 返回 WYSIWYG，`x/xyz/yz` 全部消失；合成 ⌘S 后出现 `Saved`，日志 `file.save success`、`fileSizeBytes=24078`；磁盘 SHA-1 仍为 `9be3…abc`，`A-H01-P01` 行尾没有新增字符 | 保存成功提示没有保存画面上的 WYSIWYG 输入 |
| R6 | 冷启动、重置夹具；先点击大纲 `A H06`，再在 `A-H06-P08` 输入 `q`；WYSIWYG 显示 `aliqua.q`；切 Source 后同一行没有 `q` | **REPRODUCED** |
| R7 | Source 中在 `A-H06-P08` 输入唯一串 `SOURCEOK`，随后切到 WYSIWYG；WYSIWYG 原文显示 `tempor SOURCEOKincididunt` | Source 对照组正常 |

### 2.1 §2.2 候选机制

结论：**CONFIRMED（静态因果链 + release 运行结果；没有执行 dev breakpoint）**。

证据：

1. `MilkdownEditorInner` 订阅完整 `documents` 数组，store 更新会触发重渲染（`MilkdownEditor.tsx:108-114`）。
2. `@milkdown/react` 的 `useEditor` 在每次渲染返回新的 `{ loading, get }` 对象（`node_modules/@milkdown/react/lib/index.js:56-65`）。
3. 监听 effect 依赖 `[editor, activeDocumentId]`；cleanup 把旧闭包的 `disposed` 设为 `true`（`MilkdownEditor.tsx:184-216`）。
4. 下一轮 effect 遇到同一个 Milkdown instance 时在第 186 行直接返回，不重新登记回调；已登记回调随后只会命中 `if (disposed) return`。
5. release 运行时只出现一次 `editor.milkdown.listener.registered`；WYSIWYG DOM 显示输入，但无内容更新事件，Source/store 与磁盘均保持原文；Source 编辑对照正常。

本轮第一个 `x` 也没有进入 store，说明监听在首次人工输入前已因其他重渲染进入失效状态；没有观察到指南预测的“第一批成功、后续失败”。

### 2.2 未覆盖

- 实体键盘：**BLOCKED**（执行者只能产生合成输入）。
- 拼音组合态边角：**BLOCKED**（本轮输入源为 ABC，没有切换输入法）。
- DevTools breakpoint：未做；被测结论来自 release bundle，release 无 Web Inspector。

## 3. D16：app 级退出绕过未保存守卫

每一项都先把 `repro-a.src.md` 复制为 `repro-a.md`，在 Source 中把 `## A H02` 改成 `## A H02 dirty`；退出后磁盘 SHA-1 均保持 `9be3…abc`，实际文件仍为 `## A H02`。

| 项 | 退出方式 / 输入 | 是否提示 | 进程 / 文件 / 日志 | 判定 |
|---|---|---|---|---|
| Q1 | 窗口左上角红色关闭按钮；computer-use 合成点击 | **有**：`You have unsaved changes. Close without saving?` | 用户点击 `Discard changes`；文件不变；日志有 `ui.dialog.confirm`、`window.close success`，随后 `app.quit success` | D16 对该路径 **NOT REPRODUCED** |
| Q2 | 合成 ⌘W | **有**：同上 | 用户点击 `Discard changes`；文件不变；日志有 `ui.shortcut.trigger action=file.close` 与 `ui.dialog.confirm` | D16 对该路径 **NOT REPRODUCED** |
| Q3 | 合成 ⌘Q | **无** | app 直接退出；文件不变；本项日志窗口没有 `window.close` 或 `app.quit`；退出前未跨自动保存周期，草稿目录没有该文档草稿 | **REPRODUCED** |
| Q4 | 菜单 `mdpro → Quit mdpro`；computer-use 合成点击 | **无** | app 直接退出；文件不变；没有退出日志。等待操作确认期间跨过自动保存周期，草稿反复写入 24,084 B，下一次启动出现恢复提示 | **REPRODUCED** |
| Q5 | `osascript -e 'tell application "mdpro" to quit'` | **无** | app 直接退出；文件不变；没有 `app.quit`；退出前已产生 24,084 B 草稿，下一次启动可恢复 | **REPRODUCED** |
| Q6 | Dock 图标右键 → 退出 | 未到达 | computer-use 对 Dock 的只读连接在 **436.772 s** 后 `timeoutReached`；没有执行 Dock 退出 | **BLOCKED** |
| Q7 | 关机 / 注销 | 未做 | 没有获得执行系统级退出的明确授权 | **BLOCKED（可选项）** |

### 3.1 草稿恢复

结论：**有条件地存在，不足以避免 D16 的数据丢失。**

- Q3 在自动保存周期前退出：没有 `repro-a.md` 草稿，未保存修改无法恢复。
- Q4、Q5 在退出前已跨自动保存周期：下一次启动出现 `Recover drafts`。
- Q1 还有一个时序观察：`window.close success` 后约 2.3 秒又出现一次 `file.write success`，导致已选择丢弃后仍重新出现恢复提示。
- Q5 生成的草稿已移动到 `~/mdpro-repro/evidence/q5-64f801256df8eddb.draft.json` 保存，SHA-256 为 `a065b49bf394fbbd47ca3e5fb5943bb8120b40a590a5ab73f91872355652f1b9`。Q6 阻塞试次的测试草稿同样保存在 evidence 目录。

## 4. D17：模式恢复后大纲高亮错误

输入方式：computer-use 合成点击、滚动与 ⌃2 / ⌃4；输入源 ABC。实际窗口 1152×768。

| 步骤 | 切换前 | Source→WYSIWYG 后 | 判定 |
|---|---|---|---|
| S1 | 打开夹具，WYSIWYG | — | 已执行 |
| S2 / S3：H06 | 视口顶部 `A-H06-P07`（P08 紧随），大纲高亮 `A H06` | 视口恢复到 `A-H06-P06/P07` 附近；高亮变为顶层 `Repro fixture A` | **REPRODUCED** |
| S4：H03 | 视口顶部 `A-H03-P07`，高亮 `A H03` | 仍为 `A-H03-P07` 附近；高亮 `Repro fixture A` | **REPRODUCED** |
| S4：H09 | 视口顶部 `A-H09-P07`，高亮 `A H09` | 仍为 `A-H09-P07` 附近；高亮 `Repro fixture A` | **REPRODUCED** |
| S4：H11 | 视口顶部 `A-H11-P07`，高亮 `A H11` | 仍为 `A-H11-P07` 附近；高亮 `Repro fixture A` | **REPRODUCED** |
| S5 对照 | `A H07` 标题放在约 y=203 px，即视口高度约 26.4%；高亮 `A H07` | 标题仍在约 y=204 px；高亮仍变为 `Repro fixture A`，不是 H07 | **NOT REPRODUCED（对照预期失败）**；缺陷范围比指南原观察更宽 |
| S6 向上滚 | 先让 `A H07` 标题进入判定带，使高亮为 H07；随后向上滚 | 视口顶部已回到 `A-H06-P04/P05`，高亮仍停在 `A H07` | **REPRODUCED**（同一局限的方向变体） |

正文位置恢复本身正常；失败的是恢复后的大纲活动项。S5 表明本轮并非只有“判定带内没有标题”时才失败。

## 5. 日志 warn / error

总日志起点 12688，终点 13353。本轮没有 `level=error`。D17 每次从 Source 返回 WYSIWYG 都新增同一条 warn/fail，共 6 次：

```json
{"level":"warn","event":"ui.toc.resolve.mismatch","status":"fail","context":{"documentId":"64f801256df8eddb","domCount":0,"entryCount":13,"resolvedCount":0},"error":null}
```

时间戳：`15:53:28.479`、`15:54:04.156`、`15:54:20.719`、`15:54:39.989`、`15:54:58.241`、`15:55:28.551`（均为 `2026-09-22 +08:00`）。

## 6. 未做项与清理状态

- D15 实体键盘：未做，原因见 §2.2。
- D15 拼音未提交组合态：未做，输入源未切换。
- D16 Q6 Dock：BLOCKED，computer-use Dock 连接超时。
- D16 Q7 关机 / 注销：未做，指南规定为可选且需明确授权。
- 未保存任何截图到仓库。
- `~/mdpro-repro/` 已保留，包含原始夹具及 evidence。
- 隔离 worktree 尚未删除；按复现指南，删除前需取得用户确认。
