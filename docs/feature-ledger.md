# 功能账簿

**mdpro** · 首次建账 2026-09-17 · 分支 `frontend-backend-redesign`

一份文档，两个任务。

- **逐条查验。** Part 1 是 mdpro 声称拥有的每一项能力、它**实际**处在什么状态、代码在哪、以及怎么在跑着的 app 里确认它。它是写来对着 app 从头走到尾的。
- **找出缺口。** Part 2 和 Part 3 把 mdpro 摆在另外十个编辑器旁边，明说什么是缺的、什么是**故意**不做的、什么是别人都没有的。

这份账簿描述 **mdpro 现在有什么**。它不是 changelog：一个缺陷的修复是一次提交，不是一行；给每个缺陷开一行，这份文档就没人能读了。它也不是计划：工作项的先后与验收在 `docs/plans/`，决策在 `docs/adr/`，什么时候变的在 `CHANGELOG.md`。

## 状态图例

状态是下面五个词之一，而这个区分正是本文的全部意义：

| 状态 | 含义 |
|---|---|
| `Shipped` | 已实现，且在 app 里验证可用 |
| `Partial` | 能用，**但有一条写明的限制** |
| `Stub` | 类型、接缝或 UI 存在，行为不存在 |
| `Absent` | 没建 |
| `Unknown` | 从依赖继承、从未在此测过——**不做任何声称** |

**Stub 不是功能。这份账簿写 Stub 的地方，就不要对外描述 mdpro「有」这个东西。**

枚举是封闭的。`Shipped（仅导出）` 不是一种细微差别，是一次失败——`pnpm ledger:check` 会因此拒绝整份文档。细微差别写进「怎么确认」那一格。

`Partial` **必须**在「怎么确认」里带一条 `限制：`，写明那条限制是什么。不写明限制的 Partial，正是这条规则要挡住的东西。

## 怎么写「在哪」这一格

路径一律**从仓库根写起**，放在反引号里：`src/plugins/milkdown/imagePastePlugin.ts`，不是 `imagePastePlugin.ts`，也不是 `milkdown/imagePastePlugin.ts`。

分区相对的短写法被考虑过并且否决了：**它让同一条路径因为上面的标题不同而含义不同，于是把一行挪到另一个分区就悄悄改掉了它的声称。** 啰嗦是有意的——这一列是给「决定该去哪儿看」的人读的。

三条禁令，每一条都是因为它会**悄悄**烂掉：

- **不写行号。** `src/App.tsx:412` 在下一次编辑该文件时就过期了，而路径解析检查抓不到它——文件还在。行号那一级的细节写进「怎么确认」的散文里。
- **不写计数。** 「16 个动作」是一个有半衰期的事实。
- **不写构建产物。** `dist/`、`target/`、`coverage/` 下的路径在每一次全新 clone 上都是红的。

## 门禁

```bash
pnpm ledger:check     # 三项机器检查，有发现就退出 1
pnpm ledger:build     # 渲染 docs/feature-ledger.html
```

`ledger:check` 问三个问题：**每一条路径声称都能解析、每一个状态格都在五值枚举内、app 声明的每一个名字都被写进了某一行。** 第三项是关键的那一项——它抓的是「**没有人为它写过一行**的那个界面」。今天它覆盖 `#[tauri::command]`、`http_server.rs` 的路由、`menu.rs` 的 `MENU_*` id、`pluginConfig.ts` 的插件 id、以及 `src/stores/` 下的每一个 store。

它**不能**问一个句子是不是真的。路径能解析，不代表那一行描述的行为还存在。

## 怎么维护

**改变行为的那一次提交，重写它的那一行。** 不是后续的清理批次——留到清理批次的状态列，是没有人能信任的状态列。这跟 `CLAUDE.md` 里对 sequencing doc 的要求是同一条规则。

一次审计 pass 写成一个带日期的小节，**追加，不覆盖**，并且必须以一段「**这次没有关掉什么**」结尾。声称自己做了一次全面扫描，正是上一次 pass 存在的意义所要记录的那种过度声称。

---

## Part 1 — mdpro 现在有什么

对着 app 从头走到尾。每一行的「怎么确认」都是一个动作，不是一句「看代码」。

### 文件与文档管理

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 新建文档 | Shipped | `src-tauri/src/commands/file.rs` | ⌘N（`menu.file.new` → `create_document`），底部标签条出现一个空的 Untitled 文档 |
| 打开文件 | Shipped | `src-tauri/src/commands/file.rs` | ⌘O（`menu.file.open` → `open_file_dialog` → `open_file`），原生对话框只列出 .md / .markdown，选中后内容载入编辑器 |
| 最近打开 | Shipped | `src-tauri/src/menu.rs` | File → Open Recent，最多 10 条历史；菜单项 id 形如 `menu.file.recent.0`，整张列表由 `set_recent_files_menu` 重写。点任意一条直接打开该文件 |
| 保存 | Shipped | `src-tauri/src/commands/file.rs` | 改几个字后 ⌘S（`menu.file.save` → `save_file`），标签上的脏点消失 |
| 另存为 | Stub | `src-tauri/src/commands/file.rs`, `src/types/preferences.ts` | ⌘⇧S 按下去没有任何反应；偏好设置里有 fileSaveAs 这一项，但没有处理器也没有菜单项。未命名文档按 ⌘S 会经 `save_file_dialog` 弹出原生保存对话框，那条路是通的 |
| 关闭文档 | Shipped | `src-tauri/src/commands/file.rs` | 有未保存改动时按 ⌘W（`menu.file.close` → `close_document`），先弹确认再关 |
| 拖拽打开文件 | Shipped | `src/App.tsx` | 从 Finder 拖一个 .md 文件丢进窗口，直接打开 |
| Finder 文件关联 | Shipped | `src-tauri/tauri.conf.json` | 在 Finder 里双击任意 .md 文件，由 mdpro 打开 |
| 单实例启动路由 | Shipped | `src-tauri/src/launch.rs` | mdpro 已在运行时再双击一个 .md，不会开第二个进程，文件出现在已有窗口；前端启动后向 `get_launch_paths` 取这批待打开路径 |
| 编码自动检测 | Shipped | `src-tauri/src/services/encoding.rs` | 打开一个 UTF-16LE 文件，正常显示而不是乱码 |
| 编码选择对话框 | Shipped | `src/components/common/EncodingDialog.tsx` | 打开一个无法确定编码的文件，弹出 UTF-8 / UTF-16LE / UTF-16BE / ASCII 四选一，选中后重新解码 |
| 保存时保留原编码 | Shipped | `src-tauri/src/commands/file.rs` | 打开一个带 BOM 的 UTF-16 + CRLF 文件，⌘S 后用 `file` 或 hexdump 看，BOM、编码、换行符都没变 |
| 原子写入保存 | Shipped | `src-tauri/src/commands/file.rs` | 保存期间强杀进程，原文件要么是旧内容要么是新内容，不会被截断成半截；文件权限位保持不变 |
| 10MB 文件大小上限 | Shipped | `src-tauri/src/commands/file.rs` | 尝试打开一个超过 10MB 的 .md，被明确拒绝而不是卡住 |
| 大文件提示横幅 | Absent | — | 无论打开多大的 .md，这条横幅都不会出现——它是一段够不到的死代码。`useDocument.ts` 里 `LARGE_FILE_BYTES` 是 `10 * 1024 * 1024`，只在 `fileSize > LARGE_FILE_BYTES` 时提示；而 `src-tauri/src/commands/file.rs` 的 `MAX_FILE_SIZE` 是同一个 10MB，`metadata.len() > MAX_FILE_SIZE` 的文件一律以 `FileError::FileTooLarge` 拒开，两边比的又是同一个 `metadata.len()`。两道阈值相等，于是能触发横幅的文件永远打不开，能打开的文件永远触发不了横幅。想看到它只能先改其中一个常数 |
| 外部变更监听 | Shipped | `src-tauri/src/services/file_watcher.rs` | 在外部编辑器改同一个文件并保存，mdpro 侦测到；自己 ⌘S 不会触发误报；前端再用 `check_file_modified` 复核磁盘状态 |
| 外部变更重载提示 | Shipped | `src/components/common/ReloadDialog.tsx` | 在外部编辑器改同一个文件并保存，mdpro 弹出「Reload / Ignore」，选 Reload 走 `reload_file` |
| 未保存改动确认 | Shipped | `src/components/common/ConfirmDialog.tsx` | 在有脏改动时 ⌘W 或关窗口，弹出「Discard changes / Keep editing」 |
| 草稿自动保存 | Shipped | `src/hooks/useAutoSave.ts` | 偏好里把间隔设为 30 秒，改点内容后不保存等半分钟，`save_draft` 已把草稿写到盘上 |
| 启动时草稿恢复 | Shipped | `src/components/common/RecoveryDialog.tsx` | 有脏文档时强杀 mdpro 再启动，`list_drafts` 列出可恢复草稿，每条都有 Recover / Discard，点 Recover 走 `recover_draft` |
| 按 id 读取单份草稿 | Partial | `src-tauri/src/commands/draft.rs` | 限制：`get_draft` 在 `handlers()` 里注册着、函数体也实现好了，但 `src/` 与 `tests/` 里都找不到调用点——草稿恢复实际走的是 `list_drafts` + `recover_draft`。在 DevTools 里手写 `invoke("get_draft", …)` 能拿到结果，UI 上没有任何操作会触发它 |
| 保存后清理草稿 | Shipped | `src/hooks/useDocument.ts` | ⌘S 真正写盘之后重启，`delete_draft` 已清掉草稿，恢复对话框不再列出这个文件 |
| 陈旧草稿清理 | Shipped | `src-tauri/src/commands/draft.rs` | 启动时调一次 `cleanup_old_drafts`，长期不动的旧草稿被自动清掉，恢复列表不会无限增长 |
| 文件增删重命名 | Absent | — | 没有任何从 app 内删除或重命名磁盘文件的入口——没有文件树，标签上的 `×` 只关标签不动文件。仓库里 `remove_file` 的全部命中都是内部清理（原子写入的临时文件、MCP 的端口/令牌文件、一个测试），没有一条是用户可触发的 |

