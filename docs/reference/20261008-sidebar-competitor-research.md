# Sidebar 竞品最佳实践核查（mdpro）

日期：2026-10-08 · 范围：只读调研，未改动 mdpro 仓库 · 证据见文末附录

## 0. mdpro 现状（作为对照基线）

| 项 | 现状 | 依据 |
|---|---|---|
| 侧栏内容 | 只有大纲（TOC），外加红绿灯拖拽区和 WYSIWYG/SOURCE 徽标 | `src/components/Sidebar/index.tsx`（`TOCSidebarContainer`） |
| 打开的文档 | 底部标签条 BottomTabs，**始终显示**；脏圆点，悬停出 `×`，关脏文档弹 Keep editing / Discard | `src/components/BottomTabs/BottomTabs.tsx`；ledger「底部标签条 Shipped」 |
| 切换 | ⌘⇧L（与 Typora 相同），状态持久化 `showSidebar` | `src/hooks/useSidebarPreference.ts` |
| 宽度 | 固定 `--sidebar-width: 220px`，不能拖拽调整 | `src/styles/globals.css:23,81` |
| 工作区 | 无。文件树 / vault 记为 Absent | `docs/feature-ledger.md` 「文件树 / vault」行 |
| 死代码 | `Sidebar.tsx` + `FileItem.tsx`：「Open Files」竖向列表，内容和 BottomTabs 重复。关闭按钮是文本 `x`，没有 aria-label；脏标记是标题后缀 ` *`，和 BottomTabs 的圆点不一致；没有键盘导航，也没有 listbox 角色 | 源码；计划 P A8 |
| 死代码的牵连 | `index.tsx` 里 `export { Sidebar }`；`tests/discard-dialog-focus-wiring.test.tsx` 的 DW-2 仍渲染它；`globals.css:130-190` 的 `.sidebar-empty` / `.sidebar-list` / `.file-item*` 只有它在用；ledger「文件树 / 工作区」○ 行引用了 `FileItem` / `Sidebar` | grep |
| 设计目标 | 新 DESIGN 的布局是「Sidebar(Contents/TOC) + main + bottom tabs」。阅读顺序第 3 条：「sidebar contents and the bottom tabs: where you are, and what else is open」。即侧栏负责「在哪」，底部标签负责「还开了什么」 | `docs/design/mdpro-ui-new/DESIGN.md` § Layout |

额外发现：计划 P 的 A8 写着「Deletion is tracked in TODOS.md」，但 `TODOS.md` 里**没有任何** Sidebar / FileItem 条目。另外，sequencing doc（2026-10-02 决定 ②）记录这两个文件「仍在 HEAD，不重开阶段 2」。所以这两份死代码目前没有任何删除归属。

## 1. 对照总表

图例：✅ 有，默认可见｜◐ 有，默认隐藏或可选｜— 无｜? 未核实

