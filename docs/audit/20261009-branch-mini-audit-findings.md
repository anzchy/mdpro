# 分支审计发现：frontend-backend-redesign（Critical / High / Medium）

> 来源：`/cc-suite:audit` mini 审计（5 个维度：逻辑、重复、死代码、重构债、走捷径），Codex gpt-6.1-sol，high effort，只读沙箱，2026-10-09。
> 范围：从与 master 的分叉点 `16fb45c` 到 HEAD `d785ec9` 的全部改动，31 个 batch、326 个生产文件。测试、fixture、配置以及只改了 1–2 行的文件不在范围内。
> 完整的 88 条（含 Low）见 `.cc-suite/audits/audit-20261009-152531-findings.md`（gitignored，本地）。
>
> **Critical：0 条。** mini 审计不使用 Critical 级别；需要安全、性能、依赖维度请跑 `/cc-suite:audit --full`。

## 1. 概览

| 级别（Codex 原判） | 条数 | 核实情况 |
|---|---|---|
| Critical | 0 | — |
| High | 17 | 全部对照代码核实（Claude + 两个 Opus 子代理），下表给出核实结论和实际级别 |
| Medium | 48 | **Codex 结论，未逐条核实** |

核实后没有能稳定复现的真正 High，但有 3 处应优先修复（第 2 节），其中 #A 属于 rule 60 的数据丢失路径。

## 2. 优先修复

| 编号 | 问题 | 位置 | 实际级别 | 来源 | 建议修法 |
|---|---|---|---|---|---|
| A | 同一文档的保存不串行。⌘S、输入、再 ⌘S，两次保存可能后发先至：磁盘留下旧内容，文档却显示已保存，关闭时不提示，新内容静默丢失。Rust `atomic_write` 两次保存共用临时文件名 `.{name}.{pid}.tmp`，还可能报假的"保存失败"或写出拼接损坏的文件。`markSaveInProgress` 只是屏蔽文件监听，不是保存锁。 | `src/App.tsx:444`、`src/services/saveService.ts:89,183`、`src/utils/saveResult.ts:85`、`src-tauri/src/commands/file.rs:312` | Medium（触发即静默丢数据；本地 SSD 窗口约 10–30 ms，SMB / iCloud / 外接盘上现实可触发） | 竞态 master 就有；"磁盘旧、显示已保存"由本分支 D19 引入 | 在 `performSave` 按文档串行化（in-flight promise 链），临时文件名加唯一后缀并用 `create_new`；补一个"乱序完成"回归测试 |
| B | 退出确认期间新开的窗口不受保护。退出请求开始时固定窗口名单；用户停在退出对话框时新开窗口（菜单或 Finder 双击）并输入，再在第一个窗口选 Discard：新窗口的 dirty 回复被 `UnknownLabel` 拒绝，不弹提示，兜底也不等它，编辑可能丢失。 | `src-tauri/src/services/quit_guard/request.rs:98-111`、`coordinator.rs:133`、`backstop.rs:43-47`、`commands/window.rs:34-63`、`open_route/tauri_glue.rs:106-114` | Medium（普通用户用普通操作即可触发） | 本分支（ADR-0035 / D16） | 退出进行中时拒绝新建窗口和外部打开路由，或把迟到的窗口加入请求并等待其兜底回复 |
| C | 光标移到文档末尾时，若最后一个节点是分隔线 `---`，`TextSelection.atEnd` 返回 NodeSelection，下一个输入的字符会替换分隔线。 | `src/utils/focusActiveMilkdownAtEnd.ts:44` | Low（可 ⌘Z），但修复简单、结果确定 | 本分支（`7f0031e`，D37） | 用 `Selection.findFrom(..., textOnly)` 找纯文本光标，或在分隔线后放 gap cursor / 新段落；补回归测试 |
| D（加固） | 退出时前端回传的 discard ID 只校验格式，不校验所属窗口（Codex 报了 3 次）。前端只发自己窗口的 ID，需先有前端 bug 才能触发。 | `src-tauri/src/commands/quit_guard.rs:58`、`quit_guard/driver_wire.rs:100`、`quit_guard/reply.rs:115`、`driver_commit.rs:79-89` | Low | 本分支 | 删除前比对草稿里已记录的 `DraftOwner.window_label`；同时修正 `quit_guard.rs` 头注释中过时的 "no label→id binding exists" |

