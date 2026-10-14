# D190 WI-2 (W2)：Windows 自存后不再误报 "External change detected"，win-desktop 真机记录（2026-10-14）

执行方：mdpro-delegator 派出的子代理，从 MacBook 经 SSH 操作，用项目 skill `remote-windows-device-test`。brief：`docs/pending/20261014-brief-windows-d190-w2.md`（未提交），路径与 helper 沿用 `docs/pending/20261014-brief-windows-d190-w1-w5.md`。没有用 computer use，没有在 Windows 端跑 Claude。时间均为 +0800。证据在 `docs/test/windows-audit-20261014-w2/`：`cdp.sh shot` 的页面视口截图（不含桌面）、每个用例的 `log.sh` 输出（完整 context，未截断）、`menus.txt`、`config-diff.txt`、`caseB-fileid.txt`。没有全屏截图。

**用户授权（brief 警告 1）。** delegator 于 2026-10-14 用 AskUserQuestion 问「Is anything unsaved in mdpro on win-desktop right now?」，用户答：「Nothing unsaved, go ahead」。该授权只覆盖本批次的安装和重启。

## 0. 构建身份与前置检查

| 项 | 值 |
|---|---|
| 构建 | build-windows.yml run 38509299910，`headSha` `0742ee3581eec13de5a44c8115b4cc5135195c86`，conclusion success |
| 安装包 | artifact `mdpro-windows-0.3.1` → `mdpro_0.3.1_x64-setup.exe`，7930646 字节，SHA-256 `cd0d56b7053c74d839f098f597f0bdf1da7facd7b59943d30b3bfc84b9d2d026`（Mac 端 `shasum` 与 Windows 端 `Get-FileHash` 一致）。存为 `C:\Users\jack\mdpro-audit\mdpro_0.3.1_x64-setup-0742ee3.exe`，经 base64 ssh 管道接入 `$input` 传输，51 s |
| Authenticode | `NotSigned`（与上次相同） |
| 安装 | `close.ps1`（WM_CLOSE）→ 进程数 0 → `setup.exe /S /D=D:\programs\mdpro`，退出码 0，就地覆盖 |
| `tauri-app.exe` | LastWriteTime 安装前 `2026-10-14T10:38:42+08:00`（c53c05e 构建）→ 安装后 `2026-10-14T12:07:56+08:00`（早于安装时刻约 12:18，是安装包里带的文件时间）；SHA-256 `66B7F346EE9DA5F52C991DF78CC8948075932A9A52B95D850603CAD980B39030`（上次为 `4923BAA0…`） |
| `app.ready` | `12:19:50.947 app.ready success {"appVersion": "0.3.1", "buildId": "unknown", "pid": 39160, "platform": "windows", "releaseId": "unknown", "startupTimeMs": 594}` |
| logging / MCP | `{"enabled":true,"level":"info"}`；`mcp.serverEnabled` True |
| 窗口 | `mdpro.sh debug --yes` 后已 `max`，`innerWidth` 1120，`tauri-app: 1`；启动时 `file.draft.list listed 0` |
| config 备份 | `%USERPROFILE%\.mdpro\config.json.d190w2-before` |
| Fixtures | `%WIN_DIR%\fx\d190w2\`：w2a–w2f.md、ro.md（各 `# w2x\n\nline one\n`），全部 `hash ok`；ro.md 随后 `attrib +r` |
| 外部变更 UI 选择器 | `[role=dialog][aria-label="Reload file"]`，即 `src/components/common/ReloadDialog.tsx:57`，标题 `External change detected`（`useExternalChangePrompt.ts` 的 `reload-prompt` / `deleted-prompt` 都用它）。每个用例用 cdp 查询它，并用 `dlg` 查全部 `[role=dialog]` |

## 1. 结论

所有 `file.watch.event` 证据行都是 `log.sh since` 之后完整 context 的原文（见证据目录同名 `.log`）。下表为节选。