| 产品 | 侧栏面板 | 面板切换方式 | 打开文档的呈现 | 侧栏里的「打开文件」列表 | 单文件时侧栏显示 | 切换快捷键 / 默认可见 | 宽度 | 位置 |
|---|---|---|---|---|---|---|---|---|
| **Typora** | Outline / 文件列表 (Articles) / 文件树 | 侧栏顶部分段切换；⌘⌃1/2/3 直达 | macOS 用 ⌘T「New Tab」（原生窗口标签，推断）；Win/Linux 文档写 Not Supported | — | **打开文件时自动载入其父文件夹**，所以文件树 / 列表总有内容 | ⌘⇧L | ? | 左 |
| **MarkText** | Files / Search / TOC（45px 图标列 + 右栏），底部是设置 | 竖向图标条（activity-bar 式）；再点当前图标就折叠成 45px | 顶部标签条，`tabBarVisibility` 默认 false，开第二个文档时自动显示 | ✅ Files 面板顶部有「Opened files」折叠段，偏好 `openedFilesInSidebar` 默认 true；行内悬停出关闭按钮，未保存时走 `CLOSE_UNSAVED_TAB` 确认 | 侧栏默认隐藏；打开文件夹时强制 `showSideBar + showTabBar + rightColumn='files'` | ⌘J；`sideBarVisibility` 默认 false | 可拖拽，最小 220，持久化（`sideBarWidth`） | 左 |
| **VMark**（Tauri+React，栈最接近） | Files / Outline / History（另有浏览器标签专用的三视图） | 侧栏头部**单个图标按钮循环切换** Files→Outline→History | **标签在底部状态栏**（`StatusBarTabStrip`，APG roving tab，可键盘导航） | — | Files 视图显示「No workspace open. Open a folder to browse its files.」；默认视图是 **outline** | ⌃⇧0 切侧栏，⌃⇧1 切大纲；默认 `sidebarVisible:false` | 180–480，默认 260，可拖拽，**按工作区实例**记忆宽度和视图 | 左 |
| **Zettlr** | 左：文件管理器（tree/list，thin/combined/expanded）＋全局搜索；右：TOC / References / Related files / Attachments | 右侧栏用 `TabBar`（`role=tabpanel`） | 顶部 `DocumentTabs`（`role=tablist/tab`，键盘可导航，脏状态 `modified`） | — | 文件树有独立的「Files」段放单独打开的根文件，下面才是 Workspaces | ⌘! 切文件管理器，⌘⇧0 切右侧栏；文件管理器默认显示，右侧栏默认隐藏，默认 tab=toc | SplitView 可拖拽，记忆百分比 | 文件左，TOC **右** |
| **SiYuan** | Dock：file / outline / inbox / bookmark / tag（左），agentChat / graph / globalGraph / backlink（右） | Dock 图标条；⌃1…⌃9 直达各面板 | 顶部标签 | — | 不适用（笔记本模型，没有单文件模式） | 默认只显示文件树（232px），outline 默认 `show:false` | 每个面板记忆 size | 左右均可 |
| **Obsidian** | 左右两个侧栏，各自容纳插件 tab（文件浏览器、搜索、书签 / 反向链接、出链、大纲…），左侧还有 Ribbon | 侧栏内 tab 图标；可拖拽成 tab group，可 pin | 主区顶部标签（可堆叠） | — | 需要 vault，没有单文件模式（基于产品模型，文档未逐字核实） | 展开 / 收起图标；Command palette「Toggle left/right」 | ? | 左 + 右 |
| **iA Writer (Mac)** | Library = Organizer（Locations / Favorites / Smart Folders / Hashtags）+ File List | 两栏，⌃tab 在 Organizer→File List→Editor 间循环焦点 | 单击在当前窗口打开，双击在新窗口打开 | — | 文件存在 Library 位置中 | ⌃⌘S 显示 / 隐藏 Library | ? | 左 |
| **Bear** | Sidebar：Notes（Untagged / Todo / Today / Locked / Archive / Trash）+ Tags；中栏笔记列表 | 三栏 | 单笔记 | — | 不适用（数据库模型） | ? | ? | 左；**TOC 在 Info Panel 弹窗的 tab 里**（右上 ⓘ，可撕下浮动） |
| **Ulysses** | Library / Sheet List / Editor / Dashboard（Outline 在 Dashboard 里） | ⌘1/⌘2 切栏 / 焦点；←→ 在各栏间移动 | 单文稿 | — | 不适用 | ⌘1 Library，⌘2 Sheet list | ? | Library 左，Dashboard（含 outline）在编辑器右 |
| **MiaoYan** | 文件夹侧栏 + 笔记列表 + 编辑器（三栏）；TOC 是预览里的浮动面板 | 布局循环按钮（三栏→两栏→专注） | 单笔记，无标签 | — | 不适用（存储目录模型） | ⌘1 侧栏，⌘2 笔记列表 | NSSplitView | 左 |
| **VS Code** | Explorer：**Open Editors（默认隐藏）**/ Folders / Outline / Timeline；另有 Search、SCM 等 | Activity Bar 切 view container；Explorer 内是可折叠段 | 顶部标签（可设 `showTabs: single/none`） | ◐ **Open Editors 从 1.53 起默认隐藏**。理由是「its functionality … is covered … like tabs」；文档建议不用标签时用它导航。脏文档的关闭按钮换成圆点，标题有脏计数徽标 | 无文件夹时 Explorer 显示 Open Folder 空状态，Outline 照常可用 | ⌘B；可移到右侧 | 可拖拽、持久化 | 左 / 右可配 |
| **Sublime Text** | 侧栏：Open Files 段 + Folders 段 | 单侧栏，View › Side Bar › Show/Hide Open Files | 顶部标签（API `set_tabs_visible` 可隐藏） | ◐ 有 Open Files 段，可隐藏；新窗口继承上一个窗口的显示 / 隐藏状态（作者 jps 在论坛的回答） | 「只要有东西可显示（Open Files 或至少一个文件夹）才显示侧栏」（社区文档） | ⌘K ⌘B | ? | 左 |