## 3. High（Codex 原判）及核实结论

| # | 位置 | 维度 | 问题（Codex 原文） | Codex 建议 | 核实结论 | 实际级别 | 来源 | 关联 |
|---|---|---|---|---|---|---|---|---|
| 1 | `src-tauri/src/services/verify_run.rs:159` | 1. Logic | Lexical starts_with checks accept HOME/.mdpro or HOME/Library symlinks pointing outside the run; startup then reads real preferences, appends real logs, or migrates real drafts | Validate resolved persistence destinations and existing ancestors before allowing startup; add symlink-escape regression tests | 确认，只影响测试工具 | Medium | 本分支 |  |
| 2 | `src-tauri/src/commands/file.rs:312` | 1. Logic | Pre-existing: concurrent saves to the same target share one temporary filename; either save can truncate or rename the other's bytes, corrupting the document | Serialize saves per target and create unique temporary files with create_new | 确认 | Medium | master 就有 | §2 A |
| 3 | `src-tauri/src/services/draft/mod.rs:220` | 1. Logic | Pre-existing: unlocked legacy migration can overwrite a newer bundle committed by save_draft_as after load_draft checks for its absence | Hold the draft lock across the existence check, legacy read, migration, and cleanup | 确认，只影响旧两文件格式草稿 | Medium | master 就有 |  |
| 4 | `src/plugins/codemirror/linkPlugin.ts:71` | 1. Logic | Pending link insertion follows a reused editor view after a document switch, modifying the wrong document | Capture the requesting document ID and cancel when it changes | 路径存在，触发未证实 | Medium | 本分支 |  |
| 31 | `src-tauri/src/commands/quit_guard.rs:58` | 1. Logic | Renderer-supplied discard IDs are shape-checked but never bound to the invoking window; quit commit can delete a sibling window’s drafts | Verify draft ownership against the caller before accepting IDs and again before deletion | 后端缺口确认；前端无路径发送别的窗口的 ID | Low | 本分支 | §2 D |
| 32 | `src-tauri/src/services/quit_guard/backstop.rs:101` | 1. Logic | Backstop timeout commits before a delayed Drafted acknowledgement can protect redrafted IDs; driver_commit waits for in-flight writes, then deletes those newly written drafts using the old discard list | Record redraft protection atomically with the save and check it under the closed draft gate; add a delayed-ack regression test | 确认，触发条件很窄 | Low | 本分支（68d4648） |  |
| 33 | `src-tauri/src/services/quit_guard/driver_wire.rs:100` | 1. Logic | Discard IDs are checked only for shape, allowing a prompted renderer to nominate another window's draft for deletion at commit | Validate document ownership against the caller before accepting discards and recheck ownership before deletion | 同上（同根因） | Low | 本分支 | §2 D |
| 34 | `src-tauri/src/services/quit_guard/reply.rs:115` | 1. Logic | Discard validation checks only ID shape and count; a renderer can submit another window’s draft IDs, which quit commit deletes without that window’s consent | Bind document IDs to callers in trusted backend state and enforce ownership before scheduling deletion | 同上（同根因） | Low | 本分支 | §2 D |
| 35 | `src-tauri/src/services/quit_guard/request.rs:101` | 1. Logic | Request membership remains the initial window snapshot; windows opened during a pending quit receive broadcasts but their replies are rejected as UnknownLabel, allowing commit before their unsaved work is drafted | Block window creation during pending quit or enroll new windows and require their assessment and backstop acknowledgement | 确认 | Medium | 本分支（ADR-0035 / D16） | §2 B |
| 36 | `src/hooks/useWindowCloseGuard.ts:177` | 1. Logic | The clean-close path sets the allow latch after awaiting geometry saves without rechecking edits; changes made during that wait are discarded without prompting. | Flush and reassess unsaved changes after the await before allowing close. | 路径存在，仅 MCP 写入可能触发 | Low | master 就有 |  |
| 37 | `src/hooks/useUpdater.ts:81` | 1. Logic | Pre-existing data-loss race remains: saves use captured document snapshots, then return true even when content changes or another dirty tab appears during an awaited save. | Flush again and verify current document revisions and tabs match the saved snapshots; cancel relaunch on divergence. | 路径存在，Settings 模态挡住输入，仅 MCP 写入可能触发 | Low | master 就有 |  |
| 38 | `src/plugins/milkdown/editSync/plugin.ts:92` | 1. Logic | Unmount ignores a failed destroy flush and unregisters the now-terminal controller. Tab/view switches proceed despite flush failure, losing edits that never reached documentStore. | Abort tab/view transitions when flushing fails, retain the editor for retry, and add a regression test covering serialization failure during switching. | 路径存在，序列化失败无已知触发 | Low | 行为同 master |  |
| 39 | `src/services/saveService.ts:183` | 1. Logic | An older save completing after a newer save preserves isModified=false even when disk contains the older content; reproduced with snapshots A then B completing B then A | Serialize saves per document across the entire save pipeline and mark content dirty when it differs from the final disk write | 确认（PLAUSIBLE→触发路径成立） | Medium | 竞态在 master 就有；"磁盘旧、显示已保存"是本分支 D19 引入 | §2 A |
| 40 | `src/stores/documentStore.ts:13` | 1. Logic | Tab transitions discard the flush result and proceed after serialization fails; switching destroys the outgoing editor and can lose uncaptured edits | Propagate flush failure and abort the switch while preserving the editor | 同上（与 plugin.ts:92 同根因） | Low | 行为同 master |  |
| 41 | `src/services/saveService.ts:109` | 1. Logic | Fire-and-forget draft deletion identifies only the document; a delayed delete can remove a newer draft written after this save settled | Delete conditionally against the saved draft revision under the draft lock | 理论可能 | Low | master 就有 |  |
| 42 | `src/utils/focusActiveMilkdownAtEnd.ts:44` | 1. Logic | TextSelection.atEnd returns a nonempty NodeSelection for a trailing horizontal rule; the next typed character replaces the rule | Find a text-only collapsed selection; handle documents without textblocks safely and add a trailing-rule regression test | 确认 | Low | 本分支（7f0031e，D37） | §2 C |
| 43 | `src/utils/saveResult.ts:85` | 1. Logic | Overlapping saves can finish newest-first: the later completion writes older content to disk but preserves the newer buffer’s isModified:false, allowing silent loss on close. Callers do not serialize saves. | Serialize saves per document from snapshot capture through completion, and mark content differing from writtenContent dirty; add an out-of-order completion regression test. | 同上（与 saveService.ts:183 同根因） | Medium | 同上 | §2 A |