### 编辑 / WYSIWYG

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| WYSIWYG 编辑 | Shipped | `src/components/Editor/MilkdownEditor.tsx` | ⌃4（`menu.view.wysiwyg`）切到所见即所得，直接在渲染后的文本上编辑，撤销历史完整；编辑器实例挂在 `milkdownEditorStore` 上，表格与插入类操作都从那里取 view |
| 行内源码显隐 | Shipped | `src/plugins/milkdown/inlineEditPlugin.ts` | 光标移进一个链接或行内代码，原始语法展开；移出去自动收起（插件 `inline-edit`）。⌃` 手动切换 |
| 粗体 / 斜体 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 选中一段文字按 ⌘B 或 ⌘I，样式立刻切换；这组键来自插件 `typora-keymap` |
| 标题 1–6 与正文 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 光标停在某段按 ⌘1…⌘6 变成对应标题，⌘0 变回正文 |
| 行内代码 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 选中文字按 ⌘⇧`，变成等宽的行内代码 |
| 删除线 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 选中文字按 ⌃⇧`，出现删除线，源码里是 `~~text~~` |
| 插入链接（WYSIWYG） | Shipped | `src/components/Editor/LinkInsertModal.tsx` | WYSIWYG 下选中文字按 ⌘K，弹出由 `linkInsertStore` 驱动的应用内模态框，填 URL 后确认 |
| 链接 URL 消毒 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 在 ⌘K 框里填 `javascript:alert(1)` 被拒；填 `example.com` 自动补成 `https://example.com` |
| 高亮选区 | Partial | `src/plugins/milkdown/milkdownHighlightCommand.ts`, `src/plugins/codemirror/highlightPlugin.ts`, `src/plugins/core/pluginConfig.ts` | 限制：⌘⇧H 依焦点产生两种不同语法。先点进源码编辑区让 CodeMirror 持有焦点再按 ⌘⇧H，走插件 keymap，而 `pluginConfig.ts` 的 registry 配置压过插件默认值，插入原始 `<mark style=…>`；焦点不在 CodeMirror 时按 ⌘⇧H 走 `App.tsx` → `highlightCommand(view)`，发出 `==…==`。两次操作对比源码即可看到。菜单入口是 Format → Highlight Selection（`menu.format.highlight`），CodeMirror 侧的插件 id 是 `highlight` |
| `==text==` 往返 | Shipped | `src/plugins/milkdown/highlightMarkPlugin.ts` | 在源码里写 `==foo==`，⌃4 切到 WYSIWYG 显示为高亮块，⌘S 存盘后源码仍是 `==foo==` |
| 图片粘贴 | Shipped | `src/plugins/milkdown/imagePastePlugin.ts`, `src-tauri/src/commands/image.rs` | 截个图后 ⌘V（插件 `image-paste`），`upload_image` 把图片写进文档同级的 assets/ 目录，正文里自动插入引用 |
| 图片粘贴校验 | Shipped | `src/plugins/milkdown/imagePastePlugin.ts` | 粘贴一张 6MB 的 PNG，toast 指出被拒绝的原因；粘贴 GIF 同样被按格式拒绝 |
| 上传进度占位 | Shipped | `src/plugins/milkdown/imagePasteDecorations.ts` | 粘贴一张较大的图，落点处先出现「Uploading image…」占位，写完后替换成图片 |
| 未保存文档禁粘贴守卫 | Shipped | `src/plugins/milkdown/imagePastePlugin.ts` | 在未命名文档里粘贴图片，toast 提示「Save the document before pasting images」 |
| 批量多图粘贴 | Shipped | `src-tauri/src/commands/image.rs` | 一次选中多张图再 ⌘V，`upload_images_batch` 一趟处理完，收到一条汇总 toast，例如「3 images pasted, 1 failed」 |
| 图片拖放插入 | Shipped | `src/App.tsx` | 从 Finder 拖一张 png 丢到编辑区，光标处插入 Markdown 图片引用 |
| 图片缩放菜单 | Shipped | `src/components/Editor/ImageContextMenu.tsx`, `src/plugins/milkdown/imageResizePlugin.ts` | 右键点一张图，选 25% / 50% / 75% / 100%，或在自定义框里填 1–200 之间的数 |
| 图片宽度写回 Markdown | Shipped | `src/plugins/milkdown/imageResizePlugin.ts` | 设完宽度 ⌘S，源码里出现 `{mdpro-width=50%}` 标记；导出 HTML 后变成行内 style，且鼠标悬停时 tooltip 不显示这段标记 |
| 本地图片渲染 | Shipped | `src/hooks/useMilkdownImages.ts`, `src-tauri/src/commands/image.rs` | 写一个相对路径 `![](./assets/a.png)`，`resolve_image_path` 把它解析成 asset:// URL，图片直接显示；刚粘贴完的图也立刻可见 |
| 粘贴 HTML 消毒 | Shipped | `src/components/Editor/MilkdownEditor.tsx` | 从网页复制一段带 `<script>` 或 `onclick` 的富文本粘进来，脚本与事件属性被剥掉 |
| 链接点击守卫 | Shipped | `src/hooks/useMilkdownLinkClickGuard.ts` | 点 https 链接会交给系统浏览器；点 `file:` 链接不会打开任何东西，并记进日志 |
| 撤销 / 重做 | Shipped | `src/components/Editor/Editor.tsx`, `src-tauri/src/menu.rs` | ⌘Z 撤销、⌘⇧Z 重做，两种模式下都生效 |
| 剪切 / 复制 / 粘贴 / 全选 | Shipped | `src-tauri/src/menu.rs` | ⌘X / ⌘C / ⌘V / ⌘A，走原生 Edit 菜单 |
| 插件架构（注册表管理插件生命周期） | Partial | `src/plugins/core/pluginRegistry.ts`, `src/plugins/core/pluginConfig.ts`, `src/plugins/index.ts`, `src/components/Editor/MilkdownEditor.tsx` | 限制：`getMilkdownPlugins()` 零调用点，registry 只管 CodeMirror；三个 Milkdown 插件是被 `MilkdownEditor.tsx` 直接 import 进去的，它们在 `pluginConfig.ts` 里的 `enabled` 开关是装饰品。把 image-paste 的 enabled 改成 false 再粘贴图片，图片照样粘进来 |
| 拼写检查 | Stub | `src/plugins/codemirror/spellCheckPlugin.ts` | 插件 id `spell-check`：`codemirrorExtension: () => []`，`displayName` 字面写着 "Spell Check (Stub)"。故意拼错一个词，不会有任何标注 |
| 专注模式 / 打字机模式 | Stub | `src/plugins/codemirror/focusModePlugin.ts`, `src/plugins/codemirror/typewriterModePlugin.ts`, `src/plugins/core/pluginConfig.ts` | 插件 id `focus-mode` 与 `typewriter-mode`：注册了，默认关，没有任何设置 UI 能打开。翻遍 ⌘, 的十个设置页也找不到开关 |
| WYSIWYG 下的数学公式排版 | Absent | — | ⌃4 切到 WYSIWYG，输入 `$E=mc^2$` 仍是字面文本，不会排版。Phase 2，决策 B3 |
| WYSIWYG 下的脚注渲染 | Absent | — | ⌃4 下输入 `[^1]` 与脚注定义，两者都以字面文本显示，没有跳转也没有回链。同 B3 |
| WYSIWYG 下的查找替换 | Absent | — | ⌃4 下按 ⌘F 不会出现查找面板；⌃2 切回源码模式才有 |