## 2. 收敛的最佳实践和异类

### 收敛点（多数产品这样做）

1. **打开的文档只在一处呈现，就是标签。** 有常驻标签的产品（VS Code、Zettlr、SiYuan、Obsidian、VMark）**都不在侧栏默认再放一份「打开文件」列表**。VS Code 是唯一做过这个列表的大厂产品，后来在 1.53 把它**默认隐藏**，官方理由原话是 *"the functionality provided in the Open Editors view is covered in other areas of the workbench, like tabs"*。它的文档只把 Open Editors 定位成**关掉标签后**的导航替代。
2. **侧栏 = 导航（在哪），而不是文档切换器（还开了什么）。** 侧栏面板集中在文件树 / 列表、大纲、搜索，其次是标签、反向链接、历史。
3. **大纲是侧栏的一级面板。** 和文件树放在同一组切换里的有 Typora、MarkText、VMark、VS Code、SiYuan、Obsidian；或者单独放右侧栏（Zettlr、Obsidian 默认习惯、Ulysses Dashboard、Bear Info Panel）。
4. **多面板用一个切换控件，同一时刻只显示一个面板**，形式是分段控件、图标条或循环按钮。直达快捷键很常见，比如 Typora ⌘⌃1/2/3、SiYuan ⌃1-9、VMark ⌃⇧1。
5. **宽度可拖拽并持久化**（MarkText、VMark、Zettlr、SiYuan、VS Code），通常有最小值（180–232px）。VMark 和 Zettlr 还会记住上次使用的面板。
6. **单文件场景**有两派：
   - Typora 派：**自动载入当前文件的父文件夹**，文件树始终有内容。
   - VS Code / VMark 派：文件面板显示「打开文件夹」空状态，大纲照常可用。
   - 没有产品在单文件时用一个「打开文件列表」来填充侧栏。

### 异类

- **MarkText**：侧栏内「Opened files」默认开启，**同时**标签条默认隐藏。它的列表本质上是标签的替代品，而不是复制品。开第二个文档或打开文件夹后标签条才出现，这时两者共存。这是 mdpro 死代码 `Sidebar.tsx` 最接近的先例，但前提（默认无标签）和 mdpro 相反。
- **Sublime Text**：Open Files + Folders 同栏，属于代码编辑器的老传统，可以隐藏。
- **Zettlr / Obsidian / Ulysses / Bear**：大纲放在**右侧**，和左侧的文件导航分开。
- **iA Writer / Bear / Ulysses / MiaoYan**：库 / 数据库模型，侧栏是组织结构（位置、标签、智能文件夹），和 mdpro 的「单文件」模型不可比，仅作视觉参考。

## 3. 对 mdpro 的建议（死代码 `Sidebar.tsx` 的去留）

前提：mdpro 是「单文件 + 底部标签常驻」模型，DESIGN 已经把「还开了什么」分配给 bottom tabs。宪法约束是只处理本地文件，没有工作区。

