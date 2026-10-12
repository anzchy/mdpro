# v0.3.1 之后的分支整合：ff master，改用永久集成分支 `develop`

**状态**：ACCEPTED 为 **B 方案**（2026-10-12，用户原话「选 B」；记录在 [ADR-0083](../adr/0083-master-is-the-single-integration-trunk.md)）。第 1–3 节是 A 方案的原稿，保留作历史；执行步骤以 ADR-0083 § Decision 第 4 条和附录 C 为准。
**范围**：只定分支模型、切换时点、各 session 的交接步骤。各工作项的验收条件仍以
[`20260912-frontend-backend-sequencing-order.md`](./20260912-frontend-backend-sequencing-order.md)
为准。决定一经采纳，理由与被否决的方案写进 **ADR-0083**（号已预留），本文只留顺序。

## 0. 现状（2026-10-12 中午核对）

| 事实 | 数据 |
|---|---|
| `master` | `c8bd2b6` = tag `v0.3.1`，与 `origin/master` 一致 |
| `frontend-backend-redesign` 本地 tip | `7164852`，领先 master **58** 个提交，`master` 是其祖先，可 `--ff-only` |
| 未推到 `origin/frontend-backend-redesign` | 57 个提交（origin 停在 `170a118`） |
| 已验证待落地 | a3 的 D162-WI-3 `ff3bf16`（父 `7164852`，verifier PASS），落地后再加一个 docs 提交 |
| 暂停中的在途工作 | a6 的 D111（WI-1 完成未提交，worktree `fix-d111-open-seed-changed` 基于 `a1e2c64`）；a3 的 D166 `d10aa0c`（基于 `d2978b6`，未 rebase）；adr047-verify 的 (b) 启动器 CLI 真机过（mini `verify-7164852`） |
| 写死分支名的地方 | `CLAUDE.md` 2 处、rule 70 6 处、`role-guard.sh` 2 处（`PROTECTED` 集合与注释）、`mdpro-landing-verifier.md` 4 处、`release-gate/SKILL.md` 1 处、`plan-and-doc-map/SKILL.md` 1 处、sequencing doc 9 处、`docs/guide/20261009-multi-session-tdd-device-workflow.md` 2 处（未跟踪，用户文件） |
| 不含分支名 | `tdd-guardian/config.json`、`release.yml`、`ci.yml`（只说 master 经 PR）、`feature-ledger` |

关键更正：分支上的 500+ 个提交**绝大多数已经在 master 里**。发布 0.3.1 时 master 已 ff 到
`c8bd2b6`，差的只是发布后的 58 个。所以这次要做的不是「补欠账」，而是把「每次发版 ff master」
固化成流程，并借机把集成分支换成一个不再需要改名的名字。

## 1. 最佳实践与推荐

常见做法三种：

| 模式 | 做法 | 对 mdpro 的问题 |
|---|---|---|
| 每个版本一条分支（`redesign-0.3.2`） | 发版后开新分支 | 每次都要改 rule 70 / hook / agent 里的分支名，约 25 处，容易漏 |
| **永久集成分支（`develop`）+ master 只指向发布** | 发版时 `master --ff-only develop`，然后继续在 develop 开发 | 一次迁移成本，之后零成本；与现有「master 只经 PR / 发布 SHA 锁定」完全兼容 |
| 直接在 master 上开发（trunk-based） | 所有人提交 master | 与 role-guard「master 是保护分支」、`ci.yml`「master 只经 PR」冲突，要重做保护模型 |

**推荐第二种**：新分支叫 `develop`，这是最后一次改名。每次 release 的流程固化为：
锁定 SHA → 发布 → `master --ff-only develop`，不再开新分支。

为什么不用 GitHub PR 合并：GitHub 没有 fast-forward 合并；「Rebase and merge」会改写 SHA，
而 sequencing doc、ADR、tdd-guardian receipts、device-check 记录全靠 SHA 引用。
直推 ff 的代价是 `ci.yml` 对直推 master 不跑 CI；每个提交都已在本机过 gate（rule 10），可接受。

## 2. 切换时点与顺序

**切点**：D162-WI-3 `ff3bf16` 落地并补完 docs 提交之后，D111 / D166 handoff 之前。
D174 已落地（`7cc8288`），`ff3bf16` 已验证，所以切点就在眼前。切点期间不接新 handoff，窗口约 1 小时。