### 表格

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 插入表格对话框 | Shipped | `src/components/Editor/TableInsertModal/index.tsx`, `src/plugins/milkdown/table/insertTable.ts` | ⌘⌥T 或 Format → Insert Table（`menu.format.insert_table`），弹出由 `tableInsertStore` 驱动的对话框：在 10×10 网格上悬停选行列，或直接填 1–50 的数字，下方有实时读数 |
| 表格右键菜单（WYSIWYG） | Shipped | `src/components/Editor/TableContextMenu/index.tsx` | ⌃4 下右键点表格，出现分五组共 15 个操作（插入 4、移动 4、对齐 3、格式 1、删除 3），方向键可以在菜单里上下走 |
| 表格右键菜单（源码） | Shipped | `src/components/Editor/SourceTableContextMenu/index.tsx` | ⌃2 下右键点一段 Markdown 表格，同样的 15 个操作（插入 4、移动 4、对齐 3、格式 1、删除 3），直接改原始文本 |
| 插入行 / 列 | Shipped | `src/plugins/milkdown/table/actionDescriptors.ts` | 光标停在某个单元格，⌘⌥↑ / ⌘⌥↓ 上下加行，⌘⌥← / ⌘⌥→ 左右加列 |
| 删除行 / 列 / 整表 | Shipped | `src/plugins/milkdown/table/actionDescriptors.ts` | ⌘⌥⌫ 删当前行或列，⌘⌥⇧⌫ 删整张表 |
| 移动行 / 列 | Shipped | `src/plugins/milkdown/table/actionDescriptors.ts` | 右键菜单里选上移 / 下移 / 左移 / 右移；在第一行或最后一列时对应项是灰的 |
| 列对齐 | Shipped | `src/plugins/milkdown/table/actionDescriptors.ts` | 右键菜单里选左 / 中 / 右对齐，三者互斥，当前那个有选中标记，源码分隔行的冒号随之变化 |
| 重排表格 | Partial | `src/utils/tableEdits/applyEdit.ts`, `src/plugins/milkdown/table/contextMenu.ts` | 限制：WYSIWYG 下 `contextMenu.ts` 直接返回 false，菜单项可点但静默无操作；只有源码模式真正生效。⌃2 下对一张列宽参差的表用「重排表格」，竖线对齐；⌃4 下点同一项，什么都不会发生 |
| 保存时自动重排 | Shipped | `src/hooks/useDocument.ts`, `src/components/common/settings/MarkdownSettings.tsx` | 在 ⌘, → Markdown 里打开该开关（默认关），⌘S 后全文 GFM 表格被对齐；围栏代码块里的伪表格不受影响 |
| Tab 单元格导航 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts`, `src/plugins/codemirror/sourceTableTabNav.ts` | 在单元格里按 Tab 跳下一格、⇧Tab 跳上一格；在最后一格按 Tab 会新建一行并把光标放进去 |
| Esc 退出表格 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 光标在表格任意单元格里按 Esc，跳出表格 |
| 输入法安全的表格导航 | Shipped | `src/plugins/milkdown/typoraKeymapPlugin.ts` | 用中文输入法打字、候选框还开着时按 Tab，不会跳格而是交给输入法；围栏代码块里的 Tab 同样保持缩进语义 |
| 源码模式的表格识别范围 | Partial | `src/utils/tableParser/lines.ts`, `src/utils/tableParser/parse.ts`, `src/utils/tableParser/commonmark.ts` | 限制：与 GFM 不一致的另一半没有修——紧跟在一段文字后面、中间不空行的表格，GFM 认，mdpro 不认；实测语料 74 处里吻合 44 处（修之前是 40 处）。⌃2 下在一行 `\| a \|` 底下写一行 `---`，右键点它不再出现表格菜单，因为 GFM 把这两行当成一个二级标题；把 `---` 换成 `:-:` 就又是表格。分隔行或表头行前面加一个 Tab 或 4 个空格，同样不再算表格。为什么这么改见 `docs/adr/0009-narrow-source-table-detection-to-gfm.md` |
| 列数校验提示 | Shipped | `src/plugins/codemirror/lintTableColumnCount.ts` | ⌃2 下删掉某个**表体行**（不是表头行、也不是分隔行）的一个 `\|`，该行被标出与表头列数不符。删哪一行不是小事：从表头或分隔行删 `\|` 会让整张表不再被识别为表格，于是一条提示都不出现——那是另一条代码路径，也正是 2000 行表格上曾经卡住编辑器的那条 |
| 当前单元格高亮 | Shipped | `src/plugins/codemirror/sourceTableCellHighlight.ts` | ⌃2 下把光标移进表格，所在单元格有可见的高亮 |
| 列宽拖拽 | Shipped | `src/components/Editor/MilkdownEditor.tsx` | ⌃4 下拖动两列之间的竖线改列宽；只在本次会话有效，不写进 Markdown |
| 跨模式单元格光标同步 | Shipped | `src/hooks/useMilkdownTableCursorRestore.ts`, `src/stores/editorStore.ts` | 把光标放进第 3 行第 2 格，⌃2 / ⌃4 来回切，光标仍在同一格 |
| 宽表格滚动 | Shipped | `src/components/Editor/MilkdownEditor.css` | 插一张 15 列的表，横向滚动条出现在表格自己的容器上，整个编辑区不跟着横移 |
| HTTP 驱动的表格编辑 | Partial | `src/hooks/useMcpEvents.ts`, `src-tauri/src/services/http_server.rs` | 限制：只能从 HTTP 端点驱动，走不到 MCP——`mdpro_mcp.rs` 只注册了 get_open_documents、read_document、write_document、insert_content 四个工具，表格操作不在其中，AI 客户端调不到（与「HTTP 表格端点」是同一道墙的两面）。开着 mdpro，用 curl 带 token 打 `/api/v1/insert_table`、`/api/v1/set_cell`、`/api/v1/add_row`、`/api/v1/delete_row`、`/api/v1/add_column`、`/api/v1/delete_column`，后端发 `mcp:table_action`，`useMcpEvents.ts` 收下并把改动落到当前可见的编辑器里 |

### 源码模式

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 源码编辑 | Shipped | `src/components/Editor/Editor.tsx` | ⌃2（`menu.view.source`）切到原始 Markdown，有语法着色、行号和当前行高亮 |
| 查找与替换 | Shipped | `src/components/Editor/extensions/search.ts` | ⌃2 下 ⌘F 打开查找面板，⌘G / ⌘⇧G 跳下一个 / 上一个，⌘H 打开替换 |
| 源码模式标题级别 | Shipped | `src/plugins/codemirror/headingPlugin.ts` | 光标停在某行按 ⌘1…⌘6（插件 `heading`）前面补上对应数量的 `#`，⌘0 清掉；光标不会跳位 |
| 提升 / 降低标题级别 | Shipped | `src/plugins/codemirror/headingPlugin.ts` | 在一行上反复按 ⌘- 一路降到 H6 就停住，反复按 ⌘= 一路升回纯文本 |
| 源码模式插入链接 | Partial | `src/plugins/codemirror/linkPlugin.ts`, `src/components/Editor/LinkInsertModal.tsx` | 限制：走 `window.prompt`，而 rule 30 §6 禁止它，打包后很可能根本不弹窗；WYSIWYG 的 ⌘K 走 `LinkInsertModal`，是好的那条路。用 `pnpm tauri build` 出的包在 ⌃2 下按 ⌘K，与 `pnpm tauri dev` 下的表现对比即可看出。这条路的插件 id 是 `link` |
| 隐藏 Markdown 语法标记 | Shipped | `src/plugins/codemirror/wysiwygDecorationsPlugin.ts` | ⌃2 下光标不在的行（插件 `wysiwyg-decorations`），`## ` 收成 `H2` 徽标，列表项收成 `•`，引用收成 `>`，围栏收成 ``` 徽标；光标移回该行恢复原始语法 |
| 行注释切换 | Shipped | `src/components/Editor/Editor.tsx` | ⌃2 下 ⌘⌥/ 把当前行注释掉，再按一次取消 |
| 代码块缩进 / 反缩进 | Shipped | `src/plugins/milkdown/codeBlockIndentCommand.ts` | 在围栏代码块里选中几行按 Tab 整体缩进 4 空格，⇧Tab 反缩进 |
| 括号自动配对 | Shipped | `src/components/common/settings/MarkdownSettings.tsx` | 输入 `(` 自动补 `)`；在 ⌘, → Markdown 里关掉后就不再自动补 |
| 自动换行与缩进宽度 | Shipped | `src/components/common/settings/EditorSettings.tsx` | 在 ⌘, → Editor 里切换 word wrap 与 2 / 4 空格，编辑器当场生效，不用重启 |
| 代码块主题 | Shipped | `src/components/common/settings/AppearanceSettings.tsx` | 在 ⌘, → Appearance 里把代码主题从 Default 换成 One Dark，⌃2 下的着色立刻变 |
| 大文档性能保护 | Partial | `src/utils/largeDocumentGuard.ts`, `src/utils/largeDocumentDegradeLog.ts`, `src/App.tsx` | 限制：判据现在是**两个计数对两条阈值，任一条超了就降级**——结构元素数（ADR-0016，`docs/adr/0016-large-document-guard-predicate-is-a-source-structure-score.md`）= 换行数 +（竖线数 − 表格行起始数），阈值 25,000；最长行长度（ADR-0019，`docs/adr/0019-large-document-guard-adds-a-longest-line-trigger.md`）以 UTF-16 码元计，阈值 1,000,000。两条都是 `<=` 放行，都在同一趟前向扫描里算完，不解析 Markdown、不额外分配内存；`fileSize` 已从判据输入里彻底删除，字节数不再参与判断。ADR-0019 是对 ADR-0016 的**扩展而非取代**。仍然是 Partial 的三点：**（1）两条阈值的证据都很薄**——结构阈值只拟合在五份约 472 KB 的语料上，每份一次有效测量、同一台机器；行长阈值干脆**没有拟合**，实测只有两个点（359,285 码元 / 155 ms 放行，7,583,742 码元 / 259,483 ms 拦下），1,000,000 是在这中间整整一个数量级的空白里随手取的整数；**（2）除了换行和行长以外，对行内结构仍然失明**——一份 12 行、每行 900,000 字符的文档结构分是 11、最长行 900,000，两条阈值都过得去，却带着 10.8 MB 行内内容进了 ⌃4；范围比以前窄了，但没有消失；**（3）竖线算术两个方向都会错**——围栏代码块里的 `|` 被当成单元格（高估），省略首尾竖线的表格行被少算（低估）。**（此前记在这里的第四点「降级不留任何痕迹」已不再成立**——降级现在会写一条 `editor.large_document.degrade`（warn / fail）到 `~/.mdpro/mdpro.log`，载荷带 `trigger`、`elements`、`longestLine` 与当时生效的两条阈值。**但仍有一个面完全不可观测**：判据只在进入 ⌃4 时生效（`src/utils/largeDocumentGuard.ts:260` 对非 wysiwyg 一律放行），在 ⌃2 下直接打开同一份 9.96 MB 文档所付出的代价既不被判断、也不产生任何日志行，实测该路径冷开忙碌 153–183 s。）用 `node scripts/perf/generate-corpus.mjs <目录>` 生成语料，在 ⌃4 下打开 `large-table.wysiwyg.md`（471,880 B，结构分 57,190）或 `many-short-nodes.wysiwyg.md`（471,867 B、零表格，结构分 32,657）：都会弹出「This document is too complex for WYSIWYG. Switched to Source mode for performance.」并自动切到源码模式——这两份在旧的 500KB 字节阈值下都是放行的，正是 ADR-0004 记的 D6 漏判。再打开 `very-long-line.source.md`（9,961,475 B，结构分只有 3，最长行 7,583,742 码元）：**现在也会弹同一条提示并降级**，由行长这条触发——这份语料实测冷开阻塞 259,483 ms、界面至少两分钟不可用（`docs/test/20260921-d5-d6-real-device-measurement.md`），是 ADR-0016 当初明确接受、后来被实测推翻的那条限制。打开 `dense-math.wysiwyg.md`（471,942 B，结构分 20,664）或 `very-long-line.wysiwyg.md`（471,862 B，结构分 3，最长行 359,285 码元）则两条阈值都不触发，不弹窗、停在 ⌃4。四份 472 KB 语料的结构分与 D6.1 实测冷开阻塞严格同序（`docs/plans/20260920-d61-wkwebview-sweep-record.md`：12,004 ms / 7,409 ms / 1,793 ms / 0 ms），25,000 这条线正落在 1.8 秒与 7.4 秒之间。确认日志：降级后跑 `grep large_document.degrade ~/.mdpro/mdpro.log | tail -1 | jq .`，应看到 `context.trigger` 为 `structure` / `line-length` / `both` 三者之一 |

### 导出

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 导出 HTML | Shipped | `src-tauri/src/commands/export.rs`, `src/utils/headingIdentity.ts` | ⌘⇧E 或 File → Export HTML（`menu.file.export_html`）；前端先用 `render_markdown` 渲染，再把 body 交给 `export_rendered_html` 落盘，产出一个带样式、可单独打开的 .html 文件。标题锚点在一篇文档内唯一：导出 `# x` / `# x` / `# x-1` 三行，得到的 `id` 是 `x` / `x-1` / `x-1-1`（第三行不再和第二行撞成同一个 `x-1`）；只有 emoji 的标题得到 `heading`、`heading-1`，不会出现空的或以 `-` 开头的 `id`。三个活着的 slug 生成面（`tocService.ts`、`exportService.ts`、`markdown.rs`）由 `tests/render-fixtures/heading-identity.json` 和它的两个 runner 钉住。标题叫 `Title` / `Name` / `Body` / `Location` / `Forms` 时锚点同样存在：导出 `# Title` 后在 HTML 里能看到 `<h1 id="title">`，早先它会被 DOMPurify 的 `SANITIZE_DOM` 悄悄剥成只剩 `data-heading-id`，ADR-0003 B′ 关掉了那道防护（`src/services/sanitizerPolicy.ts` 的 `sanitizeExportFragment`，只给导出用、绝不进 App 活 DOM） |
| 数学公式 | Partial | `src/services/mathRender.ts`, `src-tauri/src/services/markdown.rs` | 限制：只在 Rust 渲染面／导出排版，导出走 MathML；WYSIWYG 与源码模式下 `$…$` 是字面文本。写 `$$E=mc^2$$` 后 ⌘⇧E，用浏览器打开导出的 HTML 能看到排版好的公式，且页面不加载任何 JS |
| 脚注 | Partial | `src-tauri/src/services/markdown.rs` | 限制：同上，只在导出渲染，WYSIWYG 下 `[^1]` 是字面文本。写一组 `[^1]` 引用与定义后 ⌘⇧E，导出的 HTML 里点引用跳到脚注，脚注末尾的 `↩` 能跳回来 |
| 自动链接与 emoji | Shipped | `src-tauri/src/services/markdown.rs` | 正文里写一个裸的 `https://example.com` 和一个 `:smile:`，⌘⇧E 后前者变成可点链接，后者变成 emoji |
| GFM 渲染 | Shipped | `src-tauri/src/services/markdown.rs` | 导出含表格、任务列表、`~~删除线~~` 和 `==高亮==` 的文档，四者在 HTML 里都正确呈现 |
| Mermaid 图表 | Stub | `src-tauri/src/services/markdown.rs`, `src/services/sanitizerPolicy.ts` | 写一个 mermaid 围栏代码块（三反引号 + `mermaid`），三种模式下它都只是代码块，导出后也仍是代码块。消毒策略里有一整套 SVG 标签白名单是为 Mermaid 开的，Rust 侧还有 `test_sanitize_preserves_mermaid_svg` 在绿着——但 `package.json` 里没有 mermaid 依赖。这道门守着一个不存在的渲染器；那个测试证明的是消毒器不会剥掉 SVG，不是 mdpro 能画图 |
| 导出消毒 | Shipped | `src-tauri/src/services/markdown.rs`, `src/services/sanitizerPolicy.ts` | 文中嵌一段 `<script>` 或 `<a href="javascript:…">`，导出的 HTML 里已被剥除；`style` 属性一律不放行；写 `<a name="x">` 或 `<img name="body">`，导出后 `name` 属性不见了（ADR-0011，`id` 才是受支持的写法）。JS 侧的 `sanitizeExportFragment` 只用于导出落盘，`SANITIZE_DOM` 刻意关着——这是与 ammonia 的一处有记录的分歧，不是漏配；`<form>` 必须留在白名单之外，这条前置条件由 `tests/sanitizer-policy.test.ts` 用行为断言守着 |
| 默认导出目录 | Shipped | `src/components/common/settings/ExportSettings.tsx` | 在 ⌘, → Export 里用 Browse（`pick_export_folder`）选一个固定目录，之后 ⌘⇧E 不再每次问路径；留空则每次弹框 |
| 内嵌样式开关 | Shipped | `src/components/common/settings/ExportSettings.tsx` | 在 ⌘, → Export 里关掉「include styles」，导出的 HTML 里不再有内联 CSS |
| 预览面板（Preview） | Absent | — | ⌃2 与 ⌃4 之间切不出第三种视图——预览窗格在 Stage-2 死代码清理里被删了。遗留的 `preview_html` 命令仍然注册着、`exportService.previewHtml` 也还在，但零调用点；同一条渲染管线上的 `render_markdown` 反而是活的，导出时由 `exportRenderedHtml` 调用 |
| 导出 HTML 片段命令 | Partial | `src-tauri/src/commands/export.rs`, `src/services/exportService.ts` | 限制：`export_html` 与它的包装 `exportService.exportHtml` 在前端零调用点，⌘⇧E 走的是 `export_rendered_html`。不删它是一条写下来的决定，不是忘了清理——理由在 knip 死代码提案 §5.6（`docs/plans/20260912-proposal-knip-dead-code-detection.md`），与可达性无关；ADR-0003 自己也写明这条理由「自成一套、不受该记录影响」。别把两件事接到一起：ADR-0003 那个失效条件——一旦 `<form>` 进入消毒白名单就必须重新评估——管的是导出消毒里关掉 `SANITIZE_DOM` 的那条决定，不是 `export_html` 的去留 |
| PDF 导出 | Absent | — | File 菜单里没有 PDF 项，⌘⇧E 只产出 HTML。这是立场不是缺口——曾评估过 headless Chromium，因体积被否 |
| Word / DOCX 导出 | Absent | — | File 菜单里没有 Word / DOCX 项。立场 |
| 打印 | Absent | — | ⌘P 没有反应，File 菜单里也没有 Print 项。全仓库没有任何 `window.print` 或打印命令；要打印只能先 ⌘⇧E 导出 HTML，再在浏览器里打。这条**不是**已记录的立场——PDF 导出是被评估后否掉的，打印从没被评估过 |
| 引文 / BibTeX | Absent | — | 写 `[@citekey]` 不会被解析，导出后仍是字面文本；没有文献库设置页 |

