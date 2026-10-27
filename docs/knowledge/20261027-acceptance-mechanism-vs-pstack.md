# 验收机制评估：mdpro 现状 vs pstack（2026-10-27）

写于 2026-10-27，herdr-delegator 答用户问：「全面check当前验收机制，整个feature dev workflow，和 pstack的Workflow
相比，特别是验收机制（某个功能开发后是否如预期）方面，当前project setup，有没有值得改进的地方。」
背景对照见 [`dev-practices-matt-pstack.md`](./dev-practices-matt-pstack.md)（2026-10-16）。pstack 现状取自其 README
<https://github.com/cursor/plugins/tree/main/pstack>（2026-10-27 读取）。

## 一句话结论

mdpro 在**代码层面的验收**（测试矩阵攻击、RED receipt、两个模型的两轮审计、CI、landing verifier）上已经比 pstack 重。
差距在 **"在真实 app 里证明它能用"这一步发生得太晚、由别人做、而且靠手写卡片**。pstack 的核心原则
`prove-it-works`（"Verify against the real artifact … not a proxy, self-report, or 'it compiles'"）和
`sequence-verifiable-units`，mdpro 只在合入 master **之后**、以批次形式做到。

## 当前一项工作怎样被"验收"

| 阶段 | 谁 | 证明了什么 | 证明不了什么 |
|---|---|---|---|
| brief AC + 测试矩阵 + spec-adversary 攻击 | implementor + 对抗 agent | 测试设计没有明显漏洞 | 假设本身对不对（例如 AppKit 的真实事件顺序） |
| RED receipt → GREEN，coverage | implementor | 测试先红后绿 | jsdom 之外的行为 |
| self-acceptance 表 | implementor | 每条 AC 有测试证据 | 真 app 里的行为（AC 允许写"device pending"） |
| gpt-auditor + opus-auditor，至多两轮 | 两个模型读 diff | 代码层面的 Critical/High | 运行时行为：审计不跑 app |
| landing verifier + `ci-gate` | subagent + CI | lane 可复现、范围干净 | 同上 |
| **合入 master** | delegator | — | — |
| 真机批次 B1…B11 | gpt-auditor（Computer Use） | 真 app 里的行为 | — |
| 发版门禁 | delegator + 用户 | 锁定 SHA 上的回归 | — |

## 证据

1. **真机失败发生在合入之后。** D319：三轮审计后合入 `9b9cd404`，B8 真机 0 ms 竞速 4/4 FAIL
   （[记录](../test/20261025-b8-editor-dialog-menu-device-check.md)），根因是 AppKit 在切窗前结束菜单跟踪。单测和
   代码审计都基于一个错误的平台假设，只有真 app 能推翻它。又花了 Fix 3、新 PR #539、一轮审计和 B8b/B8c 两个批次。
   同类还有 B1 的 D291 → D314、B5c 的 D261 → D319、B9 的 D299。
2. **真机验收积压。** sequencing doc 里还有 19 行状态为"真机未验"、没打 ✅ 的行（2026-10-27 计数）。
3. **NOT EXERCISED 和批次重跑很多。** B5 → B5b → B5c，B6 → B6b，B8 → B8b → B8c，B9 → B10。原因有三种：
   - 工具限制：Computer Use 发不出反引号（`keyNotFound`），以及 `Screenshot unavailable`；
   - 步数用完；
   - **卡片写错**：B5 要求 Switch Documents 列出标签页，菜单计划里并没有这一条；B3 写的 `chmod 444` 不会触发失败。
4. **卡片不在仓库里。** 62 张验收卡片在 `~/.mdpro-redesign/device/v036-owed-work/cards/`，由 delegator 手写，
   不经过审计，也不和 plan 的 AC 对照。
5. **控制通道（ADR-0047，pstack 的 `/create-verification-skill` 在 mdpro 的对应物）停在一半。** ledger
   「验证运行的控制通道」是 `Partial`：只过单测和 CI 编译，没在真机验过。device-harness session 2026-10-18
   之后就不在了。72 份 implementor brief 里只有 1 份提到 `scripts/control`。