1. **落地最后一项**（delegator）：`git merge --ff-only ff3bf16`，再一个 docs 提交填 D162 行的 SHA。
   记这个提交为 **T**。
2. **冻结**（delegator）：向 a3 / a6 / adr047 / codex-audit 广播「切点开始，暂停 handoff」。
   （2026-10-12 已因用户暂停而生效。）
3. **ff master 并建 develop**（**用户执行**；delegator 不碰 master，role-guard 也拦）：

   ```bash
   cd /Users/jackcheng/Documents/01_Coding/mac-app/mdpro
   git checkout master && git merge --ff-only frontend-backend-redesign
   git branch develop master
   git push origin master develop
   git push origin frontend-backend-redesign      # 本地领先 origin 57 个，先同步再冻结
   git checkout develop
   ```

   执行后 `master` = `develop` = `frontend-backend-redesign` = T。
4. **一个 chore 提交落到 develop**（delegator），把分支名改掉：
   - `CLAUDE.md`（含 worktree 创建命令）、rule 70、`mdpro-landing-verifier.md`、
     `release-gate/SKILL.md`、`plan-and-doc-map/SKILL.md`、sequencing doc 开头：
     `frontend-backend-redesign` → `develop`。
   - `role-guard.sh` 的 `PROTECTED` 集合**加** `develop`，旧名先保留一阵，防误操作。
   - **ADR-0083**：决定、三个方案、代价（直推 master 不跑 CI；一周内两个名字并存）。
   - 本文状态改为 ACCEPTED，引用用户原话。
   - `receipts.json` 随树走，175 条不丢；`tdd-guardian/config.json`、`release.yml`、`ci.yml` 不动。
5. **旧分支处理**：先打 tag `archive/frontend-backend-redesign`（指向 T）保留指针，**不立刻删**。
   一周后各 session 都在 develop 上了，再按 rule 25 问用户删本地与 origin 的分支，并把
   `PROTECTED` 里的旧名去掉。
6. **解冻**（delegator）：向各 session 发新基线 T 与 `develop` 名，按第三节交接。

## 3. 各 session 的交接

- **delegator**：步骤 1、2、4、5、6；更新 handoff 文件；之后 landing 流程不变，只是
  `--ff-only` 的目标与 verifier 的 parent 都是 `develop`。
- **a3 / a6（implementor）**：当前分支（`fix/d111-open-seed-changed`、`fix/d166-about-reopen-check`）
  的父提交在 develop 上是同一个 SHA，`git rebase develop` 实际是「rebase 到 T」，与原本要做的
  rebase 到 tip 相同，worktree 不用重建。之后新 worktree 用
  `git worktree add ../mdpro-wt/<dir> -b <branch> develop`。rebase 之后它们的 worktree 自带
  新版 role-guard，develop 自动受保护。a3 顺带重启补上 `MDPRO_ROLE=implementor`。
  a6 的 D111 未提交状态已有 patch（`~/.mdpro-redesign/handoff/mdpro-a6-d111-wi1-pause.patch`），
  rebase 时若冲突以 patch 为底重放。
- **adr047-verify（mini harness）**：mini 主 checkout `/Users/jack/Documents/mac-app/mdpro`
  现在停在 `e457cdb`（旧的 `feat/adr0047-agent-control-channel`），只在 delegator 转述用户决定后
  由它自己 `git fetch origin && git checkout develop`。那里有不属于它的未跟踪插件状态
  （`.claude/mind.mv2*`、`.tokenize/`、`scripts/redesign/device/.claude/`），切分支不会动它们。
  `verify-<sha7>` worktree 全按 SHA detach，不受影响；其 (b) 真机记录在解冻后提交到 develop。
- **codex-audit**：按 SHA 范围审计，不受影响；cherry-pick 目标改为 develop。
- **dtrack**：不碰 git，无事可做。
- **GitHub**：默认分支仍是 master；`release.yml` 仍按 `ref=<sha>` 触发；release-runbook 的
  「land the commit on master」在下一次发版时写成「`master --ff-only develop`」。

## 4. 需要用户定的

1. 新分支名 **`develop`**（推荐）还是别的？这是分支模型的长期决定，也可以「让 Codex 权衡一下再定」。
2. 切点就按「`ff3bf16` 落地 + docs 提交之后」？