## 4. Medium（Codex 结论，未逐条核实）

修复前请先对照代码确认。按区域分组，每组内按文件排序。

### 前端（src）（17 条）

| # | 位置 | 维度 | 问题 | 建议修法 |
|---|---|---|---|---|
| 28 | `src/components/AppDialogs.tsx:176` | 1. Logic | Open Settings, then Reload within 50 ms: Settings’ delayed focus targets the covered dialog, so Escape closes Settings while Reload remains visible | Cancel delayed focus when Settings is covered and restrict keyboard handling to the topmost dialog |
| 59 | `src/components/common/settings/ExportSettings.tsx:205` | 1. Logic | Two overlapping checkbox saves that both fail leave the checkbox at an unsaved value: previousValue comes from optimistic state, and the older rollback is suppressed | Roll back to the last confirmed persisted value while retaining the intent guard; add an overlapping-failures regression test |
| 60 | `src/components/common/settings/ImageSettings.tsx:136` | 1. Logic | Two overlapping checkbox saves that both fail restore the first failed optimistic value, leaving the checkbox inconsistent with disk | Track confirmed persisted values separately from optimistic state and test consecutive overlapping failures |
| 58 | `src/components/common/SettingsDialog.tsx:136` | 1. Logic | Reopening clears the write guard while an earlier MCP write may still be pending; the new open can load stale preferences and issue a whole-group write that overwrites that earlier change. Generation checks only protect React state. | Keep pending-write serialization across opens and reload MCP preferences after the outstanding write settles. |
| 27 | `src/components/Editor/SplitView.tsx:34` | 1. Logic | Pending Source link requests survive document and mode changes; submitting can edit another document or silently do nothing against a destroyed editor | Bind requests to document/editor identity and cancel them when either changes |
| 23 | `src/hooks/mcpTableApplyMilkdown.ts:71` | 5. Shortcuts | Serializer failure substitutes requested content and reports reconciliation without verifying agreement with the advanced editor document | Return an explicit unreconciled outcome unless document equality proves the fallback valid |
| 25 | `src/hooks/useLastViewModePersistence.ts:113` | 1. Logic | An explicit choice matching the document-active startup mode is skipped even when the stored preference differs | Track whether the persisted baseline is known; persist the first explicit choice when it is unknown |
| 61 | `src/hooks/useMcpConfirm.ts:169` | 5. Shortcuts | If the resolved-event subscription fails, the request listener remains active, so timed-out or cancelled prompts remain displayed until manually dismissed | Retry the failed subscription or disable request handling until both subscriptions succeed |
| 26 | `src/hooks/useMilkdownFocusRestore.ts:106` | 1. Logic | Historical viaDialog=true bypasses the current prompt’s return-target guard, allowing a later prompt’s connected outside-input target to be replaced | Validate the current prompt’s return target against oldDom before redirecting |
| 24 | `src/hooks/useRecentFiles.ts:99` | 1. Logic | Per-window counters allow an older session reply to overwrite another window’s newer persisted recent-files list | Persist the session list atomically with the Rust delta operation, or reject stale revisions globally |
| 62 | `src/hooks/useSidebarPreference.ts:76` | 1. Logic | Rapid toggles launch overlapping writes; an earlier write applied last leaves persisted visibility opposite to the UI. | Serialize writes in toggle order, continuing the queue after failures. |
| 63 | `src/hooks/useSourceScrollSpy.ts:143` | 1. Logic | During a tab switch’s debounced parse, the spy samples the new editor using the previous document’s headings and overwrites that document’s active heading. | Skip sampling until the TOC documentId matches the active document; track entries with their owning documentId. |
| 64 | `src/hooks/useTheme.ts:130` | 1. Logic | If the newer theme write fails before an older write succeeds, rollback restores the original theme, but the older success only updates rollbackTarget; displayed and persisted themes remain inconsistent. | Serialize theme writes and reconcile the displayed mode with the final successful write. |
| 22 | `src/plugins/codemirror/linkPlugin.ts:71` | 1. Logic | Deferred callback inserts even when the editor becomes read-only after the modal opens | Recheck read-only state before applying the link |
| 65 | `src/services/saveService.ts:71` | 1. Logic | Both save flushes aggregate failures across all registered documents, so another document’s failing flusher can reject this document’s save or prevent its clean-state update | Use flushPendingEditsFor with the saved document ID and reread that document after flushing |
| 66 | `src/utils/codemirrorViewportLine.ts:267` | 1. Logic | Comparing logical line numbers accepts zero-height or too-short viewports when both probes resolve to the same line | Reject detached, zero-height, and anchor-outside-viewport geometry before probing; retain the inversion check |
| 67 | `src/utils/tocElementResolution.ts:174` | 1. Logic | For `> #\tTitle\n\n# Title`, the sole TOC entry (line 3) resolves to the blockquote heading; reproduced with real Milkdown | Reject ambiguous duplicate matches or resolve using source positions; add this regression case |