6. **escape 记录是空的。** `docs/audit/escapes.md` 一行都没有，但 D319 就是一个过了审计、在真机被发现的缺陷。所以
   ADR-0121 decision 6 要求的"拿 escape 去回放、衡量审计者"现在没有数据可用。
7. **有一道门禁总在豁免。** Gate exceptions 共 19 行，绝大多数是 receipt SEPARATION-BROKEN（例如 G541-1、
   G-D319-1、G529-1），同期 audit-log 里约 34 个 PR。一道门禁如果几乎每次都要豁免，就成了例行审批，起不到拦截作用。

## 和 pstack 对照

| pstack | mdpro | 差距 |
|---|---|---|
| `prove-it-works`：agent 在真 app 里自己验证，然后才说"完成" | implementor 交接时只有单测证据；真机由另一个角色在合入后做 | **大** |
| `/create-verification-skill`：项目专用的驱动工具 + 功能地图 | ADR-0047 控制通道（Partial）；Computer Use 兜底 | 中：工具做了一半，没有用起来 |
| `/maintain-verification-skill`：功能地图漂移后修正 | ledger 的「怎么确认」列是文字，`ledger:check` 只查路径 | 中 |
| `/create-formal-verification-skill`、`/statechart`：测试够不到的竞态和状态机 | 没有对应物；最贵的缺陷恰好是竞态和生命周期（D319、D261、D290、D299、D305） | **大** |
| `sequence-verifiable-units` | WI 切分得不错，但"verifiable"只到单测为止 | 小 |
| `/interrogate`：多模型审查 | 两个审计者，各两轮，比 pstack 重 | mdpro 更强 |
| `/tdd` | receipt + 矩阵攻击，比 pstack 重 | mdpro 更强，但见证据 7 |
| `/reflect`：把教训变成结构 | `progress.md`、hooks；escape 记录没在维护 | 小 |

## 建议（按收益排序）

1. **把行为证明前移到合入之前。** brief 的每条 AC 标上 `unit` 或 `device`。带 `device` 的 AC，implementor 交接时
   必须附真 app 的证据：verify 构建、`releaseId`、能证明路径被走到的日志行、截图。这一条加进 landing 的三个条件。
   - 代价：GUI 锁只有一把，implementor 要排队。
   - 控制方式：只对标 `device` 的 AC 生效。批次照旧留着，用作发版回归。
2. **把控制通道做完，作为 implementor 的标准工具。** 先完成 ADR-0047 剩下的 WI 和真机验收；然后把 Computer Use
   做不到的步骤（特殊按键、固定时序的竞速、读取状态）交给脚本。可以重复的脚本就是回归资产。
3. **验收卡片进仓库，并从 plan 的 AC 派生出来。** 放在 `tests/manual-fixtures/cards/` 一类的位置。卡片和 plan
   一起经 gpt-auditor 评审，brief 按 ID 引用卡片。这样从 AC 到测试到真机卡片只有一份来源，B5、B3 那样的卡片错误
   在评审时就能发现。
4. **竞态和状态机用模型和性质测试来验证。** 拖得最久的几项都是"某个 await 期间又发生一件事"。给 save、close、draft
   生命周期和菜单目标路由各写一个状态机模型，用 property-based test 生成交错顺序。D319 这类平台假设错误还是要靠
   真机，但"代码按模型走"可以在 jsdom 里便宜地穷举。
5. **把 escape 记录接上。** 一个已合入的条目在真机 FAIL，记录它的那个提交里就同时写 escape 行。先补 D319、D314、
   D299。不然无法回答"两个审计者两轮到底值不值"。
6. **处理 receipt 门禁的误报。** 统计 SEPARATION-BROKEN 的成因。如果大多是 helper 或 fixture 的合理改动，就改工具，
   让它区分"改了断言"和"改了喂数据的方式"；否则把它降成证据，不再当门禁。
7. **让 ledger 的「怎么确认」列能执行。** 每行链接到卡片或脚本。发版检查点跑一遍，也就是 pstack
   `/maintain-verification-skill` 的轻量版。

## 不建议的

- 再加一层代码审计。代码层面已经足够重，缺的是运行时证据。
- 取消真机批次。批次仍然是发版回归和跨条目交互的检查，只是不该是第一个看到行为的人。