## 5. 收尾清单（解冻后）

- 已确认可删的 worktree（rule 25 一次问完）：`feat-adr0047-agent-control-channel`、
  `fix-d86-watcher-silent-drops`（这两个只有脏的 `state.json`，需 `--force`）、
  `fix-d171-background-tab-changes`、`fix-d174-doctor-lock-leftovers`；对应分支
  `fix/d148-claim-hardening`、`fix/d138-saveas-reload-duplicate`、`fix/d171-background-tab-changes`、
  `fix/d174-doctor-lock-leftovers` 均已合并，`-d` 即可。`chore-d30-tauri-upgrade-trial` 有依赖改动，由用户定。
- `../mdpro-wt/verify-4ebfc89` 目录残留（worktree 登记已清），`rm -rf` 被权限 hook 拦，用户自己执行。
- 一周后：删 `frontend-backend-redesign`（本地 + origin），`PROTECTED` 去旧名，本文状态改为 DONE。

---

## 附录 A. 大厂与经典模型的分支实践（2026-10-12 调研）

由 Opus 子代理用 WebSearch / WebFetch 调研，`gh api` 核对各仓库当日的默认分支、分支名、tag 与近期 PR。
标 [未核实] 的来自二手来源或由分支布局推断。全文（含引用链接）在调研当日的 scratchpad，未入库。

### A.1 谁怎么做

| 组织 / 仓库 | 模型 | 长期分支 | 怎么切发布 | hotfix 怎么走 |
|---|---|---|---|---|
| **Google**（Piper 单仓） | 主干开发，"work at head" | 只有 trunk；"在分支上开发不常见也不受支持" | 从指定 revision 切 release 分支 | 先在主干修，再 cherry-pick 到 release 分支 [未核实：CACM 2016 论文原文经二手转引] |
| **Microsoft**（Azure DevOps "release flow"） | 主干 + release 分支 | `main`；topic 分支短命，feature flag 取代长期 feature 分支 | 每个 sprint 末从 `main` 切 `releases/M129` | "永远先改 `main`"，再 cherry-pick PR 到 release 分支；"release 分支永不合回 main" |
| **microsoft/vscode** | release flow | `main` | 每月一条 `release/1.141`，另有 `release/hotfix/1.106` | cherry-pick 到 `release/1.x` [推断] |
| **microsoft/TypeScript** | release flow | `main` | 48 条 `release-N.N`，另有 `release-N.N.N` | cherry-pick [推断] |
| **Amazon / AWS**（内部） | 主干 + 流水线 | "mainline" | 不切 release 分支；流水线 source → build → test → prod，one-box 先行 | 回滚或 fix-forward |
| **aws/aws-cdk** | 主干 + **production 分支** | `main` 与 `v2-release` | `main` 以 **merge commit** 合进 `v2-release`（如 `chore(release): 2.273.0`，双父），再用 `merge-back/N.N.N` 分支合回 `main` | `patch/vN.N.N` 分支 [推断] |
| **openai/codex** | 主干 + tag 触发发布 | `main` | 推 `rust-v*` tag 触发 release workflow，校验 tag 与 `Cargo.toml` | 按需切 `release/hotfix-0.156-47332` 之类的分支 |
| **openai/openai-python、openai-node** | 主干 + release-please | `main`；`release-v0.28.x` 只为维护旧大版本 | codegen PR 合进 `main`，release-please 的 "release: x.y.z" PR 打 tag | 经 `main` |
| **Anthropic** anthropic-sdk-python | 主干 + release-please | `main` | release-please PR 产出 `v1.x` tag | 经 `main` [未核实：PR 分支名暗示过一个临时 `next`，现已不存在] |
| **anthropics/claude-code** | 主干 | `main` | 从 `main` 发布 | [未核实：公开仓库主要是 issues / plugins / docs] |
| **GitHub**（GitHub Flow） | 分支 → PR → 合并 → 部署 | `master`/`main`，"master 里的东西随时可部署" | 持续部署，无正式发布 | 与普通改动同流程 |