### 导航与界面

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 大纲侧栏 | Partial | `src/components/Sidebar/TOCSidebar.tsx`, `src/hooks/useTOC.ts`, `src/services/tocService.ts`, `src/stores/tocStore.ts`, `src/stores/tocCoordination.ts`, `src/stores/tocHierarchy.ts`, `src/utils/headingCoordination.ts`, `src/utils/tocElementResolution.ts`, `src/utils/tocSpyMode.ts`, `src/utils/tocLineSpy.ts`, `src/utils/codemirrorViewportLine.ts`, `src/hooks/useWysiwygScrollSpy.ts`, `src/hooks/useSourceScrollSpy.ts`, `src-tauri/src/commands/toc.rs` | 打开一篇有 H1–H6 的文档，侧栏列出层级目录（`useTOC` 调前端的 `parseHeadingsFromContent` 解析，锚点由 `src/utils/headingIdentity.ts` 分配，结果存在 `tocStore`）；点任一条跳过去，滚动时当前标题自动高亮（**WYSIWYG 与源码两种模式都有，但机制不同——见本行末 2026-09-19 那条**），父节点可折叠。**2026-09-19 起，折叠态与滚动高亮不再被击键抹掉**（身份协调，`src/utils/headingCoordination.ts` 的两趟匹配 + `tocStore.setEntries`；协调与文档作用域的纯逻辑拆在 `src/stores/tocCoordination.ts`、层级构建拆在 `src/stores/tocHierarchy.ts`，是 300 行上限所迫的抽取，`tocStore.ts` 原样再导出，导入路径没变）：折叠一节、在正文里敲一个字符、等一秒让 300 ms 去抖解析跑完，那一节仍是折叠的，高亮也还在；把那条标题改个名（文字变、层级与在标题里的序号不变），折叠态跟着走，而锚点 `href` 随文字改变——这正是 key ≠ slug。**切到另一篇文档不是重置，是存档再取回**：离开 A 时 A 的折叠集合与活动项存进 `byDocument`，B 用 B 自己那份；切回 A，A 那两样原样回来（`src/stores/tocCoordination.ts` 的 `swapDocument`，由 `tests/toc-store-coordination.test.ts` 的 S6「A → B → A」钉住）。所以两篇文档之间不串味——哪怕它们有一个 slug 相同的标题，键也按文档 id 作用域；**关掉**文档才从 `byDocument` 清出。**按契约重置的是「整份内容被换掉」那一类，共八条**，在 `tocStore.resetCoordination` 的注释里逐条点名：`openDocumentFromPath` / `openDocumentFromDialog` / `openDocumentWithEncoding` / `upsertAndActivateDocument`（草稿恢复、dev 打开）这四条打开路径算在内，是因为 `Document.id` 是路径的哈希而 `upsertDocument` 原地替换，重开一个已经开着的文件会在同一个 id 下把缓冲区换掉；再加 `createDocument`、`replaceDocument`（从磁盘重新加载，外部改动重载也走这条）、以及 MCP `write_document` / `create_document` 两条。**⌘S 保存、普通击键、MCP `insert_content` 与 `table_action` 都不重置。**这条划分由 `tests/wholesale-path-partition.test.ts` 每次跑都从 `src/` 重新推导，来了第十一个调用方就红到有人给它归类为止。**这里有一笔记在明处的代价**：同一个槽位上「删一条再插一条」与「改名」在输入上无法区分，所以新插进去的那条会继承被删标题的折叠 / 高亮状态——写在 `src/types/toc.ts` 的 RESET 条款 (c) 里。**限制：标题里的行内标记不会被剥掉。** 写 `## [锚点规范](https://example.com) 附注`，侧栏那一条的文字就是字面的 `[锚点规范](https://example.com) 附注`，而不是「锚点规范 附注」——解析时只减掉了 `#` 号本身（`HeaderMark`），`LinkMark` / `URL` / `EmphasisMark` / `CodeMark` 都留在节点范围里。这是 ADR-0012 写明留给后续工作的，由共享语料 `tests/render-fixtures/heading-identity.json` 里的 `link-in-heading` 一条钉住。**解析器在 2026-09-18 由行正则换成了 Lezer**（ADR-0012，走 `@codemirror/lang-markdown` 里 Source 模式本就在跑的那棵树，不引入新依赖）：于是 setext 标题（`标题` 下一行写 `=====`）开始出现在大纲里，围栏代码块里的 `#` 行不再被误当成标题，CRLF 文档点击跳转也落到正确位置，引用块和列表项里的标题（`> # 标题`）也开始出现——这些以前都是错的。换解析器时**反方向差点开一个口子，已在同一次改动里堵上**：`#` 后面跟制表符而不是空格的标题（`#⇥标题`）一度完全不进大纲，而 CommonMark §4.2 认这种写法、Rust 导出侧（pulldown-cmark）也照认并给它 `<h1 id="tabbed">`，是 `@codemirror/lang-markdown` 6.5.0 的 Lezer 语法把这一行当成了普通段落。解法是在**只送去解析的那份副本**上把该制表符改成空格：等长替换，不挪动任何 offset，点击跳转仍落在原文正确位置。四个面（大纲、Rust 导出、canonical 导出、`marked` 兜底）由语料里的 `tab-heading` 一条一起钉住。`#` 后先空格再制表符不受影响。**第二条限制：嵌在引用块或列表项里的制表符标题（`> #⇥标题`）仍然漏掉**——那条重写锚在行首的 `#` 串上，看不见前面的 `>` 或 `-`。代价记在 `docs/plans/20260912-frontend-backend-sequencing-order.md` 3.3 行：解析成本比行正则高两个数量级，非门禁。**Rust 侧的 `get_document_headings` 命令仍然注册着，但零调用点**——它收 `content`，而前端包装 `tocService.getDocumentHeadings` 传的是 `document_id`，就算有人去调也调不通；2026-09-18 由 WI-3.2 复核。此前本行写「`get_document_headings` 解析」，那是错的。**2026-09-19 起，WYSIWYG 里两条同名标题各走各的**：点第一条去第一处、点第二条去第二处，慢慢往下滚时高亮也落在正确的那一条。此前两条都跳第一处、高亮永远停在第一条。根因不是那句「找到第一个文字相同的就 break」，而是两套去重算法对不上——我们给第二个 `# Intro` 起名 `intro-1`，Milkdown 的 `syncHeadingIdPlugin` 起名 `intro-#2`（`@milkdown/preset-commonmark@7.18.0/lib/index.js:2119-2161`），所以按 id 查必然落空，只剩那条按文字找第一个的兜底在干活；而它先试的 `data-heading-id` 在编辑面上每个标题都是 `null`，这个属性从来没人写过。现在改成按文档顺序对位（`src/utils/tocElementResolution.ts`，决策记在 [ADR-0014](adr/0014-toc-addresses-headings-by-document-order.md)）：每趟重算、不落库、不读也不写任何 DOM 属性，每个标题元素至多被占用一次，所以「两条目录项指向同一个元素」在构造上就不可能。**第三条限制：目录项数与编辑器里实际渲染出的标题数对不上时，对不上的那几条点了不动，但不会跳到别的标题去。**两种已知情形上面都提过：标题里带行内标记（`## [锚点规范](https://example.com) 附注` 的字面文字永远匹配不上 Milkdown 渲染出的 `锚点规范 附注`），以及 `> #⇥标题` 这种我们解析器看不见、Milkdown 却渲染出来的写法。这是有意选的代价——点了没反应，用户看得见也报得出来；静悄悄跳到错的标题，看不见。源码模式的跳转不走这条路径（按 `lineNumber` 交给 CodeMirror），不受影响。由 `tests/toc-element-resolution.test.ts`、`tests/use-toc-navigation-identity.test.ts`、`tests/use-toc-scroll-spy-identity.test.ts`、`tests/use-toc-source-mode-navigation.test.ts` 钉住。**2026-09-19 起，源码模式的滚动高亮回来了**：在源码（CodeMirror）里上下滚，大纲高亮跟着内容走；此前只有点击能移动高亮，滚动完全不动。**这不是新坏的，是从 `4570de3`（`feat(editor): cut ViewMode from 4 to 2`）起就死的**——那次砍掉了预览面，而预览面是当时唯一给 IntersectionObserver 提供真实 `h1`–`h6` 元素的面，于是 spy 被关掉、而不是改嫁到 CodeMirror 上；本行此前不加模式限定地宣称「滚动时当前标题自动高亮」，在源码模式下整整错了这么久。`App.tsx` 里那句 `viewMode !== "source"` 的总开关已删除，改由 `src/utils/tocSpyMode.ts` 的 `resolveSpyMode` 按 `viewMode` 分派：WYSIWYG 仍走 IntersectionObserver（逐字搬进 `src/hooks/useWysiwygScrollSpy.ts`，行为未变），源码走按行采样（`src/hooks/useSourceScrollSpy.ts`）——取滚动面顶端往下 40px 那个锚点落在第几行，再选出「行号 ≤ 锚点行」里最后一条标题（纯逻辑在 `src/utils/tocLineSpy.ts`，唯一读 CodeMirror 几何的地方收在 `src/utils/codemirrorViewportLine.ts`，滚动监听用 requestAnimationFrame 节流、每帧至多一次写入，日志只在挂载与卸载各记一条，不按帧刷）。两种模式任何时刻只有一套机制在跑，来回切模式不留下另一套的监听器或 observer。**锚点上方还没有标题时保留上一条高亮、不闪空**，与 WYSIWYG `rootMargin: -66%` 是同一个意思（跨模式手感一致，规则 30）；同名标题按行号各走各的。**第四条限制：两种模式换高亮的那条线不在同一个位置。** WYSIWYG 要等标题降到视口 33% 处才换（`rootMargin: "0px 0px -66% 0px"`），源码在标题升到顶端下方 40px（800px 高的面板上约 5%）就换，于是源码的高亮可能比 WYSIWYG 早一条，差值最大可达约 29% 面板高度的滚动量；在文档中途切换模式，高亮会可见地跳一条。**这个差值与滚动方向无关——上滚与下滚绕同一个锚点对称。** 本行此前写「向上滚时这个差距更大」，那不是阈值差异，是一个真实缺陷：`retainVisibleActiveKey` 的保留规则每帧都跑，而不是只在文末夹紧时跑，于是向上滚时已激活的标题落到锚点下方却仍在屏幕内，就被整整一屏地粘住不放。2026-09-20 由 GUI 实测发现并修掉（把保留收窄到「滚动面确实到底」才生效，见 [ADR-0017](adr/0017-source-scroll-spy-bottom-of-document-asymmetry.md)）。余下的差值是有意接受的代价而非疏漏：那 40px 必须与点击跳转用的 `yMargin` 相等，否则点一条标题会被自己的滚动立刻把高亮甩到别处。**第五条限制：滚到文档最底部时，高亮停在倒数第二条标题，最后一条要点一下才亮。** 因为文档到底了，锚点再也升不到最后一条标题那一行。三条要求无法同时成立——选择只取决于视口几何、滚到底必然选中最后一条、点倒数第二条能保住它（而它的落点正是同一个「到底」位置）——同样的几何不可能给出两个答案，除非再引入额外状态。接受的取舍是：普通滚动选锚点所在的那一节，而**明确点过的、仍在屏幕内的标题，在夹紧的落点上保得住**（[ADR-0017](adr/0017-source-scroll-spy-bottom-of-document-asymmetry.md)）。由 `tests/use-toc-source-scroll-spy.test.ts`（T-1…T-11，其中 T-1 是在修复前必红的回归用例，T-11 钉住「点住的文末标题挺过自己的滚动、上滚越过容差后才放开」）、`tests/toc-line-spy.test.ts`、`tests/codemirror-viewport-line.test.ts`、`tests/toc-spy-mode-routing.test.ts`、`tests/use-source-scroll-spy.test.ts`（H-18 是方向性缺陷的回归用例，H-19 钉住「钩子只服从几何缝隙给出的布尔值、不自己再算一个」）钉住 |
| 切换侧栏 | Shipped | `src/App.tsx` | ⌘⇧L 或 View → Toggle Sidebar（`menu.view.toggle_sidebar`）收起 / 展开左侧面板，重启后保持上次状态 |
| 底部标签条 | Shipped | `src/components/BottomTabs/BottomTabs.tsx` | 底部有 `+` 新建、每个文档一个标签（整条标签条就是 `documentStore` 的投影），脏文档带圆点，悬停出 `×`，鼠标悬停显示完整路径，标签多了可横向滚动 |
| 视图模式切换 | Shipped | `src/stores/editorStore.ts`, `src/components/Editor/Editor.tsx` | ⌘/（`menu.view.cycle`）在 WYSIWYG 与源码之间来回切；⌃2 / ⌃4 直达，焦点在 CodeMirror 里时也生效 |
| 模式徽标 | Shipped | `src/components/Sidebar/index.tsx` | 左上红绿灯旁边显示当前是 WYSIWYG 还是 Source，切换时跟着变 |
| Toast 通知 | Partial | `src/components/common/Toast.tsx`, `src/stores/toastStore.ts`, `src/App.tsx` | 限制：关闭按钮只在传了 `onClose` 时渲染，而 `App.tsx` 从不传，所以 toast 无法手动关掉。⌘S 弹出的提示上找不到 `×`，只能等 3 秒自动消失；连续触发时是替换而不是堆叠 |
| 加载指示 | Shipped | `src/components/common/LoadingSpinner.tsx` | 打开一个较大的文件时出现「Opening file…」；导出时是「Exporting HTML…」 |
| 窗口拖拽区 | Shipped | `src/App.tsx` | 按住窗口顶部空白条拖动，整个窗口跟着走（标题栏是无边框 overlay 样式） |
| 字数统计 | Absent | — | 窗口里找不到任何位置显示字数或字符数，没有状态栏。`wordCount` / `word_count` / `charCount` 在 `src/` 与 `src-tauri/src/` 下零命中。Part 2 的十个对照物**无一例外**都有这一项 |
| 文档内导航 | Absent | — | 点一个 `./other.md` 链接或 `#fragment` 锚点，什么都不会发生——当前是惰性的。ADR-0002 |
| 双向链接与反向链接 | Absent | — | 写 `[[note]]` 不会成为链接，也没有反向链接面板 |
| 标签 | Absent | — | 写 `#tag` 只是普通文本，没有标签面板也不能按标签筛选 |
| 全局 / 跨文件搜索 | Absent | — | ⌘F 只在当前文档里搜；没有任何跨文件搜索入口 |
| 文件树 / vault | Absent | — | 侧栏只有大纲，没有文件夹浏览器；无法打开一个目录作为工作区 |
| 命令面板 | Absent | — | ⌘⇧P / ⌘P 都没有反应，没有可搜索的命令列表 |
| 演示模式 | Absent | — | 没有把文档投成幻灯片的入口，`---` 不会被当作分页符 |