| 选项 | 内容 | 收益 | 代价 / 风险 |
|---|---|---|---|
| **A：删除** | 删 `Sidebar.tsx`、`FileItem.tsx`、`index.tsx` 的 re-export、`globals.css:130-190` 的 `.sidebar-empty/.sidebar-list/.file-item*`、DW-2 测试用例（DW-1 BottomTabs 和 DW-3 App 保留同一不变式）；更新 ledger「文件树 / 工作区」行的措辞、计划 P A8 状态、sequencing doc；按 CLAUDE.md 还要补上 TODOS 归属缺口 | 去掉一份与 BottomTabs 平行、低质量（无 a11y、` *` 脏标记不一致）的实现；死代码守卫少一个候选；**和 VS Code 1.53 的结论一致** | 小：约 1 个 chore/refactor 提交。注意 D48 的 F-3（Sidebar 关文件）原本就未跑，删除后该项自然作废，要在 D48 行注明 |
| **B：复活为 Open Documents 面板，和 TOC 并列** | 侧栏加分段控件「Contents \| Open」 | 满足「竖向看长文件名、整列浏览」的少数需求（MarkText 式） | **和常驻 bottom tabs 完全重复**，违背收敛实践和 DESIGN 的分工；`FileItem` 需要重写（listbox 角色、键盘、图标关闭、圆点、tokens、rule 32/33 焦点）才能上线，工作量≈新写；新增 ledger 行、测试、MCP / 菜单无关但多一个 store 投影。只有当 mdpro 计划**允许隐藏底部标签**（像 VS Code `showTabs:none`）时才成立 |
| **C：把这个位置留给文件树（工作区计划），单文件模式只保留 TOC** | 按归档的 `20260628-plan-workspace-vault.md` P3：侧栏变成多面板宿主（Files / Search / Outline / Tags） | 和 Typora、MarkText、VMark、VS Code 的主流形态一致；解决 ledger 里文件树、全局搜索、标签等一串 Absent | 大特性：Rust 目录遍历 + 递归 watcher + vaultStore + 多面板宿主 + ADR（改变「单文件」产品定位，constitution 级）。**和死代码无关**：文件树不会复用 `Sidebar.tsx`，留着它也帮不上 C |
| **D：A + Typora 式轻量文件面板（后续，可选）** | 先删（A）；将来若要导航，用 Typora 做法：自动载入当前文件父文件夹，只读列表或树，和 TOC 分段切换，⌘⌃1/⌘⌃2 直达（与 Typora 对齐，而 ⌘⇧L 已对齐） | 不引入「工作区 / vault」概念，也能获得同目录跳转；单文件模型不变 | 仍需要 Rust 列目录命令 + watcher 范围 + ADR；属于新功能，需要另立计划 |

### 推荐：**A（立即删除）**，同时把 C 或 D 作为独立的未来决策，不和死代码绑在一起

理由：
1. **证据一边倒**：常驻标签和侧栏「打开文件」列表并存，在调研的 12 个产品里只有 MarkText 默认这样做，而且它是在默认**隐藏**标签的前提下。VS Code 做过同样的东西，又以「被标签覆盖」为由默认隐藏。mdpro 的 bottom tabs 常驻，B 就是 VS Code 1.53 以前那种状态。
2. **DESIGN 已有分工**：侧栏 = Contents（在哪），bottom tabs = 还开了什么。B 会让两处争同一职责。
3. **复活成本≈重写**：现有 `FileItem` 不满足 rule 32/33（文本 `x` 关闭、无 aria-label、无键盘、` *` 脏标记），留着它对 C / D 也没有复用价值。文件树是 tree 语义，不是 list。
4. **删除成本低且可控**，并能消掉 A8「TODOS 追踪」的悬空承诺和 DW-2 这类只为死代码存在的测试。
5. 如果将来要侧栏导航，竞品主流路线是 C / D（文件树 / 父目录 + 大纲同栏切换、宽度可拖拽并持久化、记住上次面板）。这要单独写 ADR，因为它触碰「单文件」定位和「本地文件」宪法之外的工作区概念。

附带建议（不论选哪项，都对齐竞品基线，成本小）：
- 侧栏宽度可拖拽并持久化（现在固定 220px）。所有开源竞品都支持，最小值 180–232px。
- TOC 列表补 a11y 角色（`tree` / `treeitem` + `aria-expanded`，VMark 的 `FileNode` 有先例）。
- BottomTabs 目前是 `role="button"`。VMark 和 Zettlr 的标签都是 APG `tablist/tab` + roving tabindex，可以作为 WI-4.x 的参考（属于另一个议题）。

> 这是一个后果持久的取舍（删除 vs 复活，影响侧栏定位）。如果要把「A 还是 B」或「是否立项 C/D」交给 Codex 复核，可以走 cc-suite 让 Codex 先审议再给建议。

## 4. 未能核实的说法