经典模型：
- **git-flow**（nvie）：`master` 永远可发布、`develop` 集成。Driessen 2020-03-05 加注：做持续交付的团队应改用更简单的流程（如 GitHub flow）；**显式版本化**的软件 git-flow 仍可能合适。
- **GitLab Flow**：批评 git-flow 的两条永久分支——"工具默认都用 `main`，还要切到另一条分支很烦"；production 分支变体是"把 `development` 合进 production 分支即发布"，省掉 git-flow 的发布/打 tag/合回；release 分支"越晚切越好"，先合 `main` 再 cherry-pick 叫 "upstream first"。
- **Trunk-based development**（trunkbaseddevelopment.com）："顶住一切建立其他长期开发分支的压力"；release 分支 just-in-time 切，修复先上主干再 cherry-pick；"release 分支**不**合回主干"，发布活动停止后删除。
- **DORA**：活跃分支三条以内，分支寿命以小时计，每天合主干，不搞代码冻结；与更高交付绩效相关（2016–17 数据）。

### A.2 证据说了什么

- **长期集成分支**：所有被调研的大厂都在**默认分支**上开发，没有一家保留 `develop`。它们反对的是**分叉**（merge debt、集成期）；mdpro 的 `frontend-backend-redesign` 与 master 分叉数月，正是这个模式，这次整合是在还债。
- **`develop` + 发版时 ff `master`**：只有 **OneFlow 的 develop+master 变体**明确推荐这个做法（`master` 指向最新 release tag，每次 bump 后 `git merge --ff-only <tag>`）。GitLab 的 production 分支与 aws-cdk 的 `v2-release` 是近亲，但都用 merge commit，于是 production 分支上有集成分支没有的 SHA，aws-cdk 因此需要 `merge-back/*`。已知代价：两个名字一段历史（默认分支、release-please、Dependabot、贡献者都盯默认分支）；"latest" 含义易混（一旦有人直接在 master 上修 hotfix 就分叉，退化成带 merge-back 的 git-flow）；CI 可能跑两遍；hotfix 仍需 `release/x.y`（develop 已有未发布工作时，0.3.2 的修复不能只靠 master 出去）。
- **按版本开分支做开发**（`release-0.3.2` 当开发分支）：没有任何来源推荐。TypeScript 的 `release-N.N` 是从 `main` 切出的稳定分支，只收 cherry-pick，不在上面开发。
- **提升方式与 SHA**：fast-forward 保持同一 SHA，tag / docs / ADR / receipts 的引用全部有效；merge commit 保留原提交但 tip 是 CI 没构建过的新 SHA；squash 让原提交从 master 不可达；GitHub "Rebase and merge" 一律生成新 SHA。GitHub PR 界面**没有 fast-forward-only** 选项，真 ff 只能由有 bypass 权限的人直接 push。

### A.3 调研者的推荐与自我反驳

推荐 "A with discipline"（即 OneFlow develop+master）：`develop` 是唯一主干，按现在的 `--ff-only` 落地；`master` 永不直接提交，只在发版时 ff 到 tag 的 SHA；hotfix 时才从 tag 切 `release/x.y`，修复先上 develop 再 cherry-pick（upstream first），下一个 minor 发了就删。否决 C。

它反对 B（master 当主干）的理由是"mdpro 的 master 受保护、只经 PR，而 GitHub PR 不能 ff"。**这个前提经 delegator 用 `gh api` 核对为假**：master 上没有 required reviews、没有 required status checks、没有 linear history，只禁了 force push；"master 只经 PR" 是 `ci.yml` 里的一句注释。`c8bd2b6` 本身就是直接 ff push 上去的。

调研者自己给出的最强反方：所有大厂都把**默认分支当主干**，从它切 `release/*`；Driessen、GitLab、Chacon 都把第二条永久分支叫作可避免的开销。"如果 PR-only master 是习惯而非需求（没有外部东西把 master 读作最新发布），plain B 更简单、证据支持更多；A 只在 master 必须意味着最新发布时才是对的。"

## 附录 B. Codex 对本文的评审（gpt-6.1-sol，effort high，只读，线程 `01a12e34-1aee-7e21-ba49-6d1ebb31dcfa`）

**结论：NEEDS REVISION**。16 条发现（15 MUST、1 SHOULD；delegator 认为其中约三分之一实为 SHOULD）。采纳的要点：