| # | 项 | 结论 | 证据行（原文节选） | 对照 |
|---|---|---|---|---|
| A | 打开 | 通过 | File → Open（`C:\…`）：`12:26:48.061 file.watch.register success {"alreadyWatched": false, "baseline": "seeded", … "seedCheck": "unchanged", "size": 16, …}`；之后 7 s 内没有 Reload file 对话框，`dlg` = `[]`。0.3.1/c53c05e 上这里是 `baseline: failopen` + 立即 `open-check` 提示。其余 6 次打开（w2b–w2f、ro、单实例）也都是 `"baseline": "seeded", "seedCheck": "unchanged"`，没有提示 | D(1)：同一文件外部追加后弹出提示（通过） |
| B | ①+③ 保存 | 通过 | `ctrl+s`（真键）编辑后保存：`12:29:49.036 file.save success {… "fileSizeBytes": 22}`；该路径的两条 watcher 事件：`12:29:49.036 file.watch.event cancel {"kind": "remove", "detail": "any", "outcome": "self_write", "unchangedCheck": "not_checked", …}`，`12:29:49.041 file.watch.event cancel {"kind": "modify_name", "detail": "to", "outcome": "ignored_unchanged", "unchangedCheck": "unchanged", …}`；`file.change.received cancel {"outcome": "own-save"}`；没有 `emitted_*`，没有提示 | D |
| C | ② 拼写 | 通过 | 单实例打开（`ui.sh open`，见 harness 2）：`file.open.external start {"filePaths": ["C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\w2b.md"], "source": "single_instance"}`，register `"baseline": "seeded"`。两次编辑后保存（22 / 30 字节），每次都是 `remove/any → self_write` + `modify_name/to → ignored_unchanged`，没有 emit，没有提示。所有行的 `path` 都是普通 `C:\…`，没有 `\\?\`。项 ② 的计时竞争没有观察到（未能从外部引导） | D |
| D(1) | ④ 追加 | 通过 | `Add-Content`：`12:31:18.830 file.watch.event success {"kind": "modify_any", "detail": "none", "outcome": "emitted_modified", "unchangedCheck": "stat_differs", "size": 35, …}` → `file.change.decision {"action": "reload-prompt"}`；对话框 `External change detected / File was modified externally…`（`caseD1-prompt.png`）。点 Reload | B（自存不提示） |
| D(2) | ④ 原子替换 | 通过 | 先写 `.tmp` 再 `Move-Item -Force`：`12:32:40.957 file.watch.event success {"kind": "remove", "detail": "any", "outcome": "emitted_deleted", …}`，`12:32:40.964 file.watch.event success {"kind": "modify_name", "detail": "to", "outcome": "emitted_modified", "unchangedCheck": "stat_differs", "size": 39}`，随后 `modify_any → ignored_unchanged`；前端只投递一次 `modified`（`file.change.received success … "delivered"`），一个提示。没有 `emitted_renamed`：Windows 上覆盖式替换呈现为 删除 + 改名到 | B |
| D(3) | ④ 同长度改写 | 通过 | 39→39 字节：`12:33:30.998 file.watch.event success {"kind": "modify_any", "outcome": "emitted_modified", "unchangedCheck": "stat_differs", "size": 39}` → `reload-prompt`，有提示 | B |
| D(4) | ④ 改写并恢复 mtime | 通过 | mtime 恢复为 `12:33:30.9904970`、长度不变：`12:34:21.863 file.watch.event success {"kind": "modify_any", "mtimeMs": 1791952410990, "outcome": "emitted_modified", "size": 39, "unchangedCheck": "hash_differs"}` → `reload-prompt`，有提示。哈希比较确实被走到 | B |
| E | ④ 写句柄 | 通过 | `[IO.File]::Open(…,'ReadWrite','ReadWrite')`，12:35:17.933 写入并 Flush，保持 5 s，12:35:22.947 关闭。**Flush 时没有任何事件**；关闭时：`12:35:22.954 file.watch.event success {"kind": "modify_any", "outcome": "emitted_modified", "unchangedCheck": "stat_differs", "size": 58}` → `reload-prompt`，提示一次。没有 `unstable` 行 | D(1) |
| F | ⑤ 多次保存 | 通过 | w2c 5 次编辑+`ctrl+s`：5 条 `file.save success`，10 条 watcher 事件全部是 `remove any self_write not_checked` / `modify_name to ignored_unchanged unchanged`，0 条 `emitted_*`，每次保存后都没有提示。之后外部追加：`12:43:49.061 file.watch.event success {"kind": "modify_any", "outcome": "emitted_modified", "unchangedCheck": "stat_differs", "size": 43}` → `reload-prompt`，有提示 | （本身含对照） |
| G | ⑤ 删除 / 移动 | 通过 | `Remove-Item w2d.md`：`13:00:47.698 file.watch.event success {"kind": "remove", "detail": "any", "outcome": "emitted_deleted"}` → `file.change.decision {"action": "deleted-prompt"}`，对话框 `File was deleted externally. Save to a new location if needed.`（`caseG-deleted-prompt.png`）。`Move-Item w2e.md w2e-moved.md`：`13:02:57.220 file.watch.event success {"kind": "modify_name", "detail": "from", "outcome": "emitted_deleted"}` → `deleted-prompt`（`caseG-moved.png`）。移动按删除处理，标签仍是 `w2e.md`，没有跟随到新名（watcher 只看这个文件，看不到新名），没有被报成 modified | D |
| H | ⑥ 另存为 | 通过（路线已调整，见 harness 3） | 这个构建没有对已保存文件的 Save As 入口（File 菜单无此项，`fileSaveAs` 快捷键只在设置里列出、没有处理代码）。改为：打开 w2f 并编辑，然后 `ctrl+n` 新建、输入、`ctrl+s` → 另存为对话框 → `w2f-as.md`（同目录）：`12:56:43.308 file.save success {"filePath": "…\\w2f-as.md", "fileSizeBytes": 13}`，`file.watch.register success {"baseline": "seeded", "seedCheck": "unchanged"}`，`file.change.received start {"outcome": "captured"}`，没有提示；切到 w2f 再切回 w2f-as，均无提示。之后保存 w2f 本身：`self_write` + `ignored_unchanged`，无提示 | B |
| I | ⑥ 连续保存 | 通过（真正的并发未达成） | 一次 `ui.sh` 内两个 `ctrl+s`：两次保存相隔 434 ms，各自 `self_write` + `ignored_unchanged`，无提示。补充页面路径：同一 eval 里不等待地发两次 `ctrl+s`：`12:46:07.827 file.save.queued start` → 第一次 12:46:07.830–.835，第二次 12:46:07.862–.868，都是 `self_write` / `ignored_unchanged`，无提示。前端把保存排队串行，所以两个自写标记从未同时存在，引用计数没有被这个用例真正考到 | B |
| J | ⑥ 只读 | 通过 | `ro.md`（`attrib +r`）编辑后 `ctrl+s`：`12:52:16.233 file.save fail {"filePath": "…\\ro.md"} permission denied: C:\Users\jack\mdpro-audit\fx\d190w2\ro.md`；toast `Save failed: permission denied: C:\Users\jack\mdpro-audit\fx\d190w2\ro.md`（`__a.toasts()`）；标签保留修改圆点（`caseJ-ro-error.png`，截图时 toast 已消失）；进程仍在（`tauri-app: 1`）；文件内容未变；没有 watcher 事件，没有提示 | B |
| K | ⑥ 共享冲突 | 通过 | PowerShell `FileShare None` 持有 w2c 40 s（12:47:17–12:47:57）。第一次 `ctrl+s`：`12:47:46.691 file.save fail {…} permission denied: C:\Users\jack\mdpro-audit\fx\d190w2\w2c.md`，toast 相同，标签保留修改圆点，磁盘内容未变，没有残留临时文件。释放后第二次 `ctrl+s`：`12:49:16.529 file.save success {"fileSizeBytes": 51}`，`self_write` + `ignored_unchanged`，无提示，圆点消失。补充对照：之后外部追加仍然提示（`12:50:16.572 … emitted_modified`），说明失败的保存没有留下吞掉外部变更的自写标记 | B |
| L | ⑦ 文件系统 | NTFS 已记录 | `Get-Volume -DriveLetter C` → `FileSystemType : NTFS`，`DriveType : Fixed`。ReFS、SMB、可移动盘：维持 fail open，未验证 | — |

汇总：A–K 全部通过，L 记录为 NTFS。没有 Windows 不通过项。H 走的是调整后的路线（没有 Save As 入口），I 的真正并发未达成（前端串行），见各行。

### 用例 B 的文件 ID（项 ①）

`fsutil file queryfileid`（证据 `caseB-fileid.txt`）：

- 第一次保存（12:28:28，未编辑，16 字节）：`0x00000000000000000039000000016f18` → `0x000000000000000000390000000811fe`
- 第二次保存（12:29:49，加了 " alpha"，22 字节）：`0x000000000000000000390000000811fe` → `0x0000000000000000003c0000000812b3`

**每次保存后文件 ID 都变了**：保存是写临时文件再改名覆盖，而不是原地写入。watcher 看到的就是这个过程：旧文件的 `remove`（由自写门判为 `self_write`），然后新文件的 `modify_name/to`（基线哈希相同，判为 `ignored_unchanged`）。

### 其他事实

- `remove` 和 `modify_name/to` 在外部写入时会 emit（D(2)、G），自写时则被吞掉（B、C、F、I、K），说明门把两种情况分开了。
- 外部 `Add-Content` 和 `WriteAllText` 在 Windows 上都表现为 `modify_any`/`none`，WI-2 把它纳入了「未变化」检查（D(2)–D(4) 里第二条 `modify_any` 被判为 `ignored_unchanged`，第一条照常 emit）。
- E：NTFS 在句柄关闭前不发目录变更通知，所以「写句柄一直开着」期间不会有事件，提示在关闭时才出现。没有观察到 `unstable`。
- 新打开的文档用 WYSIWYG，w2a 打开时为 Source（`lastViewMode` 当时为 source）；本次没有切换视图。

## 2. 收尾与 config diff

- `attrib -r ro.md` 已执行（属性变回 `A`）。
- 关掉所有 fixture 标签。ro.md 是脏的，关闭时 `Unsaved changes / Close this document without saving?` → Discard。关闭前 13:05:10 写过一份 ro 草稿（`draft.write success {"bytes": 22}`）；之后 `mdpro.sh debug --yes` 重启：`file.draft.list success {"listed": 0, …}`，没有 Recover drafts 可放弃。
- `mdpro.sh normal --yes`：`port 9222 closed`，已最大化，`tauri-app: 1`，`file.draft.list listed 0`。`mdpro.sh cleanup` 无残留任务。
- `Compare-Object config.json config.json.d190w2-before`（原文，`=>` 为备份侧，`<=` 为当前侧）：

```
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w4.md",       =>
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w3.md",       =>
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w1.md",       =>
    "C:\\Users\\jack\\mdpro-audit\\fx\\image2.md",         =>
    "\\\\?\\C:\\Users\\jack\\mdpro-audit\\fx\\image.md",   =>
    "\\\\?\\C:\\Users\\jack\\mdpro-audit\\fx\\long.md",    =>
    "\\\\?\\C:\\Users\\jack\\mdpro-audit\\fx\\basic.md",   =>
    "\\\\?\\C:\\Users\\jack\\mdpro-audit\\fx\\work2.md",   =>
    "\\\\?\\C:\\Users\\jack\\mdpro-audit\\fx\\work16.md"   =>
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\w2e.md",    <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\w2d.md",    <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\w2f.md",    <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\w2f-as.md", <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\ro.md",     <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\w2c.md",    <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\w2a.md",    <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190w2\\w2b.md",    <=
    "C:\\Users\\jack\\mdpro-audit\\fx\\d190\\w4.md"        <=