### 主题与排版

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 浅色 / 深色 / 跟随系统 | Shipped | `src-tauri/src/menu.rs` | Theme 菜单里三选一（`menu.theme.light` / `menu.theme.dark` / `menu.theme.system`），选择落进 `themeStore`，界面立刻切换 |
| 跟随系统主题变化 | Shipped | `src/hooks/useTheme.ts` | 主题设为 System，在 macOS 系统设置里切换外观，mdpro 不用重启就跟着变；启动时的初值来自 `get_system_theme` |
| 编辑器字体 | Shipped | `src/components/common/settings/EditorSettings.tsx` | ⌘, → Editor 里在 System Default / Serif / Monospace 之间切换，正文字形当场变 |
| 字号 | Shipped | `src/components/common/settings/SettingsStepper.tsx` | ⌘, → Editor 里用 ± 调字号，范围钳在 8–72px，停手后才写盘 |
| 行高 | Shipped | `src/components/common/settings/EditorSettings.tsx` | ⌘, → Editor 里在 1.2 / 1.4 / 1.6 / 1.8 / 2.0 之间切，行距当场变 |
| 内容宽度 | Shipped | `src/components/common/settings/EditorSettings.tsx` | ⌘, → Editor 里在 Narrow 600px / Medium 780px / Wide 900px / Full 之间切，正文栏宽当场变 |
| 自定义主题 CSS | Absent | — | ⌘, → Appearance 只给 default / oneDark 两个**代码**主题，没有任何加载用户 CSS 的入口，也没有主题文件夹。`customCss` / `userStylesheet` 一类标识符全仓库零命中。界面配色由 `.theme-light` / `.theme-dark` 两套内置 token 决定，改不了 |
| 界面本地化 | Absent | — | 界面文案全是硬编码英文（「Discard changes」「Opening file…」），没有语言设置项。`i18n` / `useTranslation` / locale 相关基础设施一律不存在——这不是「还差几个翻译文件」，是这条路还没开 |
| RTL / 竖排书写 | Unknown | `src/components/Editor/MilkdownEditor.tsx`, `src/components/Editor/Editor.tsx` | 继承自 webview 与 CodeMirror/ProseMirror，此处从未测过，不要声称它能用。要判断请自己粘一段阿拉伯语或希伯来语进两种模式实测 |

### MCP 集成

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| MCP 服务开关 | Shipped | `src/components/common/IntegrationsSettings.tsx` | ⌘, → Integrations 里打开开关（默认关），旁边出现运行中的标记（状态轮询 `mcp_get_status`） |
| 启动时自动运行 | Shipped | `src/components/common/IntegrationsSettings.tsx` | 勾上之后重启 mdpro，不用手动开服务已经在跑 |
| 自动批准 AI 编辑 | Shipped | `src/components/common/IntegrationsSettings.tsx` | 勾上之后外部写入不再弹确认框，直接落到编辑器 |
| 四个 MCP 工具 | Shipped | `src-tauri/src/bin/mdpro_mcp.rs` | 在 Claude Desktop 里连上后列出工具，恰好是 get_open_documents、read_document、write_document、insert_content 四个，分别打到 `/api/documents`、`/api/documents/{id}`（GET / POST）与 `/api/documents/{id}/insert` |
| HTTP 表格端点 | Partial | `src-tauri/src/services/http_server.rs`, `src-tauri/src/bin/mdpro_mcp.rs` | 限制：只有 HTTP 端点，`mdpro_mcp.rs` 只注册了 4 个工具，任何 AI 客户端都无法通过 MCP 走到表格操作。用 curl 带 token 打 `/api/v1/insert_table`、`/api/v1/set_cell`、`/api/v1/add_row`、`/api/v1/delete_row`、`/api/v1/add_column`、`/api/v1/delete_column` 都能成功，但在 AI 客户端的工具列表里找不到任何表格工具 |
| 影子存储同步 | Shipped | `src-tauri/src/services/shadow_store.rs`, `src/hooks/useMcpSync.ts` | 改几个字不保存，前端 300ms 防抖地调 `mcp_sync_documents` 推一次，推完之后外部客户端 read_document 读到的是编辑器里的最新内容而不是磁盘上的旧内容。是最终一致不是即时一致：内容同步带 300ms 防抖（开 / 关 / 切文档才是立即推），在这个窗口里读到的仍是上一份快照。要确认就等这次同步落定后再读，别在敲完键的那一刻读 |
| 写入确认对话框 | Shipped | `src-tauri/src/services/http_server.rs` | 把 mdpro 切到后台，让外部客户端调 write_document，弹出原生 Yes / No 确认 |
| 客户端配置安装器 | Shipped | `src-tauri/src/commands/mcp.rs` | ⌘, → Integrations 里对 Claude Desktop / Claude Code / Codex CLI / Gemini CLI 点 Install（`mcp_install_config`），对应客户端的配置文件被写好；已安装状态由 `mcp_get_installations` 列出，再点 Remove（`mcp_remove_config`）能撤销 |
| 连接测试与端口复制 | Shipped | `src/components/common/IntegrationsSettings.tsx` | 点「Test Connection」得到结果；点复制按钮拿到 `localhost:<port>` |
| 令牌与来源校验 | Shipped | `src-tauri/src/services/http_server.rs` | 不带 token 直接 curl `/api/status` 被拒；带上正确 token 才返回 |
| 通过 HTTP 新建文档 | Partial | `src-tauri/src/services/http_server.rs`, `src/hooks/useMcpEvents.ts` | 限制：只有 `/api/documents/new` 这个 HTTP 端点，`mdpro_mcp.rs` 注册的四个工具里没有它，AI 客户端经 MCP 调不到。用 curl 带 token 打 `/api/documents/new`，mdpro 里确实会多出一个新文档 |
| MCP 服务器信息查询 | Partial | `src-tauri/src/commands/mcp.rs` | 限制：`mcp_get_server_info` 注册着，但 `src/` 与 `tests/` 里零调用点——设置页的端口、token 与运行状态全部来自 `mcp_get_status`。它不是坏的，是没人接 |

### 日志与诊断

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 结构化 JSONL 日志 | Shipped | `src-tauri/src/services/logger.rs`, `src/services/loggingService.ts` | 跑 `tail -f ~/.mdpro/mdpro.log \| jq .`，然后在 app 里 ⌘O 打开一个文件，能看到一条 `file.open` 事件；前端每条都经 `log_event` 落盘 |
| 日志开关 | Shipped | `src/components/common/settings/AdvancedSettings.tsx` | ⌘, → Advanced 里关掉日志（读写走 `get_logging_settings` / `set_logging_settings`，前端状态在 `loggingStore`），再操作几下，日志文件不再增长 |
| 日志级别 | Shipped | `src/components/common/settings/AdvancedSettings.tsx` | ⌘, → Advanced 里把级别设为 Error，Debug / Info 级别的事件不再写入 |
| DevTools | Shipped | `src-tauri/tauri.conf.json` | 在打包后的正式版里也能右键打开 Web Inspector，不只是 dev 构建 |

### 偏好设置

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 设置对话框 | Shipped | `src/components/common/SettingsDialog.tsx` | ⌘, 或 mdpro → Preferences（`menu.file.preferences`）打开，进来时用 `get_preferences` 拉一次，左侧十个分页；Tab 焦点被困在对话框内，Esc 或点遮罩关闭 |
| 快捷键改键 | Partial | `src/components/common/settings/KeyboardShortcutsSettings.tsx`, `src/hooks/useKeyboardShortcuts.ts`, `src-tauri/src/models/preferences.rs` | 限制：57 个可配置动作里 33 个与真实行为脱节——17 个完全没有处理器，16 个能用但按键硬编码在别处，改了设置不生效。把「Source」从 ⌃2 改成别的键，⌃2 照旧生效、新键没反应（硬编码在 `menu.rs`）；把 fileSaveAs 改成任何键也一样毫无反应（根本没有处理器） |
| 默认视图模式 | Shipped | `src/components/common/settings/GeneralSettings.tsx` | ⌘, → General 里设成 Source，之后 ⌘N 新建的文档直接是源码模式 |
| 自动保存间隔 | Shipped | `src/components/common/settings/GeneralSettings.tsx` | ⌘, → General 里在 Off / 30s / 1min / 2min / 5min 之间选；设成 Off 后草稿不再自动写 |
| 图片目录与外链复制 | Shipped | `src/components/common/settings/ImageSettings.tsx` | ⌘, → Images 里把资源目录从 `./assets` 改成 `./img`，再粘一张图，文件落在新目录；勾着「复制外部图片」时，引用到文档目录之外的图片会由 `copy_external_image` 复制进来 |
| 偏好写入的原子性 | Shipped | `src-tauri/src/services/preferences.rs` | 快速连续改多个设置项（每一次都是一轮 `set_preferences`），重启后每一项都保住了，不会有被覆盖丢失的 |
| 图片配置读写命令 | Stub | `src-tauri/src/commands/image.rs` | 函数体是 `// TODO: Load from preferences`，返回默认值。调 `get_image_config` 永远拿到默认值，即使刚在 ⌘, → Images 里改过；`set_image_config` 写进去也没有任何人会读到 |

### 窗口与标签页

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 新建窗口 | Shipped | `src-tauri/src/commands/window.rs` | ⌘⇧N 或 File → New Window（`menu.file.new_window` → `create_window`）开出一个独立的编辑器窗口 |
| 多窗口文档 | Shipped | `src-tauri/src/commands/window.rs`, `src/hooks/useMenuEvents.ts` | 开两个窗口各打开不同文件，视图模式互不影响；菜单里点 ⌘S 只作用于当前聚焦的那个窗口 |
| 全局窗口状态持久化 | Shipped | `src-tauri/src/commands/preferences.rs` | 把窗口拖到某个位置并改大小，退出再启动（关窗前走 `save_window_state`），尺寸、位置、最大化状态都还原 |
| 按文件记忆窗口几何 | Partial | `src-tauri/src/commands/window.rs`, `src/services/windowService.ts` | 限制：只有「写」这一半接上了，「读回来」没有——`windowService.getWindowGeometry` 与它背后的 `get_window_geometry` 在 `src/` 与 `tests/` 里零调用点，没有任何代码在开窗时把存下来的几何还原回去。给 A.md 调一个窗口大小、给 B.md 调另一个，来回打开并不会各自回到自己的尺寸。能确认的只有写入侧：`App.tsx` 在切换 / 关闭时调 `windowService.saveWindowGeometry`，落到 `save_window_geometry`；在 DevTools 里手写 `invoke("get_window_geometry", { filePath })` 能把存下来的那份读出来，证明存是存住了，只是没人用 |
| 原生 Window 菜单 | Shipped | `src-tauri/src/menu.rs` | Window 菜单里有 Minimize（⌘M）、Maximize、Close Window（⌘W） |
| 标签栏配置 `TabBarConfig` | Stub | `src-tauri/src/models/preferences.rs`, `src/types/preferences.ts` | Rust 与 TS 两边都有默认值（位置、最大可见标签数、关闭后的焦点行为），没有 UI、没有消费者，README 却把它当成已交付的可配置功能。翻遍 ⌘, 十个页面都找不到标签栏设置 |
| 标签页进阶能力 | Stub | `src/stores/tabStore.ts`, `src/components/TabBar/TabBar.tsx` | 固定标签、拖拽重排、撤销关闭标签（最近 10 个）、MRU 切换、按标签恢复滚动与光标——`tabStore.ts` 全部实现且有测试，但只被死掉的 `TabBar.tsx` 引用，UI 上到不了。在底部标签条上右键或中键点击都没有固定 / 撤销关闭的入口 |

### 平台集成