1. **现在不要把 master 推到 tip**。本文自己说"master 只指向发布"，第 2 节却把 58 个未发布提交 ff 上去。最简切法：从验证过的 tip 建 `develop`，master 留在 v0.3.1，以后只提升**已发布的 SHA**。
2. **"保护"一词混了四层**：role-guard 只约束 implementor / tester，不约束 delegator 和未设角色的会话；GitHub 对 master 无强制；ci.yml 是意图；冻结是口头约定。要分开写明每层管谁。
3. **新基线是迁移提交 C，不是切换快照 T**。landing verifier 要求 parent 等于集成分支 HEAD，拿 T 当基线的第一个 handoff 会被拒；mini 若在 C 推送前 fetch，会拿到旧的 guard 与规则。
4. **漏掉的入口**：`/bump` 直接 `git push origin master --tags`；`fix-issue` 从 master 开分支；`plan-and-doc-map` 把其他工作指向 master。改分支名不等于理顺这些路线。
5. **没有 hotfix / 稳定化路径**：一个单独落在 master 上的修复会让下一次 `--ff-only develop` 失败。
6. **命令序列缺**远端新鲜度检查、多 ref 推送部分成功的恢复、`develop` 的 upstream 设置。
7. **发版提升的应是锁定的发布 SHA R**，不是会动的 `develop` tip。
8. **D111 的脏 worktree** 不能直接 rebase，要由 a6 先备份、清理、rebase、重放、重跑门禁。
9. **guard 改动要有回归测试**（`tests/role-guard-hook.test.ts`）；旧名退役以各会话确认完成为准，一周只是最短观察期。

评审代理补充 Codex 漏掉的一点：runbook 用 `gh workflow run release.yml --ref master` 派发，workflow 文件本身从 master 读；若 `develop` 改了 `release.yml` 而 master 落后，发布会跑旧 workflow。此外，Codex 的"用 PR merge commit"替代方案会让 master 每次发版都与 develop 分叉，之后必须合回，它低估了这个噪音。

## 附录 C. 综合判断（delegator，2026-10-12）

两份意见指向同一个方向，而本文第 1 节的推荐（A）站不住它原来的理由：

- 本文和调研报告反对 B 的共同前提是"master 受保护、只经 PR"。核实结果：GitHub 上什么都没强制，role-guard 把 `frontend-backend-redesign` 和 `master` 放在同一个 `PROTECTED` 集合里、保护方式完全相同。所以 B 的保护模型**不需要重做**，和 A 的成本一样。
- `release.yml` 已按 `ref=<sha>` 触发、`v*` tag 已标记发布，一个"只镜像发布"的 master 是冗余的；而 `/bump`、`fix-issue`、`--ref master` 这些现有入口在 B 下一个都不用改。
- A 比 B 多出：两个名字、两处 CI、每次发版多一步、hotfix 仍要 `release/x.y`、约 25 处分支名要改成 `develop`。B 要改的是同样那 25 处，改成 `master`，外加推翻 CLAUDE.md / rule 70 里「never commit to master」这一条规矩（改为"只有 delegator 以 `--ff-only` 落地到 master"）。
- 调研的全部大厂实践支持 B；支持 A 的只有 OneFlow 一篇。

**因此 delegator 的推荐改为 B**：master 就是主干，按现有 `--ff-only` 流程落地，`v*` tag 标记发布，需要 hotfix 时才从 tag 切 `release/x.y`（upstream first，发完下一个 minor 即删）。切换步骤按附录 B 修订：先建迁移提交 C（改分支名引用、guard 测试、ADR-0083、runbook、bump/fix-issue 指向），把 master ff 到 C，再让各会话以 C 为基线，并先 fetch 确认再切 mini。保留 A 作为 ADR-0083 的被否决方案，连同"master 必须意味着最新发布"这个唯一能让 A 翻盘的条件。

等用户决定：B（推荐）/ A / 先做 Codex 的最小切换（建 develop，master 留在 v0.3.1，长期模型下次发版前再定）。


## 附录 D. 迁移提交 C 的改动清单（2026-10-12 扫描，Opus 子代理，delegator 抽查）

17 个文件约 37 处要改；另有约 10 处只需确认不改。历史记录（sequencing doc 的旧行、device-check 记录、已接受 ADR 正文、20261009 guide 的叙述段）一律不动。

### D.1 分支名改为 `master`