- Typora macOS 的 ⌘T 是**原生窗口标签**：只从快捷键表「New Tab ⌘T，Windows Not Supported」推断，没有找到明确说明。Typora 侧栏宽度能否拖拽也未核实。support.typora.io 在 browse 下超时，改用官方镜像 support.typora.com.cn。
- Obsidian：Outline 默认在右侧栏、侧栏切换的默认快捷键、「没有单文件模式」都没有官方文档逐字证据。
- iA Writer Mac 版是否有大纲：官方页面标题写着「Exclusively on iA Writer for Windows: Dynamic Outline」，页面可能已过时，未核实 Mac 最新版本。
- Bear 和 Ulysses 的侧栏宽度、默认可见性，Bear 是否有标签：未核实。
- MiaoYan 的 ⌘1/⌘2：storyboard 里 `keyEquivalent="1"/"2"`，假设修饰键是 IB 默认的 Command，未在运行中确认。
- MarkText `SHOW_TAB_VIEW(always || tabs.length === 1)` 的精确触发时机（是开第二个文档还是第一个）：只读源码推断。
- Sublime「侧栏仅在有内容时显示」来自社区非官方文档；Open Files 的可隐藏性和继承行为来自 Sublime 官方论坛作者 jps 的回复，不是正式文档。
- SiYuan 和 Obsidian 的 a11y 未查。

## 附录：证据

### 开源仓库（`git clone --depth 1`，路径都相对于 `scratchpad/competitors/<repo>/`）