| 能力 | 状态 | 在哪 | 怎么确认 |
|---|---|---|---|
| 原生 macOS 菜单栏 | Shipped | `src-tauri/src/menu.rs` | 顶部有 App、File、Edit、View、Format、Theme、Window、Help 八个菜单 |
| 应用菜单基础项 | Shipped | `src-tauri/src/menu.rs` | mdpro 菜单里有 About、Services、Hide（⌘H）、Hide Others、Show All、Quit（⌘Q） |
| 应用内更新检查 | Shipped | `src/components/common/settings/AboutSettings.tsx` | ⌘, → About 里点检查更新，有新版时显示版本说明，下载时有进度条；进度与阶段都在 `updaterStore` 里 |
| 重启应用更新 | Shipped | `src/components/common/settings/AboutSettings.tsx` | 下载完成后弹出「Save and Restart / Don't restart yet」二选一 |
| 重启前保存守卫 | Shipped | `src/hooks/useUpdater.ts` | 留一个未命名的脏文档再点重启，被拦下并提示；把它保存好之后重启才放行 |
| 版本号显示 | Shipped | `src-tauri/src/commands/updater.rs` | ⌘, → About 里显示 `get_app_version` 返回的版本号，与 `tauri.conf.json` 里的一致 |
| 云同步 | Absent | — | 设置里没有任何账号或同步项；文件只在本地。立场 |
| 协作编辑 | Absent | — | 两个人同时开同一个文件不会看到对方的光标或改动。立场 |
| 版本历史 | Absent | — | 没有查看或回滚历史版本的入口（草稿恢复只针对崩溃，不是版本史）。立场 |
| 第三方插件市场 | Absent | — | 设置里没有插件浏览或安装入口；`src/plugins/` 是编辑器内部结构，不对外开放。立场 |
| 移动端 | Absent | — | 没有 iOS / iPadOS 构建目标，只发 macOS 的 .dmg |
| Windows 构建 | Unknown | `scripts/build-windows.sh` | `scripts/build-windows.sh` 在仓库里，但目标平台只声明 macOS 13+ ARM64，从未在此验证。不要据此声称 Windows 可用 |

> **关于「45 个定义、44 个注册」**：核对下来不成立。`src-tauri/src/commands/mod.rs::handlers()` 里注册了 45 个，仓库里带 `#[tauri::command]` 的定义也是 45 个，逐名对齐没有漏网的。数出 44 多半是按逗号数的——`updater::get_app_version` 是最后一项，后面没有逗号；而直接 grep 属性会数出 47，多出的两处在 `src-tauri/src/commands/logging.rs` 的文档注释里。真正该记的不是漏注册，是注册了却没人调用的那四条：`get_draft`、`mcp_get_server_info`、`preview_html`、`export_html`，上面每条都有自己的一行。

---

## Part 2 —— 对照组

| Code | 编辑器 | 为什么它在这里 |
|---|---|---|
| Typ | Typora | 它是"所见即所得 Markdown"这条产品线的原型，用户对 mdpro 的默认期待其实是对它的记忆。 |
| MkT | MarkText | 同架构的开源前辈（Electron + 自研 Muya 引擎），用来回答"一个人做 Typora 替代品，工程上会卡在哪里"。 |
| Obs | Obsidian | 把编辑器扩张成知识库的一极，用它标定 mdpro"不做插件市场、不做双链"这两条否决要付出的代价。 |
| Ztl | Zettlr | 学术写作的一极（引文、Pandoc 管线、多格式导出），用来划清"只导出 HTML"这条边界到底切掉了谁。 |
| iAW | iA Writer | 克制的一极——把"功能少"本身当作卖点，用来检验 mdpro 的删减是设计主张还是尚未补齐。 |
| Bea | Bear | Apple 生态精致一极，也是唯一同样自带第一方 MCP 的对手，它证明"本地笔记 + AI 接口"不是 mdpro 的专利。 |
| Uly | Ulysses | 订阅制长文写作的一极，用目标、看板与发布管线换掉了"文件就是文件"这个前提。 |
| VSC | VS Code + Markdown Preview Enhanced | 开发者的事实默认值，用来回答"程序员为什么根本不装专门的 Markdown 编辑器"。 |
| Log | Logseq | 块结构/大纲的一极，同时是一个活体教训：一个承诺纯本地 Markdown 的产品如何在 2026 年被 SQLite 重写。 |
| Not | Notion | 云与协作的对立面，mdpro 的每一条自我约束（本地、无同步、无协作）都是在拒绝它。 |

这十个不是"十个竞品"，而是十条轴：**原型（Typ）、同路人（MkT）、扩张（Obs）、学术（Ztl）、克制（iAW）、精致（Bea）、长文商业化（Uly）、开发者默认（VSC）、结构化（Log）、云端（Not）**。mdpro 在每条轴上都有一个明确的、可以被质问的位置。

---

## Part 3 —— 差距矩阵

图例：`● 有　◐ 部分　○ 没有　◍ 空壳　– 不适用`

> **◍ 空壳**的定义：代码在仓库里，但用户点不到或拿不到结果。mdpro 有三处空壳，全部经仓库核实（见下方"mdpro 列的取证"）。

### 人人都有而 mdpro 没有

| 能力 | mdpro | Typ | MkT | Obs | Ztl | iAW | Bea | Uly | VSC | Log | Not |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 全局搜索 | ○ | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ● |
| 文件树 / 工作区 | ○ | ● | ● | ● | ● | ● | ◐ | ● | ● | ◐ | ● |
| 文件增删重命名 | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 查找与替换 | ◐ | ● | ● | ● | ● | ● | ◐ | ● | ● | ○ | ◐ |
| 字数统计 | ○ | ● | ● | ● | ● | ● | ● | ● | ◐ | ◐ | ◐ |
| 拼写检查 | ◍ | ● | ● | ● | ● | ● | ● | ● | ◐ | ◐ | ● |
| PDF 导出 | ○ | ● | ● | ● | ● | ● | ◐ | ● | ● | ◐ | ◐ |
| 打印 | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| 自定义主题 / CSS | ○ | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ○ |
| 界面本地化（中文界面） | ○ | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ● |

**10 行。** 三个要点：

1. **查找与替换只做了一半。** `src/components/Editor/extensions/search.ts` 挂了 CodeMirror 的 `search({top:true})` + `searchKeymap`（⌘F / ⌘H），但文件里写着 *"WYSIWYG (Milkdown) mode search is out of scope — tracked as a follow-up."* 也就是说：mdpro 主打的那个模式恰恰是搜不了的。
2. **字数统计是零。** 全仓库 `wordCount` / `word_count` / `字数` / `StatusBar` 零命中——不是做得差，是完全没有。这是所有对照组无一例外都有的东西。
3. **一个 Markdown 编辑器打不了印。** `menu.rs` 与全部组件里没有任何 print 路径。

### 有争议 —— 是真功能，但并不普遍

| 能力 | mdpro | Typ | MkT | Obs | Ztl | iAW | Bea | Uly | VSC | Log | Not |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 编辑区数学排版 | ○ | ● | ● | ◐ | ● | ○ | ● | ◐ | ○ | ◐ | ● |
| 编辑区脚注渲染 | ○ | ● | ● | ◐ | ◐ | ○ | ◐ | ◐ | ○ | ○ | ○ |
| Mermaid / 图表 | ◍ | ● | ● | ● | ◐ | ○ | ● | ○ | ● | ◐ | ◐ |
| Word / docx 导出 | ○ | ◐ | ○ | ◐ | ● | ● | ◐ | ● | ◐ | ○ | ○ |
| Wikilink `[[…]]` | ○ | ○ | ○ | ● | ● | ◐ | ● | ◐ | ● | ● | ◐ |
| 标签 | ○ | ○ | ○ | ● | ● | ● | ● | ● | ● | ● | ◐ |
| 反链 / 关系图 | ○ | ○ | ○ | ● | ● | ○ | ◐ | ◐ | ● | ● | ◐ |
| 打字机模式 | ◍ | ● | ● | ◐ | ● | ● | ○ | ● | ◐ | ○ | ○ |
| 专注模式 | ◍ | ● | ● | ◐ | ● | ● | ◐ | ● | ● | ○ | ○ |
| 演示模式 | ○ | ◐ | ○ | ● | ◐ | ○ | ○ | ○ | ● | ● | ● |
| 引文 / BibTeX | ○ | ○ | ○ | ◐ | ● | ○ | ○ | ○ | ◐ | ● | ○ |
| 图床上传 | ○ | ● | ● | ◐ | ○ | ◐ | ○ | ◐ | ● | ○ | ○ |
| 版本历史 | ○ | ◐ | ○ | ● | ○ | ● | ○ | ◐ | ● | ● | ● |
| 云同步（第一方） | ○ | ○ | ○ | ● | ○ | ○ | ◐ | ● | ○ | ◐ | ● |
| 移动端 | ○ | ○ | ○ | ● | ○ | ◐ | ◐ | ◐ | ○ | ● | ● |
| 实时协作 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ○ | ● |
| 插件市场 | ○ | ◐ | ○ | ● | ○ | ○ | ○ | ○ | ● | ● | ◐ |
| Windows / Linux | ○ | ● | ● | ● | ● | ◐ | ○ | ○ | ● | ● | ◐ |
| 纯本地 `.md` 文件 | ● | ● | ● | ● | ● | ● | ○ | ◐ | ● | ● | ○ |
| 多标签页 | ● | ○ | ● | ● | ● | ● | ◐ | ◐ | ● | ◐ | ● |

**20 行。** 五个要点：

1. **数学与脚注是 mdpro 最尴尬的一格。** 语法解析、KaTeX、MathML 导出全部做完了——但 `katex` 在前端只被 `src/services/exportService.ts` 一个文件引用。也就是说：**mdpro 能把 `$E=mc^2$` 导出成 MathML，却不能让你在编辑时看见它。** 对一个以 Typora 体验为卖点的产品，这一格的对照组是 Typ ● / MkT ● / Ztl ● / Bea ●。
2. **Mermaid 是三处空壳中最有误导性的一处。** `markdown.rs` 的 `SVG_TAGS` 白名单与 `sanitizerPolicy.ts` 都专门为 Mermaid 内联 SVG 留了口子，还有 `test_sanitize_preserves_mermaid_svg` 这样的测试——但 `package.json` 里**根本没有 mermaid 依赖**。净化器为一个不存在的渲染器守了门。
3. **打字机模式与专注模式同理。** `focusModePlugin.ts`（75 行）和 `typewriterModePlugin.ts`（44 行）是真实现且已在 `plugins/index.ts` 注册，但 `pluginConfig.ts` 里两者都是 `enabled: false`，而 `src/components`、`src/hooks`、`src-tauri` 中**没有任何开关**。用户永远打不开它们。
4. **`[[wikilink]]` + 标签 + 反链这一组，Typ 和 MkT 也全是 ○。** 这说明"不做双链"不是 mdpro 的短板，而是它站在 Typora 那条线上的必然结果——真正的分界在 Obs/Ztl/Log 那一侧。这一组值得作为"明确不做"写进 ADR，而不是留在 backlog 里。
5. **mdpro 在最后两行是赢的**：纯本地文件（Bea 是 SQLite，Not 是云数据库，Uly 是专有库）和多标签页（**Typora 至今没有标签页**，这个诉求从 2016 年挂到现在）。

### mdpro 有而多数没有

| 能力 | mdpro | Typ | MkT | Obs | Ztl | iAW | Bea | Uly | VSC | Log | Not |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 第一方 MCP server | ● | ○ | ○ | ◐ | ○ | ○ | ● | ○ | ◐ | ◐ | ● |
| AI 直写"正在编辑"的文档 | ● | ○ | ○ | ◐ | ○ | ○ | ◐ | ○ | ◐ | ○ | ◐ |
| 源码模式下的表格 CRUD | ● | ○ | ○ | ○ | ◐ | ◐ | – | – | ◐ | ○ | – |
| 图片拖拽缩放写回 Markdown | ● | ◐ | ○ | ◐ | ◐ | ○ | ◐ | ○ | ○ | ◐ | ◐ |
| 结构化 JSONL 日志 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ○ | ○ |
| Rust 白名单净化的 HTML 导出 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | – |
| 非 Electron 原生外壳 | ● | ○ | ○ | ○ | ○ | ● | ● | ● | ○ | ○ | ○ |
| UTF-16 编码检测与往返保真 | ● | ◐ | ◐ | ○ | ○ | ○ | – | – | ● | ○ | – |

**8 行。** 三个要点：

1. **MCP 不再是独家，但"写进活的编辑缓冲区"仍然是。** Bear 2.8（2026-04-29）已经有一键安装的 Claude Connector 和 `bearcli mcp-server`，Notion 有官方云端 `mcp.notion.com`。但两者都是**对着存储层说话**（Bear 是 SQLite 库，Notion 是云页面）；mdpro 的 `mcp:write_document` / `mcp:insert_content` / `mcp:table_action` 是 Rust 事件打到前端、落进用户此刻正在打字的编辑器里。**这是 mdpro 唯一真正没有对手的一格，账簿的叙事应该压在这里，而不是压在"我们也有 MCP"。**
2. **源码模式的表格 CRUD 是个被低估的差异点。** 几乎所有对手的表格 UI 只存在于富文本面：Typora 的源码模式是裸文本，Obsidian 的表格菜单在 Live Preview。mdpro 在 CodeMirror 侧也有 `SourceTableContextMenu` + `lintTableColumnCount` + `sourceTableDetection`。
3. **后三行是"工程姿态"而非功能**，写进账簿时要标明它们的说服对象是自己和维护者，不是用户：JSONL 日志、Rust 端 HTML 白名单净化、UTF-16 往返保真（`encoding.rs` 对奇数字节长度显式报错而不是静默吞掉）。它们换不来一个新用户，但它们是"这个产品不会悄悄弄坏你的文件"的唯一证据。