| 文件 | 行 | 现文 | 改法 |
|---|---|---|---|
| `CLAUDE.md` | 236 | `git worktree add ../mdpro-wt/<dir> -b <branch> frontend-backend-redesign` | 基线改 `master` |
| `.claude/agents/mdpro-landing-verifier.md` | 5, 14, 32, 38 | "the current frontend-backend-redesign HEAD" / `git rev-parse frontend-backend-redesign` | 全部改 `master` |
| `docs/feature-ledger.md` | 3 | "分支 `frontend-backend-redesign`" | "分支 `master`（2026-10-12 前为 frontend-backend-redesign）"；随后 `pnpm ledger:build` |
| `docs/guide/20261009-multi-session-tdd-device-workflow.md`（未跟踪，用户文件） | 54–55 | "ff-only 推进 `frontend-backend-redesign`" / "不推 master / origin" | 54 改 `master`；55 改 "不推 origin" |

### D.2 规则改写

| 文件 | 行 | 现文 | 改法 |
|---|---|---|---|
| `CLAUDE.md` | 199–200 | "every commit for this effort goes to `frontend-backend-redesign`. Do not commit it directly to `master`." | "每个工作项落到 `master`，只经 delegator 的 `git merge --ff-only`；不直接 commit，不 merge commit" |
| `.claude/rules/70-multi-session-coordination.md` | 62 | "commit, merge, rebase or reset on `master` or `frontend-backend-redesign`" | 只留 `master`（hook 里旧名再留一周） |
| 同上 | 111–112 | "`frontend-backend-redesign` HEAD … `git rebase frontend-backend-redesign`" | 改 `master` |
| 同上 | 127 | "A session that lands commits on `frontend-backend-redesign` itself (by cherry-pick)" | 改 `master`，或删（只有 delegator 落地） |
| 同上 | 149 | "Never commit to `master` and never push to `origin` unless the user asks." | "只有 delegator 以 `--ff-only` 落地 `master`"；**push 条款待用户定**（见 D.6） |
| `.claude/skills/plan-and-doc-map/SKILL.md` | 141, 143–145 | "One long-lived branch carries this effort … Never commit it directly to `master`." | 改为 B：`master` 唯一主干、短命 `<type>/<id>-<slug>` 分支、delegator ff-only、`release/x.y` 只为 hotfix |
| `.claude/skills/release-gate/SKILL.md`（有用户未提交改动） | 17–18 | "the branch must be `frontend-backend-redesign`, never `master`" | gate 跑在基于 `master` 的工作分支或锁定的 `master` SHA 上 |
| `docs/plans/20260912-frontend-backend-sequencing-order.md` | 20 | "本效力范围内的所有提交都进 `frontend-backend-redesign` 分支，不直接进 `master`。" | 改 B 规则，带日期与 ADR-0083 链接 |
| `docs/guide/20261009-multi-session-tdd-device-workflow.md` | 94 | "永不提交 master、永不 push origin" | "只有 delegator 以 --ff-only 落地 master" |

### D.3 hook 代码与测试

| 文件 | 行 | 现文 | 改法 |
|---|---|---|---|
| `.claude/hooks/role-guard.sh` | 10 | 注释 "`master` or `frontend-backend-redesign`" | 注释改 `master`（旧名保留至删除） |
| 同上 | 56 | `PROTECTED = {"master", "frontend-backend-redesign"}` | 一周内两者都留，之后 `{"master"}`；可选加 `release/*` 前缀匹配 |
| `tests/role-guard-hook.test.ts` | 6 | 文档注释 | 更新 |
| 同上 | 40, 121, 126, 130 | `repo("redesign", "frontend-backend-redesign")` 等 | 旧名 fixture 只在 PROTECTED 还含旧名时保留；用例改指 `master` |
| 同上 | 155–156 | `git merge frontend-backend-redesign` / `git rebase frontend-backend-redesign` 在 feature 分支上 | 改成 `git rebase master` / `git merge master`（允许）；这是 B 的核心路径，今天没测 |

### D.4 runbook 与命令