| 仓库 | SHA | 关键文件 |
|---|---|---|
| marktext/marktext | `c2a7f59ffded1f565a0b3e74c4fda7edf4341771` | `packages/desktop/src/renderer/src/components/sideBar/index.vue`（图标条 + 右栏 + drag-bar，最小 220）；`sideBar/help.ts`（files / search / toc）；`sideBar/tree.vue:7-60`（Opened files 段，saveAll / closeAll）；`sideBar/treeOpenedTab.vue`（悬停关闭，`CLOSE_UNSAVED_TAB`）；`static/preference.json:78-81`（`sideBarVisibility:false`, `tabBarVisibility:false`, `openedFilesInSidebar:true`）；`src/main/preferences/schema.json:396-414`；`src/renderer/src/store/project.ts:115-119`（打开文件夹时强制显示侧栏和标签）；`store/editor.ts:1432-1438`（`SHOW_TAB_VIEW`）；`src/main/keyboard/keybindingsDarwin.ts:98`（⌘J）；sideBar/*.vue 中 `role=`/`aria-` 零命中 |
| xiaolai/vmark | `00ad428592dc5e80aab5afc8878a3f8c3bd27930` | `src/components/Sidebar/Sidebar.tsx`（`VIEW_CONFIG` 循环 files→outline→history）；`src/stores/uiStore.ts:44-46,75-77`（180/480/260，默认隐藏，默认 outline）；`src/stores/settingsStore/shortcutDefinitions.ts:135-136`（⌃⇧0 / ⌃⇧1）；`src/components/Sidebar/FileExplorer/FileExplorer.tsx:158-167`（无工作区空状态，`role=navigation`）；`src/locales/en/sidebar.json:25`；`src/components/StatusBar/StatusBarTabStrip.tsx`（底部标签，APG roving tab）；`FileNode.tsx:45-53`（`aria-expanded`） |
| Zettlr/Zettlr | `e6c7fd8ffebfddb6fa091521b5a9dea673719887` | `source/win-main/sidebar/MainSidebar.vue`（TOC / References / Related / Attachments tabs）；`source/win-main/App.vue:13-75`（两个 SplitView，文件管理器左，侧栏右）；`source/app/service-providers/config/get-config-template.ts:248-250,321-323,344`；`source/app/service-providers/menu/menu.darwin.ts:496-506`（⌘! / ⌘⇧0）；`source/win-main/DocumentTabs.vue:19-55`（tablist / tab，modified）；`source/win-main/file-manager/FileTree.vue:1-50`（Files 段 + Workspaces） |
| siyuan-note/siyuan | `fb3355f07d22bff36f1d785999fd5ded6a90d468` | `app/src/constants.ts:512-521`（⌃1-⌃9 面板快捷键）；`app/src/constants.ts:766-845`（默认 dock：file 显示 232px，其余隐藏）；`app/src/layout/dock/*.ts` |
| tw93/MiaoYan | `eb38830c14c05f46960c57809714b5c4aa3c0c57` | `Business/Sidebar.swift`；`Controllers/ViewController+Layout.swift:231-267`（布局循环 / 侧栏 / 笔记列表切换）；storyboard「Hide/Show Sidebar」keyEquivalent 1，「Hide/Show NoteList」2；`Views/MPreviewView.swift:559`（TOC 在预览中） |
| microsoft/vscode（sparse） | `a114cacfe9a9e94ed07396441cab262703a07dd3` | `src/vs/workbench/contrib/files/browser/explorerViewlet.ts:107-123`（OpenEditors `hideByDefault: true`，⌘K E 聚焦）；`contrib/files/browser/files.contribution.ts:421-432`（`explorer.openEditors.visible` 9）；`contrib/files/browser/views/openEditorsView.ts:206-224,588,762`（脏计数徽标、`dirty` class、aria-label） |

### 官方文档 / 页面（gstack browse 抓取）

- Typora File Management（镜像）：https://support.typora.com.cn/File-Management/ （原站 https://support.typora.io/File-Management/ 超时）。原文：「when you open a file, its parent folder will be automatically loaded」「Typora has two types of sidebar: Outline Panel … File Tree … File List」。
- Typora Shortcut Keys：https://support.typora.com.cn/Shortcut-Keys/ （Toggle Sidebar ⌘⇧L；Outline / Articles / File Tree ⌘⌃1/2/3；New Tab ⌘T，Windows Not Supported；Switch opened documents ⌘`）
- VS Code 1.53 release notes：https://code.visualstudio.com/updates/v1_53 （「Open Editors view hidden by default … covered … like tabs」）
- VS Code UI 文档：https://code.visualstudio.com/docs/getstarted/userinterface （⌘B，可移到右侧；Outline 在 Explorer 底部；「Without tabs, the Open Editors section … is a quick way to do file navigation」）
- Obsidian：https://obsidian.md/help/sidebar 、https://obsidian.md/help/plugins/outline 、https://obsidian.md/help/tabs 、https://obsidian.md/help/plugins/file-explorer
- iA Writer：https://ia.net/writer/support/library/organize?platform=mac 、https://ia.net/writer/support/basics/shortcuts?platform=mac （⌃⌘S Library；⌃tab 焦点循环）、https://ia.net/writer/support/library/navigate-big-documents?platform=mac 、https://ia.net/writer/support/library/navigation?platform=mac
- Bear：https://bear.app/faq/about-the-sidebar-in-bear/ 、https://bear.app/faq/how-to-use-the-info-panel-table-of-contents-and-backlinks-in-bear/
- Ulysses：https://help.ulysses.app/keyboard-shortcuts-mac-ipad （⌘1 / ⌘2；栏顺序 Library、Sheet List、Editor、Dashboard）、https://blog.ulysses.app/ulysses-20-outline/
- Sublime Text：https://www.sublimetext.com/docs/api_reference.html （`set_sidebar_visible` / `set_tabs_visible`）、https://forum.sublimetext.com/t/disable-open-files-in-the-sidebar-by-default/4339 （jps：View/Side Bar/Hide Open Files，新窗口继承状态）

### mdpro 内部

`src/components/Sidebar/{index,Sidebar,FileItem,TOCSidebar}.tsx`；`src/components/BottomTabs/BottomTabs.tsx`；`src/hooks/useSidebarPreference.ts`；`src/styles/globals.css:23,81,108-190`；`tests/discard-dialog-focus-wiring.test.tsx:5,28,65-68`；`docs/plans/20260911-plan-ui-redesign.md`（A8 及 § Amendments ~:449）；`docs/plans/20260912-frontend-backend-sequencing-order.md:222`（决定 ②）、`:436`（D48 F-3 未跑）；`docs/feature-ledger.md:193-207,414`；`docs/plans/archive/20260628-plan-workspace-vault.md:28-38,56-58,78-85,147-149`；`docs/design/mdpro-ui-new/DESIGN.md` § Layout；`TODOS.md`（无 Sidebar 条目）。