---

## mdpro 列的取证

mdpro 这一列**全部来自仓库核实**，不是回忆。关键命中：

| 格 | 判定 | 证据 |
|---|---|---|
| Mermaid | ◍ | `package.json` 无 mermaid 依赖；`src-tauri/src/services/markdown.rs` `SVG_TAGS` 与 `src/services/sanitizerPolicy.ts` 仅为其预留白名单 |
| 拼写检查 | ◍ | `src/plugins/codemirror/spellCheckPlugin.ts` —— `displayName: "Spell Check (Stub)"`，`codemirrorExtension: () => []`，init 里只打一条 `TODO: integrate dictionary backend` |
| 打字机 / 专注模式 | ◍ | 插件已实现并注册（`src/plugins/index.ts`），但 `src/plugins/core/pluginConfig.ts` 中 `enabled: false`，且组件/hooks/Rust 侧零开关 |
| 编辑区数学 | ○ | `katex` 仅被 `src/services/exportService.ts` 引用（经 `src/services/mathRender.ts`）；导出面之外无排版 |
| 查找与替换 | ◐ | `src/components/Editor/extensions/search.ts` 仅挂在 `Editor.tsx`（CodeMirror）；注释明写 WYSIWYG 搜索 out of scope |
| 字数统计 | ○ | `wordCount` / `word_count` / `charCount` / `StatusBar` / `字数` 全仓库零命中 |
| 打印 | ○ | `menu.rs` 及全部组件无 print 路径（唯一命中是 `MarkdownSettings.tsx` 的 "Pretty-print GFM tables"，不相关） |
| 文件树 / 工作区 | ○ | `src/components/Sidebar/` 只有 `FileItem` / `Sidebar` / `TOCSidebar`；`App.tsx` 的 `workspace` 只是 CSS 类名 |
| 界面本地化 | ○ | 无 i18n / locale / useTranslation 任何基础设施 |
| 自定义主题 CSS | ○ | `AppearanceSettings.tsx` 仅暴露 `CODE_THEMES = ["default","oneDark"]`，无用户 CSS 加载路径 |
| 快捷键自定义 | ●（未入表） | `KeyboardShortcutsSettings.tsx`（10.4K），File/Edit 等分组可改 |
| 任务列表 | ●（未入表） | Milkdown `gfm` preset + Rust `Options::ENABLE_TASKLISTS` |
| MCP 工具 | ● | `src-tauri/src/bin/mdpro_mcp.rs`（`read_document` / `write_document` / `insert_content` / `get_open_documents`）+ `services/http_server.rs`（45K，含 create_document 与表格工具） |
| UTF-16 | ● | `src-tauri/src/services/encoding.rs` 对 BOM 与奇数字节长度显式处理并报错，注释点名"避免保存时固化损坏" |

---

## 来源

全部核查于 **2026-09-17**。以下每个对照组列出本次实际抓取的代表性 URL（三组并行研究共抓取约 150 个页面，此处按产品收敛到主要来源）。

### Typ —— Typora
`typora.io/` · `/releases/stable.html` · `/releases/all` · `support.typora.io/`（含 `/Math/`、`/Search/`、`/File-Management/`、`/Export/`、`/Spellcheck/`、`/Word-Count/`、`/Draw-Diagrams-With-Markdown/`、`/Focus-and-Typewriter-Mode/`、`/Upload-Image/`、`/Auto-Save/`、`/Version-Control/`、`/Table-Editing/`、`/Outline/`、`/Dark-Mode/`、`/Sync/`、`/Markdown-Reference/`、`/Shortcut-Keys/`、`/purchase/`、`/Install-and-Use-Pandoc/`）· `github.com/typora/typora-issues/issues/6578`
**状态：在维护。** 稳定版 1.14.10；1.14 系列官方标注 2026-07-19。$14.99 买断，闭源。

### MkT —— MarkText　⚠️ 必读
`api.github.com/repos/marktext/marktext`（含 `/releases`、`/releases/latest`、`/commits`、`/contents/...`、`/search/code`、`/search/issues`）· `raw.githubusercontent.com/marktext/marktext/develop/packages/website/content/docs/end-user/{EDITING,MARKDOWN_SYNTAX,EXPORT,PREFERENCES,BASICS,IMAGE_UPLOADER_CONFIGRATION}.md` · `www.marktext.me`

**MarkText 没有停止维护——这与流传的说法相反，必须在账簿里写清楚。**

- 最新稳定版 **v0.19.1，2026-06-06**；预发布 **v0.20.0-rc.3，2026-09-15**；最后一次 push **2026-09-16**（核查前一天）。`archived: false`。
- 但它确实**沉寂过四年**：v0.17.1 停在 2022-03-07，直到 2026-05-28 的 v0.19.0 才复活（从无 v0.18）。复活带来了 TypeScript 迁移、渲染进程沙箱化、Windows ARM64，仓库已改为 monorepo。
- 因此"同架构开源前辈"这个定位成立，且指向的是一个**刚刚证明自己能复活**的项目，而不是一具尸体。MIT，61.5k star，免费。
- 小出入：官网仍标 v0.19.0，GitHub 稳定版已是 v0.19.1。
- **取证方式偏软的地方**：MarkText 大量能力格是从**应用自身的偏好项 schema 与 `packages/desktop/static/locales/en.json` 文案**反推的（属一手来源，但只证明"设置项/字符串存在"，不证明功能质量）。其"自动保存"默认是关的。

### Obs —— Obsidian
`obsidian.md/`（`/pricing`、`/license`、`/changelog/page/5`、`/help/` 及 `edit-and-read`、`plugins`、`syntax`、`advanced-syntax`、`plugins/search`、`plugins/file-recovery`、`plugins/footnotes`、`settings`、`hotkeys`、`data-storage`、`tags`、`tabs`、`attachments`、`mobile`、`sync/version-history`）· `community.obsidian.md/`（插件 7,707 / 主题 761）· `forum.obsidian.md` 帖 28416、45388
注意 `help.obsidian.md` 已 301 跳转到 `obsidian.md/help/`。

### Ztl —— Zettlr
`zettlr.com/`、`/download`、`/changelog` · `docs.zettlr.com/en/` 下 `file-manager/search`、`editor/{appearance,search,footnotes,statusbar,tables,autocomplete}`、`reference/{settings,keyboard-shortcuts,faq}`、`pkms/{zkn-method,graph}`、`scientific-technical/{math,mermaid}`、`export/{workflow,defaults-files,pdf-engine}`、`guides/{presentations,reference-manager-integration}`、`language-style/spellchecking` · `api.github.com/repos/Zettlr/Zettlr`
**状态：活跃。** v4.7.0，2026-07-26，月度小版本。GPL-3.0，免费。
**更正一条流传的错误信息**：聚合站 `noteapps.info` 称 Zettlr 内置 MCP server——已证伪。仓库内 `MCP` 与 `"Model Context Protocol"` 的 issue/PR 搜索均为 `total_count: 0`，4.7.0 release notes 与官方 changelog 亦无任何提及。Zettlr 唯一的写作辅助是 LanguageTool。**不要把这条写进账簿。**

### iAW —— iA Writer
`ia.net/writer`、`/writer/pricing`、`/writer/how-to/quick-tour` · `ia.net/support/` 下 `basics/{features,markdown-guide,shortcuts,settings,faq}`、`library/{navigation,organize,wikilinks,cloud-storage,content-blocks}`、`editor/{stats,authorship,smart-automation}`、`preview/{export-share-print,blog}`、`help/{versions-and-backups,trouble-shooting}`
注：`/support/editor/focus-mode` 返回 HTTP 409，未能抓取；`ulysses.app/features/` 404。买断制（Mac $49.99 / Win $29.99 / iOS $49.99），官网明写不提供订阅。

### Bea —— Bear
`bear.app/` + `/faq/` 下约 25 个条目（`features-and-price-of-bear-pro`、`whats-new-in-bear-2`、`where-are-bears-notes-located`、`export-your-notes`、`command-line-interface`、`how-to-write-math-formulas-in-bear`、`how-to-add-mermaid-diagrams-in-bear`、`how-to-use-footnotes-in-bear`、`backup-restore`、`how-to-use-tables-in-bear` 等）· `blog.bear.app/2026/04/bear-2-8-bearcli-claude-connector-and-mcp-server/`
**对本账簿最关键的一条**：Bear 2.8（2026-04-29）已提供 BearCLI、`Help → Advanced → Install Claude Connector` 一键安装、以及 `bearcli mcp-server`（macOS 限定，不受 Pro 限制）。**mdpro 不能再宣称"唯一带 MCP 的 Markdown 编辑器"。** 另：Bear 的存储是 SQLite 而非 `.md` 文件，官方文档明确劝阻第三方直接访问；查找替换、PDF/docx 导出、同步均被 Pro 订阅门控。

### Uly —— Ulysses
`ulysses.app/`、`/pricing/`、`/release-notes/` · `help.ulysses.app` 下 `faqs`、`keywords`、`the-library/{external-folders,backups}`、`dive-into-editing/{markdown-xl,writing-equations,tables-in-ulysses,images-and-sketches,editor-customization-guide}`、`the-dashboard/dashboard`、`editor/how-can-i-create-internal-links`、`export-publishing/export`
**两条语法假设需要更正**：Ulysses 的高亮语法是 `::mark::` 而**不是** `==highlight==`（本次二次核实确认）；数学用的是 `$$` 标记触发公式编辑器，而非裸 `$…$` 分隔符。它的库是专有格式，External Folders 虽然是真 `.md`，但代价是**没有嵌入图片、没有批注、且不进备份**。

### VSC —— VS Code + Markdown Preview Enhanced
`code.visualstudio.com/docs/` 下 `languages/markdown`、`editing/codebasics`、`editing/workspaces/workspaces`、`copilot/chat/mcp-servers` 等 · `raw.githubusercontent.com/shd101wyy/markdown-preview-enhanced/master/docs/*.md` · `github.com/shd101wyy/vscode-markdown-preview-enhanced`（+ `/releases`、API `/commits`）· `api.github.com/repos/shd101wyy/crossnote` · marketplace 条目若干
**一个容易踩的坑**：人人引用的 `shd101wyy/markdown-preview-enhanced` 现在只是文档仓库，其 GitHub Releases **停在 2015 年的 0.3.7**，`package.json` 还写着 "for Atom editor"。真正在跑的是 `shd101wyy/vscode-markdown-preview-enhanced` —— 最后提交 **2026-09-16**，版本 **0.8.35（2026-09-08）**，约 1,029 万次安装。**MPE 非常活跃**；从前一个仓库判断维护状态会得出完全相反的错误结论。黄旗：1,419 个未关闭 issue，近期版本多为安全加固（命令注入、WaveDrom 任意代码执行）。

### Log —— Logseq　⚠️ 这一列本身就是有问题的
`logseq.com/`、`logseq.io/p/e3YDyX5AYr` · `api.github.com/repos/logseq/logseq`（+ `/releases`、`/commits`）· `api.github.com/repos/logseq/og` · `raw.githubusercontent.com/logseq/docs/master/db-version.md` 及 `pages/{Features,Search,Export,Markdown,Math Block,Tables,Keyboard shortcuts,Graph Overview,Git Auto-Commit,Logseq Sync}.md` · `discuss.logseq.com` 多个官方公告与线程 · `github.com/logseq/marketplace` · `opencollective.com/logseq`

**Logseq 在 2026-04-24 分裂成了两个产品**，所以"一列 Logseq"是一个便利的虚构：

- **Logseq OG**：纯本地 `.md` 文件版，现处于**维护模式**（只做安全补丁与 Electron 升级）。最后一个非 beta 稳定版是 0.10.15（2025-12-01）。
- **Logseq 2.0**：SQLite 存储，继承了产品名与路线图，2026-07-13 作为**公测 beta** 发布（官方自述"early beta… data loss is possible"），至今没有 GA。它有第一方 MCP，但只有 65 个插件完成移植，Markdown Mirror 是**单向 DB→磁盘**。

**本账簿的 Log 列采用的是 OG（文件版）**，因为账簿比较的是本地 Markdown 编辑器。如果对照 2.0，`纯本地 .md 文件`、`外部改动检测`、`插件市场`、`第一方 MCP` 四行都会改变。

