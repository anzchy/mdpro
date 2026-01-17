# Feature Specification: mdpro MVP - 本地Markdown编辑器

**Feature Branch**: `001-mdpro-mvp`
**Created**: 2026-01-17
**Status**: Draft
**Input**: User description: "调研typora和bm.md的经典功能，以及本地Markdown编辑器的功能，实现MVP版本的mdpro编辑器"

## Overview

mdpro是一款面向macOS的本地Markdown编辑器，结合Typora的无缝实时预览体验和bm.md的现代化功能设计。MVP版本专注于核心编辑体验，提供流畅的Markdown文档编辑、实时预览、文件管理以及自定义高亮标记功能。

### 研究参考
- **Typora**: 无缝实时预览、所见即所得编辑、主题定制、多格式导出
- **bm.md**: 多文件标签页管理、双向滚动同步、13种排版主题、WeChat优化导出

## Visual Design

- **Wireframe Diagram**: [wireframe.html](./diagrams/wireframe.html) - 界面布局线框图
- **Site Diagram**: [site-diagram.html](./diagrams/site-diagram.html) - 应用架构和数据流图
- **User Flow Diagram**: [user-flow.html](./diagrams/user-flow.html) - 用户旅程流程图

## Clarifications

### Session 2026-01-17

- Q: Auto-save behavior for data loss prevention? → A: Auto-save drafts locally every 30 seconds, with explicit Cmd+S for file save
- Q: Editor mode style (split-pane vs WYSIWYG)? → A: Both modes available, user can switch between split-pane and WYSIWYG inline editing
- Q: MVP scope exclusions? → A: Exclude cloud sync and plugins; include basic HTML export

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 打开并编辑本地Markdown文件 (Priority: P1)

作为一个内容创作者，我希望能够快速打开本地的Markdown文件并开始编辑，以便高效地管理我的文档工作。

**Why this priority**: 这是Markdown编辑器的核心功能，没有文件操作能力，其他功能无法使用。

**Independent Test**: 用户可以通过文件菜单或拖拽方式打开.md文件，编辑内容后保存，验证文件内容正确更新。

**Acceptance Scenarios**:

1. **Given** 用户启动应用, **When** 用户通过"文件→打开"选择一个.md文件, **Then** 文件内容显示在编辑区域
2. **Given** 编辑区域显示文件内容, **When** 用户修改文本并按Cmd+S, **Then** 文件保存成功，标题栏显示已保存状态
3. **Given** 用户在Finder中有.md文件, **When** 用户将文件拖拽到应用窗口, **Then** 文件自动打开并显示内容
4. **Given** 用户正在编辑未保存的内容, **When** 用户尝试关闭窗口, **Then** 系统提示是否保存更改

---

### User Story 2 - 实时预览Markdown渲染效果 (Priority: P1)

作为一个Markdown用户，我希望在编辑时能实时看到最终渲染效果，以便确保格式正确。

**Why this priority**: 实时预览是现代Markdown编辑器的核心体验，直接影响用户编辑效率。

**Independent Test**: 用户输入Markdown语法后，预览区域立即显示渲染后的效果。

**Acceptance Scenarios**:

1. **Given** 编辑区域为空, **When** 用户输入`# 标题`, **Then** 预览区域立即显示一级标题样式
2. **Given** 用户正在编辑, **When** 用户输入任何Markdown语法, **Then** 预览区域在100ms内更新渲染结果
3. **Given** 编辑区域和预览区域同时可见, **When** 用户滚动编辑区域, **Then** 预览区域同步滚动到对应位置

---

### User Story 3 - 创建新的Markdown文档 (Priority: P1)

作为一个用户，我希望能够快速创建新的Markdown文档，以便开始新的写作任务。

**Why this priority**: 创建新文档是基础文件操作，与打开文件同等重要。

**Independent Test**: 用户可以创建空白文档，编辑内容后保存到指定位置。

**Acceptance Scenarios**:

1. **Given** 用户启动应用, **When** 用户按Cmd+N或点击"文件→新建", **Then** 创建一个空白的编辑区域
2. **Given** 用户在新文档中编辑了内容, **When** 用户按Cmd+S, **Then** 弹出保存对话框让用户选择保存位置和文件名
3. **Given** 用户已保存过文档, **When** 用户再次按Cmd+S, **Then** 直接保存到原位置，无需再次选择