### Rust 后端（src-tauri）（10 条）

| # | 位置 | 维度 | 问题 | 建议修法 |
|---|---|---|---|---|
| 21 | `src-tauri/src/menu_recent.rs:114` | 5. Shortcuts | Unvalidated view_mode is retained globally; an unsupported value clears both View checkmarks and persists through subsequent list-only updates | Deserialize a source/wysiwyg enum and reject invalid values before changing SyncState |
| 49 | `src-tauri/src/services/mcp_confirm/broker.rs:120` | 1. Logic | Replies never check the stored deadline; an approval after 60 seconds can succeed before the timeout task runs | Check the deadline under the table lock before accepting a reply; expire overdue requests and test delayed timeout polling |
| 50 | `src-tauri/src/services/mcp_confirm/effects.rs:50` | 1. Logic | Tauri emit_to succeeds for nonexistent targets; a request enqueued after window destruction waits 60 seconds instead of cancelling because the subsequent attention error only logs | Return an error when the target webview window is absent so the broker cancels the request immediately |
| 51 | `src-tauri/src/services/mcp_confirm/outbox.rs:80` | 5. Shortcuts | Failed confirm_resolved delivery is only logged and discarded; the frontend has no expiry fallback, so an expired/cancelled prompt remains open and hides subsequent prompts until manually dismissed | Retain failed resolution events for bounded retries and add frontend expiry cleanup. |
| 53 | `src-tauri/src/services/mcp_controller/files.rs:161` | 5. Shortcuts | unpublish() suppresses deletion failures and removes the token even when port removal fails, violating the port-implies-token invariant | Treat NotFound as success, return other deletion errors, and stop before deleting the token if port removal fails |
| 54 | `src-tauri/src/services/mcp_controller/test_support.rs:156` | 1. Logic | connect_refused() treats every connection error, including timeout, as proof that the listener stopped | Require ErrorKind::ConnectionRefused and surface other errors |
| 52 | `src-tauri/src/services/mcp_controller/transitions.rs:186` | 1. Logic | Failed bind attempts leave discovery files from a previous crashed run intact because fail() clears only the snapshot and in-memory config | Unpublish discovery files on failed starts; add a bind-failure test with seeded stale files |
| 55 | `src-tauri/src/services/open_route/execute.rs:31` | 5. Shortcuts | New-window and broadcast callbacks return no result, so routing logs Success even when window creation fails or broadcasting returns an error; broadcast success is logged before delivery is attempted | Return Result from both callbacks and log each route’s actual outcome after execution. |
| 56 | `src-tauri/src/services/quit_guard/driver.rs:208` | 1. Logic | Prompt effects run after releasing the coordinator mutex, allowing escape/KeepOpen to emit Cancelled before the pending Prompt is emitted; the late prompt opens an orphaned dialog whose replies are refused | Dispatch plans in transition order outside the coordinator lock and suppress invalidated prompts; test cancellation racing prompt emission |
| 57 | `src-tauri/src/services/quit_guard/effects.rs:145` | 1. Logic | Timer callbacks ignore request_id; a cancelled request's timer ticks a newer request, whose early-tick handling spawns another timer alongside its existing timer | Reject obsolete request/deadline generations and cancel superseded timers |