### Not —— Notion
`notion.com/`：`pricing`、`desktop`、`integrations`、`product/ai`、`releases/2026-05-26`，以及 `help/` 下 `export-your-content`、`search`、`keyboard-shortcuts`、`math-equations`、`writing-and-editing-basics`、`create-links-and-backlinks`、`tables`、`presentation-mode`、`notion-for-desktop`、`system-requirements-for-notion` 等 · `developers.notion.com/docs/mcp` 与 `/guides/mcp/*` · `github.com/makenotion/notion-mcp-server`
两条时效性提醒：**Notion 的工作区级 PDF 导出正在下线**（官方文档说明"在 2026-08-31 前逐步移除"，即核查日前 17 天），单页 PDF 与 Business/Enterprise 的 `Include subpages` 保留；官方明确表示**没有 Linux 客户端**。另有多个帮助页（`page-history`、`version-history`、`mobile`、`simple-tables`）返回 404。

---

### 最软的几列 —— 请按这个顺序打折扣

按"本次是否真的读到了一手来源"排序，**从软到硬**：

1. **Log（Logseq）—— 最软，而且软在结构上。** 它不是一个产品而是两个，本表选了已冻结的那一个。凡是涉及存储、插件、MCP、外部改动的格，换成 2.0 都会翻转。另外它的多个 ○（打字机模式、专注模式、图床、内置 TOC）是从一份 150+ 条的快捷键配置里**没找到**推出来的，属于"证据缺失"而非"厂商否认"。官方文档内部还存在直接冲突（`db-version.md` 说 DB 版无法维持 Markdown 镜像，同一天的论坛公告却宣布 Markdown Mirror 上线）。
2. **Not（Notion）—— 次软。** 它离"Markdown 编辑器"最远，很多行本该是 `–` 而被迫给了 ○/◐。它的 ○（查找替换、脚注、PlantUML、关系图、打字机、专注、原生引文、`==` 语法）**全部是证据缺失**，没有一条是官方明确否认；帮助中心还有若干 404 页面，检索覆盖不完整。
3. **iAW 与 Uly —— 并列第三。** 两者的 `外部改动检测` 与 `剪贴板粘贴图片` **本次完全没有一手来源**（我按最接近的行为给了值，但这两格应视为未核实）；iA Writer 的 focus mode 页面返回 409 抓不到，其 Android 版停更只有第三方来源（Thurrott），而 ia.net 上仍挂着过期的 Android 页面。Ulysses 的 `::mark::` 是二次核实才找对页面的——第一次按 `==highlight==` 去找会得出错误结论。
4. **Typ（Typora）—— 闭源带来的软。** `外部改动检测` 仅来自 issue #6578，**官方从未记载**，且 tracker 里对其可靠性有争议；1.14.10 的发布日期只有第三方站点（warp2search.net）有，官方发布页只列版本号不列日期，下载页文件名甚至还停在 1.14.9。
5. **VSC —— 软在定义而非取证。** "VS Code + MPE"这一列的评分取决于你允许装几个扩展。本表只计**核心 + MPE**，凡是需要第三方扩展才有的（字数统计、拼写检查、打字机模式）一律给 ◐ 而非 ●。换一套扩展清单，这一列可以几乎全绿。
6. **Obs、Ztl、MkT、Bea —— 相对最硬**，但各有一处弱点：Obsidian 的查找替换只有官方论坛的员工帖、PDF 导出只有 changelog（两者都没有帮助页），其 Live Preview 下的数学/脚注行为靠论坛帖（其中一条还是功能请求）；Zettlr 的 `打字机模式` 是从**源码**（`menu.darwin.ts`）确认的而非 v4 文档，且其 `==高亮==` 只确认了语法与导出开关、**未确认编辑器内的视觉渲染**，`编辑区数学排版` 的 ● 也夸大了默认状态（预渲染器需手动开启）；MarkText 见上文（偏好 schema 反推）；Bear 的脚注渲染样式与 math/Mermaid 是否受 Pro 门控，文档未明说。

### 完全来自一般认知、本次没有逐个核实的**行**（不是列）

这四行请单独打折，它们是横跨所有对照组的常识性判断，不是本次抓取的结论：

- **`打印`**（表 1）—— 只有 MarkText 的"PDF + HTML + print"有明确来源。其余九列按"桌面/Web 应用普遍具备打印"给 ●。mdpro 的 ○ 是仓库核实的。
- **`界面本地化`**（表 1）—— 十列全部来自一般认知。mdpro 的 ○ 是仓库核实的（零 i18n 基础设施）。
- **`结构化 JSONL 日志`**（表 3）—— 对照组的 ○ 是"没有面向用户的结构化日志"这一常识判断，没有逐个查证。
- **`非 Electron 原生外壳`**（表 3）—— 各产品的技术栈来自公开常识（Typora/MarkText/Obsidian/Zettlr/VS Code/Logseq 为 Electron；iA Writer/Bear/Ulysses 为原生 Apple 技术栈；mdpro 为 Tauri + WKWebView），本次未逐个抓取技术声明。

`UTF-16 编码检测与往返保真`（表 3）中，仅 mdpro 与 VS Code 两格有硬证据（前者读源码，后者有文档），其余各格属推断。


---

## Part 4 — 读这张矩阵

### mdpro 不该追的

**云同步、协作编辑、版本历史。** mdpro 的约束写在 `CLAUDE.md` 的第一行：本地文件，仅此而已。这三样每一样都要求一个服务端、一个账号体系和一份账单，换来的是一个本地编辑器不需要的东西。

**PDF / Word 导出。** 被否决过一次，理由是 headless Chromium 的体积（`specs/001-mdpro-mvp/spec.md`）。导出的 HTML 在浏览器里能打印成 PDF——但**这条退路要求用户离开 mdpro**，因为 app 自己也没有打印入口（Part 1 的「打印」行，Absent）。PDF 是一个做过的决定，打印不是；把两者当成同一件事，就是用一条立场掩护一个从没被评估过的缺口。

**第三方插件市场。** `src/plugins/` 这套架构是**编辑器内部的**，不是对外的扩展点。一旦对外，沙箱、版本兼容和审核就全部变成必须品，而它们没有一个能靠一个人维护。

**块编辑器 / Notion 那条路。** mdpro 的文件就是 Markdown 文件，不是一棵块树。这一条不是「还没做」。

**缺席是一个立场，不是一个缺口——前提是它被写下来**，而写下来正是这份账簿的用处。上面每一条在 Part 3 的矩阵里都不占行；它们在这里。

### 需要分清的两类缺席

Part 3 的「人人都有而 mdpro 没有」是**缺口**：对标物几乎都有、mdpro 没有、且没有一个写下来的理由说明为什么不该有。上面这一节是**立场**。把立场混进缺口表里，会让下一个读这张表的人去修一个已经做过决定的东西；反过来把缺口说成立场，则是更贵的那个方向——它让一件没人想过的事看起来像一件想过的事。上面「打印」那一段就是这条线的示范。

### 对外该怎么说 mdpro 独家

**不要再说「mdpro 有 MCP」。** 建账时核到 Bear 2.8 和 Notion 都已经有第一方 MCP（Part 3 第三张表的脚注 1），这句话在 2026 年 9 月已经不成立了。还成立的是**写进用户此刻正在打字的那个缓冲区**——别人的 MCP 对着存储层说话，mdpro 的 `mcp:write_document` 打到前端。这一格今天没有对手。产品文案压在这里，不压在「我们也有 MCP」。

顺带一个反向更正：**Zettlr 没有 MCP**，MarkText 也不是死项目（v0.20.0-rc.3，2026-09-15，沉寂四年后又动了）。任何基于这两条旧印象的结论都要重做。

### 第一顺位缺口

> **现在的第一顺位缺口是：WYSIWYG 模式下 `$…$` 和 `[^1]` 是字面文本。**

理由不是「缺的人最多」。按 Part 3 的三桶分，WYSIWYG 数学**整体上落在「有争议」那一桶**——十个对标物里它并不普遍。选它是因为**桶的划分不看总数，看谁**：在 Typora、MarkText、Zettlr、Bear 这四个**直接对标物**——也就是同样主打「所见即所得地写 Markdown」的那条产品线——上，它是 ●。mdpro 的整个卖点是「Typora 的所见即所得体验」，而在 mdpro 的**主要编辑模式**里，`$…$` 和 `[^1]` 是字面文本。

今天它们只在 Rust 渲染面上排版，也就是只在导出时——`src/services/mathRender.ts` 的唯一 import 方是 `src/services/exportService.ts`，Preview 面板在 stage-2 死代码清理里已经删掉了。这是 Phase 1 明确接受的行为（决策 B3），不是缺陷；但**一个被接受的缺席仍然是一个缺席**，而这一个正对着产品的那句话。这就是它排在第一顺位的全部理由：它不是最大的洞，它是唯一一个让产品的自我描述不成立的洞。

**第一顺位只有一条，但最便宜的一条不是它。** 如果要的是「今天就能让矩阵少一个洞」，那是**字数统计**——十个对标物无一例外都有，mdpro 零代码，且它不碰渲染管线、不碰插件 registry、不碰任何已做过的决定。把它写在这里，是为了不让它在只盯第一顺位的读法里被丢掉。

这是**首次**建账，所以这里还没有被划掉的历史。以后关掉一条，就在它上面加删除线、写上是什么关掉的，保留原地，然后在下面写新的一条——**任何时刻只有一条**。一份给出四色清单的账簿，给不出「下一件事是什么」这一个答案。

### 最有后果的架构发现，但它不是第一顺位

`pluginRegistry.getMilkdownPlugins()` 的调用点是零。registry 只治理 CodeMirror；三个 Milkdown 插件能到编辑器里，只是因为 `src/components/Editor/MilkdownEditor.tsx` 直接 import 了实例本身。后果是**每一个 Milkdown 插件在 `src/plugins/core/pluginConfig.ts` 里的 `enabled` 开关都是装饰品**——`setPluginEnabled("image-paste", false)` 不会关掉图片粘贴——而且 `currentMode` 从不会是 `"milkdown"`，所以没有任何 Milkdown 插件收到过 `init()` 或 `destroy()`。

它排在第一顺位缺口之后，因为它今天不改变任何用户看得见的行为。它排在这里而不是被略过，是因为它让每一条关于 Milkdown 插件的声称都**无法验证**，包括这份账簿里的那些。

---

## 审计 pass

追加，不覆盖。每一段以「这次没有关掉什么」结尾。

### 2026-09-17 —— 首次建账

**范围**：`src/`、`src-tauri/src/`、`tests/`、`docs/plans/`、`docs/adr/`、`specs/` 全量读过一遍，外加十个对标物的公开文档与 release note 逐项核实。产出 Part 1 的 165 行、Part 2 的对照表、Part 3 的三桶矩阵。`pnpm ledger:check` 绿：177 条路径声称全部解析，94 个声明名字全部落进某一行。

**改了什么**：只有这份账簿和 `scripts/ledger/`、`tests/feature-ledger.test.ts`。**一行产品代码都没动**——这是刻意的。查出来的缺陷如实写成 `Stub` / `Partial` / `Absent`，修它们是各自独立的提交，不混进建账这一次。

**这次撞见而值得单拎出来的**：

- **`Stub` 比预想的多，且每一个都有"看起来在工作"的外观。** 另存为有偏好项没有处理器；`get_draft` 注册着、实现着、零调用点；`export_html` 零调用点但**是**一条写下来的决定（ADR-0003）而不是遗留。同样是"没人调用"，第三条不该被清理掉——这个区别只有账簿能保存。
- **Mermaid 是一道守着空房间的门。** 消毒器为它开了整套 SVG 白名单，Rust 侧有一个绿着的 `test_sanitize_preserves_mermaid_svg`，而 `package.json` 里没有 mermaid。**一个绿色测试证明了消毒器的行为，被读成了产品有这个功能。**
- **⌘⇧H 依焦点产生两种语法**，⌃2 下的 ⌘K 走 `window.prompt`（rule 30 §6 明令禁止）。两条都进了 Part 1 的 `Partial` 行并写明限制。
- **一次自我更正。** 建账中途出现过"45 个命令定义、`handlers()` 只注册 44 个"的说法，据此差点写下一条"存在未注册命令"。双向 diff 后交集是满的：那个 44 是数逗号数出来的，`updater::get_app_version` 末尾没有逗号。**错的是计数方法，不是代码**，如实记在这里而不是留下一条虚构的缺口。

**这次没有关掉什么。**

第一顺位缺口（WYSIWYG 数学与脚注）仍然开着。Milkdown registry 空转仍然开着。上面四条里没有一条被修复——它们只是从"没人知道"变成了"写下来了"。本次 pass 唯一交付的东西是**一份可被机器检查的现状描述**，以及一个门禁：从现在起，改变行为的那一次提交要重写它的那一行，否则 `pnpm ledger:check` 不会替你发现，但下一次 pass 会。

同样要写明**这次没有看过什么**：`.github/` 的 CI 配置、`src-tauri/` 的 Rust 依赖树、以及打包产物的实际行为（本次全部结论来自源码与测试，**没有在 `pnpm tauri build` 出的包上逐条手测**）。Part 1 的「怎么确认」那一列是**写给人去执行的步骤**，不是已经执行过的记录。