---

### User Story 4 - 使用标准Markdown语法编写内容 (Priority: P1)

作为一个Markdown用户，我希望编辑器支持所有标准Markdown语法，以便正常编写文档。

**Why this priority**: Markdown语法支持是编辑器的基础能力，决定了编辑器的可用性。

**Independent Test**: 用户可以使用各种Markdown语法，预览区域正确渲染所有语法元素。

**Acceptance Scenarios**:

1. **Given** 用户在编辑区域, **When** 用户输入标题语法(# ## ###), **Then** 预览显示对应级别的标题样式
2. **Given** 用户在编辑区域, **When** 用户输入列表语法(- * 1.), **Then** 预览显示有序或无序列表
3. **Given** 用户在编辑区域, **When** 用户输入代码块(\`\`\`), **Then** 预览显示带语法高亮的代码块
4. **Given** 用户在编辑区域, **When** 用户输入表格语法, **Then** 预览显示格式化的表格
5. **Given** 用户在编辑区域, **When** 用户输入链接或图片语法, **Then** 预览显示可点击的链接或渲染的图片

---

### User Story 5 - 使用高亮和标记功能 (Priority: P2)

作为一个笔记用户，我希望能够高亮重要文本和添加下划线标记，以便突出关键信息。

**Why this priority**: 这是mdpro的特色功能之一，区别于普通Markdown编辑器，但不影响基础使用。

**Independent Test**: 用户使用mark语法可以看到带颜色的高亮效果，使用自定义标签可以看到下划线效果。

**Acceptance Scenarios**:

1. **Given** 用户在编辑区域, **When** 用户输入`<mark style="background: #FF5582A6;">文本</mark>`, **Then** 预览显示带指定颜色背景的高亮文本
2. **Given** 用户在编辑区域, **When** 用户输入`<u>文本</u>`, **Then** 预览显示下划线文本
3. **Given** 用户选中一段文本, **When** 用户使用快捷键Cmd+Shift+H, **Then** 文本被高亮标记语法包裹

---

### User Story 6 - 切换编辑视图模式 (Priority: P2)

作为一个用户，我希望能在不同的视图模式间切换，以适应不同的工作场景。

**Why this priority**: 视图模式提升用户体验，但基础编辑功能不依赖此功能。

**Independent Test**: 用户可以切换到分屏模式、WYSIWYG模式、纯编辑模式或纯预览模式。

**Acceptance Scenarios**:

1. **Given** 当前为分屏模式, **When** 用户点击"仅编辑器"按钮, **Then** 预览区域隐藏，编辑区域占满窗口
2. **Given** 当前为分屏模式, **When** 用户点击"仅预览"按钮, **Then** 编辑区域隐藏，预览区域占满窗口
3. **Given** 当前为单一视图, **When** 用户点击"分屏"按钮, **Then** 编辑区域和预览区域并排显示
4. **Given** 当前为分屏模式, **When** 用户切换到"所见即所得"模式, **Then** 显示Typora风格的内联预览编辑器，Markdown语法在非编辑行自动隐藏并渲染

---

### User Story 7 - 使用文件侧边栏管理文档 (Priority: P3)

作为一个文档管理用户，我希望有侧边栏显示文件列表，以便快速切换不同文档。

**Why this priority**: 文件侧边栏提升多文档管理效率，但单文件编辑场景下非必需。

**Independent Test**: 用户可以在侧边栏看到打开过的文件列表，点击可快速切换。

**Acceptance Scenarios**:

1. **Given** 用户打开了多个文件, **When** 用户查看侧边栏, **Then** 显示所有已打开文件的列表
2. **Given** 侧边栏显示文件列表, **When** 用户点击某个文件, **Then** 编辑区域切换到该文件内容
3. **Given** 用户正在编辑某文件, **When** 用户点击侧边栏的关闭按钮, **Then** 该文件从列表中移除

---

### User Story 8 - 切换明暗主题 (Priority: P3)

作为一个长时间使用编辑器的用户，我希望能切换明暗主题，以减少眼睛疲劳。

**Why this priority**: 主题切换是用户体验优化，基础功能完成后再实现。

**Independent Test**: 用户可以在设置中切换明暗主题，界面颜色相应变化。

**Acceptance Scenarios**:

1. **Given** 当前为亮色主题, **When** 用户切换到暗色主题, **Then** 整个界面切换为深色配色
2. **Given** 系统主题发生变化, **When** 用户开启"跟随系统"选项, **Then** 应用主题自动跟随系统变化

---

### Edge Cases

- 打开超大文件（>10MB）时如何处理？显示警告并允许用户选择是否继续
- 打开非UTF-8编码的文件时如何处理？尝试自动检测编码，失败时提示用户选择编码
- 网络图片加载失败时如何处理？显示占位图和错误提示
- 文件被外部程序修改时如何处理？检测到变化时提示用户是否重新加载
- 应用崩溃后如何恢复？启动时检测未保存的草稿，提示用户是否恢复

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须支持打开本地.md和.markdown文件
- **FR-002**: 系统必须支持创建新的Markdown文档
- **FR-003**: 系统必须支持保存文档到本地文件系统
- **FR-004**: 系统必须提供实时Markdown预览功能
- **FR-005**: 系统必须支持编辑区和预览区的双向滚动同步
- **FR-006**: 系统必须支持标准Markdown语法（标题、列表、代码块、表格、链接、图片）
- **FR-007**: 系统必须支持GFM扩展语法（任务列表、删除线、自动链接）
- **FR-008**: 系统必须支持HTML mark标签的颜色高亮渲染
- **FR-009**: 系统必须支持下划线标记语法
- **FR-010**: 系统必须支持代码块语法高亮（至少支持20种常用语言）
- **FR-011**: 系统必须支持明暗主题切换
- **FR-012**: 系统必须支持通过拖拽方式打开文件
- **FR-013**: 系统必须在文件有未保存更改时提示用户
- **FR-014**: 系统必须支持常用编辑快捷键（Cmd+S保存、Cmd+N新建、Cmd+O打开）
- **FR-015**: 系统必须支持撤销/重做操作（Cmd+Z、Cmd+Shift+Z）
- **FR-016**: 系统必须每30秒自动保存草稿到本地临时位置，用户显式Cmd+S时保存到原文件
- **FR-017**: 系统必须支持WYSIWYG内联编辑模式（Typora风格），Markdown语法在非编辑行自动渲染
- **FR-018**: 系统必须支持将文档导出为HTML格式（包含内联样式）

### Key Entities

- **Document**: 表示一个Markdown文档，包含文件路径、内容、修改状态、编码信息
- **EditorState**: 表示编辑器状态，包含光标位置、选中范围、滚动位置、视图模式
- **Theme**: 表示主题配置，包含配色方案、字体设置
- **UserPreferences**: 表示用户偏好设置，包含主题选择、自动保存设置、界面布局

## Out of Scope (MVP)

以下功能明确排除在MVP版本之外，将在后续版本考虑：

- **云同步**: iCloud、Dropbox或其他云存储集成
- **插件系统**: 第三方扩展或插件架构
- **PDF/Word导出**: 仅支持HTML导出，PDF和Word格式后续添加
- **协作编辑**: 多用户实时协作功能
- **版本历史**: Git集成或内置版本控制

## Assumptions

- 目标用户熟悉基本的Markdown语法
- 用户使用macOS 13或更高版本
- 用户设备为Apple Silicon (ARM架构)
- 用户主要编辑中小型文档（<5MB）
- 用户偏好本地存储，暂不需要云同步功能

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 用户可以在3秒内打开一个1MB以内的Markdown文件
- **SC-002**: 实时预览延迟不超过100毫秒
- **SC-003**: 用户可以在5分钟内完成首次文档创建和保存流程
- **SC-004**: 应用启动时间不超过2秒
- **SC-005**: 用户输入时无明显卡顿，保持60fps流畅度
- **SC-006**: 85%的用户能够在无需查阅帮助文档的情况下完成基本编辑任务
- **SC-007**: 应用内存占用在正常使用场景下不超过500MB