```

只有 `recentFiles` 变了：本次 8 个 fixture 进了列表，挤掉了末尾的旧项（都是 fixture 路径）。Settings、`lastViewMode`、`windowStates` 都没变。没有手动还原，理由同上次（应用自己的正常写入）；备份留在 PC 上。

## 3. 操作失误与 harness 问题

1. **brief 的「双重转义」写法不对。** 在单引号 shell 字符串里写 `C:\\\\Users`，JSON 解码后是 `C:\\Users`，打开对话框报「文件名无效」，`ui.sh` 后续 `filedialog` 报 `file name box not found`（对话框后面压着一个错误框）。用 `chord enter` 关掉错误框，再用单引号里的 `C:\\Users`（JSON 解码后单反斜杠）就正常了。上次报告的 `FXJ='C:\\Users\\…'` 才是对的写法。这次多出一个错误框，用一张临时全屏截图定位，看完已删除（Mac 和 PC 两端），没有进证据目录。
2. **C 的路线。** brief 写 `ssh … "Start-Process '$env:MDPRO_EXE' '<path>'"`。SSH 会话不在桌面会话里，第二个实例找不到正在运行的窗口，单实例转发不可靠，所以改用 `ui.sh open`（桌面会话里执行 `tauri-app.exe <path>`，等同双击）。日志 `source: single_instance` 证明走的是单实例路线。
3. **H：没有 Save As 入口。** File 菜单（`menus.txt`）没有 Save As，`preferences.ts` 的 `fileSaveAs: "Cmd+Shift+S"` 只出现在设置的快捷键列表里，代码中没有处理器。Save As 只在未命名文档按 `ctrl+s` 时出现（`documentSave.ts`）。H 因此改为 新建 → 保存到 `w2f-as.md`，同时 `w2f.md` 打开着且是脏的。「另存为后旧路径提示」这个分支在这个构建里无法走到。
4. **I：两个真键 `ctrl+s` 相隔约 430 ms**（`chord` 自带间隔），保存没有重叠。补的页面路径（两次 `__a.key` 不等待）触发了 `file.save.queued`，前端仍然串行。后端引用计数在两次写真正重叠时的行为，这次没有考到（brief 说那属于单元测试）。
5. **第一次 B 和第一次 C 的输入失败。** w2a 打开时是 Source 模式（CodeMirror），我的输入 helper 按 `.ProseMirror` 写的，报错；随后的 `ctrl+s` 保存了未修改的内容（B 16 字节，C 两次 16 字节）。这几次也是 `self_write` + `ignored_unchanged`、无提示，保留在 `caseB-save.log` 的前一次和 `caseC-saves.log`；判定用的是修好 helper 之后有编辑的保存（`caseB-save.log` 的 12:29:49 段、`caseC-saves-edited.log`）。H 的新建文档也一样，先取消了对话框、重新输入再保存。
6. `log.sh since` 会把 context 截到 240 字符，`file.watch.event` 的 `outcome` / `unchangedCheck` 会被截掉。证据用的是同一方法、不截断的本地 helper（只读日志）。
7. toast 只持续约 3 s，`cdp.sh shot` 来不及拍到（J、K 的截图里只有修改圆点）；toast 文本来自 `__a.toastsOn()` / `__a.toasts()`。
8. `fsutil` 的输出标签是 GBK，经 ssh 会乱码；ID 本身是 ASCII，已原样记录。

## 4. 留在 win-desktop 上的东西

- mdpro 0.3.1（`0742ee3` 构建）装在 `D:\programs\mdpro`，normal 模式运行，没有 DevTools 端口，没有打开文档。
- `C:\Users\jack\mdpro-audit\`：安装包 `mdpro_0.3.1_x64-setup-0742ee3.exe`（7.6 MB）；`fx\d190w2\`（ro.md 已去掉只读，w2a/b/c/f.md 已被修改，w2f-as.md、w2e-moved.md 是本次新建的，w2d.md 按用例 G 删掉了，w2e.md 已改名为 w2e-moved.md）；本次 `cdp.sh shot` 留下的 8 张副本 `caseA-open.png` … `caseK-save1-error.png`。删除文件夹属于 rule 25 操作，没有做。
- `%USERPROFILE%\.mdpro\config.json.d190w2-before`（备份）。
- 没有残留计划任务。任何 token 都没有读过（只用过 `Test-Path`，本次甚至没有用到）。