| 文件 | 行 | 现文 | 改法 |
|---|---|---|---|
| `CLAUDE.md` | 133 | "Bump the three files … and land the commit on master" | "在 `chore/` 分支做，delegator `--ff-only` 落地"；可加一行 hotfix |
| `docs/guide/release-runbook.md` | 14 | "and land the commit on `master`." | "由 delegator `--ff-only` 落到 `master`"；新增 hotfix 节（从 tag 切 `release/x.y`，`cherry-pick -x`） |
| 同上 | 9, 32 | `--ref master -f ref=<sha>` | 不改（B 下正确）；hotfix 时 `ref=` 是 release 分支 SHA |
| `.claude/commands/bump.md` | 57–60 | `git commit` / `git tag` / `git push origin master --tags` | 在非 master 分支上跑，delegator ff；tag 打在落地 SHA；push 归 delegator。现文是直接提交 master |
| `.claude/commands/fix-issue.md`（有用户未提交改动） | 23–24 | "(The UI-redesign … lives on `frontend-backend-redesign` …)" | 删括号；21–22、89–90、113、141、247–250 已正确 |
| `.claude/commands/ship.md` | 23–32, 59, 183 | `git merge origin/master --no-edit` 再开 PR | 审视：merge commit + PR 与 ff-only 冲突；改为 rebase 本地 `master` 后 handoff |

### D.5 workflow

| 文件 | 行 | 现文 | 改法 |
|---|---|---|---|
| `.github/workflows/ci.yml` | 3–4 | "A direct push to master deliberately runs nothing: master is meant to be reached through a PR" | 注释已不成立，重写；是否加 `push: branches: [master]` **待用户定**（见 D.6） |
| `.github/workflows/cc-audit-fix.yml` | 154–155 | "Never commit to master directly … via PR" | bot 的 PR 在 GitHub 合并会产生 merge commit，破坏 ff-only；要么 bot 改经 delegator，要么写明例外 **待用户定**（见 D.6） |
| `.github/ISSUE_TEMPLATE/small-feature.md` | 16 | "merged to `master`" | 可改 "landed on `master`"，可不改 |

不改：`.github/workflows/ai-verifier.yml:11`、`.github/scripts/pre-pr-gates.sh`、`scripts/build-windows.sh`、`docs/reference/auto-issue-fixer-cron.md`（`git pull origin master` 建议改 `--ff-only`，可选）、`tests/release-source-check.test.ts:96` 与 `tests/release-gate.test.ts:224`（拒绝 `master` 作为 ref 是发布安全测试）、`tests/role-guard-hook.test.ts:74,119`（B 下仍成立）、ADR-0073（第 70 行与 B 一致）。

### D.6 需要用户定的三件事（2026-10-12 用户裁决附在每条之后）

- 1 **已定**：用户原话「落地即推」。每次 `--ff-only` 后 delegator 立即 `git push origin master`；rule 70 第 149 行改为「只有 delegator 推 master，落地即推」。ADR-0083 Decision 1 不变。
- 2 **待讨论**：用户原话「每次推master就跑太频繁了，这个有待讨论」。现状：`ci.yml` 已在 `push: tags: v*` 和 `workflow_dispatch` 上跑，所以每个发布 tag 都有一次 Linux 全量；本地 lane 守每次落地。delegator 建议：迁移提交 C 只改注释，不加 push 触发；若之后想要 Linux 金丝雀，加一条每日 `schedule`（与落地次数无关，一天一次）。
- 3 **delegator 建议**：`cc-audit-fix.yml` 现为手动触发、最近 5 次运行全部失败、仓库最后一个 PR 是 #414（redesign 之前）。bot 实际休眠，不另建通路：C 里把其提示词的「Never commit to master directly」改为「不在 GitHub 上合并；bot 分支交 delegator rebase + ff-only 落地」，其余不动。


1. **push origin**：ADR-0083 Decision 1 写的是每次 ff 后 `git push origin master`；rule 70 第 149 行是 "never push to origin unless the user asks"。二选一：落地即推（origin 永远等于本地，不再积压 57 个未推提交）/ 保持用户点头才推。
2. **GitHub CI**：直推 master 不跑 CI。加 `push: branches: [master]` 让每次落地跑一遍 Linux 测试（多一份 Actions 开销）/ 维持只在 PR 上跑。
3. **bot PR**：`cc-audit-fix.yml` 的自动修复 PR 若在 GitHub 上合并会在 origin/master 产生 merge commit，下一次 ff-only 就失败。停用 bot 直接合并（bot 分支交 delegator rebase + ff）/ 允许例外（delegator 随后 `git pull --ff-only`，失败时 rebase 本地）。