### 构建、校验与工具脚本（21 条）

| # | 位置 | 维度 | 问题 | 建议修法 |
|---|---|---|---|---|
| 16 | `.claude/hooks/block-target-scan.sh:24` | 1. Logic | Any occurrence of target bypasses protection; grep -rn target . is allowed despite scanning build output | Recognize actual target exclusion or pruning options within each command. |
| 17 | `.claude/hooks/block-target-scan.sh:60` | 1. Logic | Pattern option arguments are treated as paths; grep -rn -e foo bypasses protection despite implicitly searching the repository root | Consume option arguments and default to the current directory when no search paths remain. |
| 5 | `scripts/control/build.mjs:174` | 1. Logic | Concurrent profiles share sidecarDest and dist without locking; a sidecar replacement after hashing allows a successful manifest describing different bytes from the bundled sidecar | Hold a shared build lock through artifact publication and verify the bundled sidecar digest |
| 6 | `scripts/control/buildInputsGuard.mjs:49` | 1. Logic | tauri.verify.conf.json is omitted from both the scanned files and JSON dispatch, so its excluded-path references escape detection | Include the verify overlay and resolve its JSON paths against src-tauri |
| 7 | `scripts/control/buildInputsGuard.mjs:100` | 1. Logic | import.meta.glob(["../docs/*.md"]) and import.meta.glob("../**/*.md") both return no findings despite reaching excluded docs files | Parse glob arrays and expand positive glob patterns before checking excluded paths |
| 8 | `scripts/control/buildInputsGuard.mjs:127` | 1. Logic | Reference regexes scan preserved string contents as executable syntax; a string containing import x from "../docs/x.md" produces a false finding | Match reference expressions through a parser that distinguishes code from literal contents |
| 9 | `scripts/control/commentBlanker.mjs:114` | 1. Logic | The valid JavaScript regex /[/*]/ is mistaken for a block comment, blanking subsequent imports and hiding excluded dependencies | Recognize regex literals and character classes before interpreting comment delimiters |
| 10 | `scripts/control/persistenceRoots.mjs:51` | 1. Logic | use r#dirs as d; followed by d::home_dir() produces neither sites nor forbidden imports, allowing an empty registry to pass | Normalize Rust raw identifiers when detecting dirs imports and qualified references |
| 13 | `scripts/control/rustScopes.mjs:111` | 1. Logic | Raw and escaped cfg strings representing macos are misparsed as other OS values, incorrectly exempting production persistence calls | Decode Rust string literals correctly; treat unsupported syntax as unknown. |
| 14 | `scripts/control/rustScopes.mjs:153` | 1. Logic | Commas in generic parameters terminate item scope prematurely; a Windows-gated fn f<T, U>() body is classified as production | Track generic parameter nesting when locating item boundaries. |
| 15 | `scripts/control/sourceTree.mjs:170` | 5. Shortcuts | Every HEAD lookup error becomes null, silently disguising Git I/O or spawn failures as an unborn repository | Confirm unborn HEAD before returning null; propagate other failures as SourceTreeError. |
| 11 | `scripts/heavy-lock.sh:47` | 1. Logic | A stale reclaimer can rename a newly acquired live lock, allowing another contender to acquire the empty path before restoration and run concurrently | Use a kernel advisory lock on a stable lock file. |
| 12 | `scripts/heavy-lock.sh:104` | 1. Logic | Signal handling releases the lock immediately after sending TERM, while the child may still be running | Terminate the child process group and wait for termination before releasing the lock. |
| 44 | `scripts/ledger/md.mjs:37` | 1. Logic | Rejects ordinary relative URLs, turning 69 current ledger links into href="#" | Allow safe scheme-less relative paths while rejecting unsafe schemes |
| 45 | `scripts/ledger/parse.mjs:136` | 1. Logic | Accepts inventory rows without a separator, although the HTML renderer renders them as prose | Require a valid separator and report malformed inventory tables |
| 46 | `scripts/ledger/parse.mjs:255` | 1. Logic | Build-output check permits src-tauri/target/release/ because its prefix is missing | Include src-tauri/target/ in forbidden build-output prefixes |
| 47 | `scripts/ledger/parse.mjs:272` | 1. Logic | Substring matching counts /api/documents as covered by /api/documents/new and heading by headingCoordination | Match complete declared names with appropriate token boundaries |
| 48 | `scripts/perf/generate-corpus.mjs:246` | 1. Logic | Removing dense-math still reports success at 9/9 because missing recorded entries are never checked | Require generated keys to equal the complete RECORDED key set |
| 18 | `scripts/redesign/device/key.sh:9` | 1. Logic | Interpolating the key into AppleScript source produces invalid syntax for double quotes and backslashes | Pass the key through osascript arguments and read it in an on run handler. |
| 19 | `scripts/redesign/snapshot.js:62` | 1. Logic | Captured properties omit transform and positioning offsets, so removing the checked toggle thumb’s translateX produces identical JSON despite a visible regression | Capture transform and positioning properties for elements and pseudo-elements |
| 20 | `scripts/redesign/snapshot.js:538` | 1. Logic | source-syntax captures line containers and markers but omits syntax-token spans; token color and font-weight changes remain invisible because computed styles do not include descendant styles | Capture representative syntax-token spans and assert that each expected token matches |

## 5. 后续

- 修复走 tdd-guardian（RED → GREEN），每个 bug 修复带回归测试。
- §2 的 A、B 建议由 delegator 先立 D 行再派单；修复提交同步更新 sequencing 文档的 D 行、feature-ledger 和 CHANGELOG。
- 第 3、4 节中的 `#` 与本地 findings 文件的行号一致，可直接交给 `/cc-suite:audit-fix`。
