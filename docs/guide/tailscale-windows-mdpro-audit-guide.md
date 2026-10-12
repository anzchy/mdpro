# 经 Tailscale 接入 Windows 主机，安装 mdpro 并用 Windows 端 Claude 审计功能账簿

写于 2026-10-12。目标主机：用户命名 `desktop-7576am2`，tailnet 里显示为
`desktop-home`，IP `100.123.111.19`。本文沿用 rule 70 与 `remote-ssh` 技能对
Mac mini 的做法：**先探通网络，再探通 SSH，再把工作放到远端；GUI 工作只在远端
控制台会话里做，不从 SSH 会话里做。**

## 0. 今天验证到哪一步

从 MacBook 主检出里按顺序跑过，结果如下。没有列出的步骤**都没验证**，见 §9。

| 步骤 | 命令 | 结果 |
|---|---|---|
| tailnet 可见 | `tailscale status` | `100.123.111.19 desktop-home windows active; direct` —— 直连，不走 relay |
| 路由走 Tailscale | `route -n get 100.123.111.19` | `interface: utun8`，不是 Clash 的 `198.18.0.1` |
| Tailscale 层可达 | `tailscale ping -c 2 100.123.111.19` | `pong … in 415ms` |
| sshd 在跑 | `ssh -v -o BatchMode=yes 100.123.111.19 hostname` | 服务端 `OpenSSH_for_Windows_9.5`，主机密钥 `ssh-ed25519 SHA256:XGEIP0iWtBBw9XQgnKaK1nmOMHQuU/xxfqQRw/TnfzA`，可用认证 `publickey,password,keyboard-interactive` |
| 密钥登录 | 同上 | **拒绝**：`jackcheng@100.123.111.19: Permission denied (publickey,…)`。客户端出示了 `~/.ssh/id_ed25519`（`SHA256:YPxu3alPinU1IEJci9SJlXe1SmI7hz80C3Rt/yJ6ek8`），服务端没有这把公钥；而且 Windows 账户名几乎不会是 `jackcheng` |

结论（当时）：**网络和 sshd 都通，卡在 Windows 侧没有我们的公钥、以及不知道
Windows 账户名。**

**同日稍后解决。** 登录名是 `jack`，而且 `jack` 在 Administrators 组，所以 sshd
只读 `C:\ProgramData\ssh\administrators_authorized_keys`。真正的故障是：那个路径
被建成了一个**目录**（里面放着 `id_ed25519.pub`），sshd 读不了目录，于是每次都
退回密码。Windows 端的 Claude 按 §2 的提示把目录改名为
`administrators_authorized_keys.dir-backup`，新建了 ASCII 编码的单行文件并收紧
ACL（`SYSTEM:(F)`、`BUILTIN\Administrators:(F)`）。之后 MacBook 上
`ssh -o BatchMode=yes jack@100.123.111.19 'hostname; whoami'` 返回
`DESKTOP-7576AM2` / `desktop-7576am2\jack`，默认 shell 已是 Windows PowerShell
5.1.26100。用户文件 `C:\Users\jack\.ssh\authorized_keys` 里另有一把
`xq-remote-e2e` 的 key，管理员账户用不到它，没有动。

还确认了两个前提：

- mdpro **有 Windows 安装包**。`gh release view v0.3.1` 列出
  `mdpro_0.3.1_x64-setup.exe`（7 743 535 字节，sha256
  `1e964e1784aa71e3a8a39fd0a989e420da54b95a3d1c2c256d24f53982de2850`），
  `release.yml` 的矩阵含 `windows-latest / x86_64-pc-windows-msvc`。
  `CLAUDE.md` 写的目标平台仍是 macOS 13+ ARM64，账簿「Windows 构建」一行是
  `Unknown`——**这次审计正是第一次给那一行拿到真机证据。**
- Tailscale 自带的 SSH 服务端**不支持 Windows**（只有 Linux 与开源版 macOS），
  Tailscale 文档的退路是「在 Tailscale 之上跑传统 SSH 服务端」。所以
  Windows 侧用的是系统自带的 OpenSSH Server，Tailscale 只当网络层。

## 1. 两端前提

**MacBook**

- `tailscale status` 里 `desktop-home` 一行必须是 `active`。`Tailscale is stopped.`
  就 `tailscale up`。
- `route -n get 100.123.111.19` 的 interface 必须是 Tailscale 的 `utun*`。
  看到 `198.18.0.1` 是 Clash TUN 抢了路由，按
  `docs/reference/clash-tailscale/clash-verge-tailscale-complete-guide.md` 排除
  `100.64.0.0/10`。

**Windows**

- Tailscale 已装并登录同一 tailnet（已满足，否则 status 里不会有它）。
- OpenSSH Server 已装并在监听 22（已满足，§0 看到了 banner）。
- 知道登录用的**本地 Windows 账户名**，以及它是不是 Administrators 组成员——
  这决定公钥放哪个文件（§2）。

## 2. Windows 端一次性设置（用户在 Windows 上以管理员 PowerShell 执行）

Microsoft 的 OpenSSH 密钥文档是权威来源；下面是照它裁剪的最小步骤。

### 2.1 sshd 自启并确认在跑

```powershell
Get-Service -Name sshd | Set-Service -StartupType Automatic
Start-Service sshd
Get-Service sshd            # Status 应为 Running
```

### 2.2 放入 MacBook 的公钥

先在 MacBook 上取公钥一行：

```bash
cat ~/.ssh/id_ed25519.pub
```

**账户在 Administrators 组**（Windows 个人机通常如此）：公钥放
`C:\ProgramData\ssh\administrators_authorized_keys`，而且 ACL 必须收紧，否则
sshd 直接忽略这个文件。把 `<公钥一行>` 换成上面那行：

```powershell
Add-Content -Force -Path $env:ProgramData\ssh\administrators_authorized_keys -Value '<公钥一行>'
icacls.exe "$env:ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
```

中文版 Windows 的组名不同，用 SID 代替组名更稳：
`/grant "*S-1-5-32-544:F"`。

**标准账户**：放 `C:\Users\<账户>\.ssh\authorized_keys`：

```powershell
New-Item -Force -ItemType Directory -Path $env:USERPROFILE\.ssh
Add-Content -Force -Path $env:USERPROFILE\.ssh\authorized_keys -Value '<公钥一行>'
```

不要同时两处都放再去猜：`sshd_config` 末尾默认有
`Match Group administrators` → `AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys`，
管理员账户**只读**那个文件。

### 2.3 默认 shell 改成 PowerShell

默认是 `cmd.exe`，远端命令的引号规则会很难受。改注册表后不用重启服务：

```powershell
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
  -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force
```

装了 PowerShell 7 的话填 `C:\Program Files\PowerShell\7\pwsh.exe`。

### 2.4 把主机密钥指纹念给 MacBook 对

```powershell
ssh-keygen -lf C:\ProgramData\ssh\ssh_host_ed25519_key.pub
```

应该是 §0 里那个 `SHA256:XGEIP0iWtBBw9XQgnKaK1nmOMHQuU/xxfqQRw/TnfzA`。今天
MacBook 已用 `accept-new` 把它记进了 `known_hosts`；对不上就说明中间有别的东西，
停下来问人，不要 `ssh-keygen -R`。

## 3. MacBook 端：别名与连通确认

`~/.ssh/config` 加一段（`User` 填 §2 用的 Windows 账户名）：

```
Host win-desktop
    HostName 100.123.111.19
    User <windows账户名>
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
```

MagicDNS 名字是 `desktop-home`，但 Clash 劫持 DNS 时解析不了，所以别名里写 IP。

确认（代理里永远带 `BatchMode=yes`，否则密码提示会挂住会话）：

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 win-desktop 'hostname; whoami; $PSVersionTable.PSVersion'
```

看到主机名、`desktop-7576am2\<账户>` 和一个 PowerShell 版本号就是通了。

**权限规则**：Claude Code 的 allow 规则按命令字面匹配，`Bash(ssh win-desktop *)`
才能放行这个别名。要加规则请用户自己加，代理不改 settings。今天多段命令被整条
拒绝过一次（`ssh … ; nc …`），所以**一次一条命令**，别用 `;`/`&&` 把 ssh 和别的
东西串起来。

**文件传输**：Windows 没有 rsync，`scp` 在本仓库被 deny。小文件走 ssh 管道：

```bash
# Mac → Windows
ssh win-desktop 'Set-Content -Path C:\Users\<账户>\brief.md -Value $input' < brief.md
# Windows → Mac
ssh win-desktop 'Get-Content -Raw C:\Users\<账户>\report.md' > report.md
```

大的东西让 Windows 自己从 GitHub 拉（§4、§5），不经 MacBook 中转。

## 4. 在 Windows 上安装最新 mdpro

在 Windows 的 PowerShell 里（SSH 进去跑也行，这一步不需要桌面）：

```powershell
$v = "0.3.1"
$url = "https://github.com/anzchy/mdpro/releases/download/v$v/mdpro_${v}_x64-setup.exe"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\mdpro-setup.exe"
(Get-FileHash "$env:TEMP\mdpro-setup.exe" -Algorithm SHA256).Hash.ToLower()
```

哈希必须等于 release 资产的 digest（v0.3.1 是
`1e964e1784aa71e3a8a39fd0a989e420da54b95a3d1c2c256d24f53982de2850`；新版本用
`gh release view vX.Y.Z --json assets` 在 MacBook 上读 `digest` 字段）。
旁边的 `.exe.sig` 是 Tauri 更新器的 minisign 签名，**不是** Authenticode，所以
SmartScreen 会拦一次「未知发布者」，这是预期的。

安装必须在**桌面会话**里点（NSIS 有 UI）；静默装可试 `/S`，但没验证过。装完启动一次，
然后读日志确认身份——Windows 上 `dirs::home_dir()` 是 `%USERPROFILE%`，所以：

```powershell
Get-Content "$env:USERPROFILE\.mdpro\mdpro.log" | Select-String '"app.ready"' | Select-Object -Last 1
```

记下 `appVersion`、`platform`、`buildId`、`releaseId` 四个值。D175 的 `releaseId`
只在 `release.yml` 构建的包里有值，而 `verify-release` 只核对两个 macOS 包，
Windows 包里是什么**今天没人看过**，审计报告里照实记。

MCP 相关文件（§5.4 要用）在 `dirs::data_dir()`，Windows 上即
`%APPDATA%\mdpro\server.port` 与 `server.token`。

## 5. 在 Windows 上装 Claude Code 并接上仓库

### 5.1 安装

官方文档（code.claude.com/docs/en/setup）：原生 Windows 需要 Windows 10 1809+ /
Server 2019+、4 GB 内存；不需要管理员；**推荐装 Git for Windows**，否则 Claude Code
的 Bash 工具退化为 PowerShell 工具，而本仓库的 `scripts/*.sh` 和 tdd-guardian lane
都是 bash。

```powershell
winget install Git.Git
irm https://claude.ai/install.ps1 | iex
claude --version
claude doctor
```

`claude` 找不到就把 `%USERPROFILE%\.local\bin` 加进 PATH 再开新终端。

**登录要在桌面会话里做一次**（OAuth 走浏览器）。之后 SSH 进来的无头运行复用
已存的登录；如果无头运行报认证错误，要么回控制台跑，要么给那条命令设
`ANTHROPIC_API_KEY`。`--bare` 模式**从不读** OAuth 凭据，只认环境变量里的 key。

### 5.2 克隆仓库

```powershell
winget install OpenJS.NodeJS.LTS      # Node 22+
corepack enable; corepack prepare pnpm@10.26.1 --activate
git config --global core.autocrlf false  # docs/guide/cross-platform-wsl.md 的铁律
git clone https://github.com/anzchy/mdpro.git C:\src\mdpro
cd C:\src\mdpro
git log -1 --format=%h                   # 记下审计所基于的 master SHA
pnpm install
pnpm ledger:check                        # 机械门禁在 Windows 上跑一次，exit 0 才继续
```

`.gitattributes` 已强制 LF；装完后 `git status` 应该干净，满屏 modified 就是
CRLF 问题，按 `cross-platform-wsl.md` 处理。

### 5.3 不要跨平台复制 `~/.claude`

和 Mac mini 一样：**不把 MacBook 的 `~/.claude`、`~/.mdpro` 整个复制过去**。
仓库自带的 `.claude/rules`、`.claude/skills`、`CLAUDE.md` 随 clone 到位，
这就是审计需要的全部项目上下文。

### 5.4 把 Windows 上跑着的 mdpro 接给 Claude（MCP）

安装包里带 `mdpro_mcp.exe`（`externalBin`）。先找到它：

```powershell
Get-ChildItem -Path "$env:LOCALAPPDATA\Programs","$env:ProgramFiles" -Recurse -Filter "mdpro_mcp*.exe" -ErrorAction SilentlyContinue | Select-Object FullName
```

然后在仓库目录里注册（路径换成上面找到的）：

```powershell
claude mcp add mdpro -- "<路径>\mdpro_mcp.exe"
claude mcp list
```

mdpro 要在跑、MCP 在设置里是开的，`%APPDATA%\mdpro\server.port` 才存在。
工具参考与 curl 手工调用见 `docs/guide/mdpro-mcp-guide.md`（Windows 上把
`~/Library/Application Support/mdpro` 换成 `%APPDATA%\mdpro`）。

## 6. 审计方法

### 6.1 审什么

`docs/feature-ledger.md` Part 1 共 12 个分区、201 行，状态分布
Shipped 83 / Partial 65 / Stub 21 / Absent 29 / Unknown 3。账簿自己规定的三条：
状态枚举封闭；`Partial` 必带 `限制：`；审计 pass **追加不覆盖**，并以
「**这次没有关掉什么**」收尾。

三层，每层只能证明自己那层的事：

| 层 | 问的问题 | 手段 | 能证明 | 不能证明 |
|---|---|---|---|---|
| L1 机械 | 路径存在？状态在枚举内？每个声明的界面都有行？ | `pnpm ledger:check` | 没有漏掉的界面 | 句子是不是真的 |
| L2 代码对照 | 「在哪」那些文件里**真有**那个行为？Shipped 行有测试吗？ | 只读 subagent 逐分区读代码与 `tests/` | 行为存在于源码 | 行为在 app 里跑得通 |
| L3 真机对照 | 「怎么确认」那一格在 **Windows** 上做得出来吗？ | 控制台会话里的 Claude 驱动 app + 读 `mdpro.log` | 行为在这台机器上成立 | 在 macOS 上成立 |

**平台分流**是 L3 的第一步，不是事后注脚。账簿是按 macOS 写的：⌘ 快捷键、
Finder 关联、`open -a`、`RunEvent::Opened`、Retina 2× 几何……每一行先判成四类：
原样适用 / 换 Ctrl 后适用 / Windows 有对应物但账簿没写（资源管理器文件关联、
单实例）/ 平台不适用。只有前两类进真机对照；后两类进「差异表」。

### 6.2 判定词与证据纪律

每一行的输出是固定一张表，字段不许增减，subagent 才能并行而结果可合并：

| 行 | 账簿状态 | 审到的状态 | 平台类别 | 证据 | 判定 |
|---|---|---|---|---|---|

- **证据**是能被别人重做的东西：源码路径（不带行号，账簿规则）、测试文件名、
  或 `mdpro.log` 里那一条事件（`event` 与关键 context 键）。「看起来能用」不是证据。
- **判定**只有五个词：`一致` / `过度声称`（账簿说得比实际多）/ `不足声称`
  （实际比账簿多，常见于后来修了没改行）/ `平台不适用` / `未审`。
- **没走到代码路径的探针记 `未审`，不记 `一致`。** 这是 rule 70 对真机批次的要求
  （D86 的 ⌘S×20 探针先例）：日志里没出现那条应出现的事件，就是没审到。
- 过度声称里再分：缺 `限制：` 的 Partial；写成 Shipped 的 Partial；写成 Partial
  的 Stub。这三种是改状态格的，其余只改「怎么确认」的散文。

### 6.3 编排：一个控制台会话 + 按分区并行的子代理

借鉴官方无头文档与本仓库的多会话规则：

- **主会话**在 Windows 桌面上用 Terminal 启动的 `claude` 里（不是 SSH 进来的），
  因为 L3 要操作 app 窗口、读剪贴板、截图。SSH 会话没有交互桌面，这一点与
  mini 上 `dtrack` 必须在控制台开的原因相同。主会话**不加 `--bare`**：它需要
  `CLAUDE.md`、`.claude/rules` 与账簿本身。
- **L2 按分区派只读 subagent，并行**：12 个分区各一个，`model: opus`（rule 70：
  执行用 Opus），工具只给 `Read, Grep, Glob`。提示里给它分区标题、该分区所有行
  的原文、输出表的字段定义、以及「不得改文件」。主会话只合并表，不自己读代码。
- **机械子步骤用无头模式**，便于重跑和比对。例如把某分区的路径声明抽成 JSON：

  ```powershell
  claude -p --bare --output-format json --max-turns 6 --permission-prompts none `
    --allowedTools "Read,Grep,Glob" `
    --json-schema '{"type":"object","properties":{"rows":{"type":"array","items":{"type":"object","properties":{"row":{"type":"string"},"paths":{"type":"array","items":{"type":"string"}},"has_test":{"type":"boolean"}},"required":["row","paths","has_test"]}}},"required":["rows"]}' `
    "读 docs/feature-ledger.md 的「表格」分区，对每一行列出「在哪」里的路径，并判断 tests/ 下是否存在直接测它的文件"
  ```

  `--bare` 不读 CLAUDE.md、hooks、MCP，所以每台机器结果一样；但它也不读 OAuth，
  这条要带 `ANTHROPIC_API_KEY`。`--json-schema` 让 `structured_output` 可直接合并。
  `--permission-prompts none` 保证没人在场时不会挂在提示上。
- **L3 分批按区**，一批 6–10 行、一个 app 启动周期，和 rule 70 的真机批次一样。
  每行先写**失败条件**和**应到达的代码路径 + 应出现的日志事件**，再动手。
- **不在 Windows 上落地任何提交到 master。** 产出走分支，交给 delegator
  按 rule 70 ff-only（§7）。

### 6.4 一次审计 pass 的顺序

1. `git log -1` 记 SHA；`pnpm ledger:check` exit 0（L1）。
2. 12 个 L2 subagent 并行，合并成一张 201 行的表。
3. 平台分流：给每行打四类之一。
4. L3：对「原样适用 / 换 Ctrl」两类按分区分批跑，日志证据逐条贴。
   第一批固定是：`app.ready`（版本与身份）、新建 / 打开 / 保存 / 关闭、
   结构化日志、MCP `get_open_documents`——这些行决定其余行能不能审。
5. 写报告（§7），再回账簿改行。

## 7. 产出与落地

三样东西，缺一样就不算做完：

1. **证据记录** `docs/test/<YYYYMMDD>-windows-feature-ledger-audit.md`：
   机器与版本（Windows 版本、mdpro `appVersion`/`buildId`/`releaseId`、审计基于的
   master SHA、Claude Code 版本）、§6.2 那张合并表、平台差异表、每个 L3 批次的
   日志摘录。
2. **账簿本身**：
   - 判定为过度声称 / 不足声称的行**重写那一行**（状态、`限制：`、怎么确认），
     「Windows 构建」从 `Unknown` 改成真机证明的那个词；
   - 「审计 pass」小节**追加**一段 `### <日期> —— Windows 首次真机对照`，
     末尾一段「**这次没有关掉什么**」列出 `未审` 与 `平台不适用` 的行数和原因；
   - `pnpm ledger:check` 与 `pnpm ledger:build` 都跑，`feature-ledger.html` 一起提交。
3. **分支与交接**：在 Windows 上建 `docs/<id>-windows-ledger-audit`，`<id>` 向
   delegator 要（新发现一律由 delegator 登记 D 号，rule 70）。提交只含上面三类
   路径；把 SHA、父提交、路径、`ledger:check` 结果发给 `mdpro-delegator`，
   由它核对后 `git merge --ff-only`。Windows 上的会话是 rule 70 表里**没有的
   新会话种类**，开工那次提交要给它加一行；`.claude/hooks/role-guard.sh` 是 bash，
   在 Git Bash 下能不能生效没验证，所以在它验证前**不要**在那台机器上做任何
   碰 `master` 的 git 操作。

## 8. 从 MacBook 远程驱动（可选）

只适合 L1 与 L2——它们不需要桌面：

```bash
ssh win-desktop 'cd C:\src\mdpro; git pull --ff-only; pnpm ledger:check' 
ssh win-desktop 'cd C:\src\mdpro; & "$env:USERPROFILE\.local\bin\claude.exe" -p --bare --output-format json --allowedTools "Read,Grep,Glob" "<提示>" > C:\src\audit-l2-tables.json'
```

长任务用 Bash 的 `run_in_background` 等完成，不要轮询。L3 永远回到 Windows 桌面上
那个会话；需要人在 Windows 前面点的步骤（SmartScreen、安装器、首次登录、
Computer Use 授权）提前在简报里写明。

## 9. 今天没有验证的事

- 公钥登录成功与否（等 §2 做完）。
- Windows 账户名、是否管理员。
- 安装包在这台机器上能否安装、启动；`releaseId` 在 Windows 包里的实际值。
- `claude` 在 SSH 会话里复用桌面登录的行为；`--bare` + `ANTHROPIC_API_KEY` 路径。
- `pnpm ledger:check`、`scripts/heavy-lock.sh`、`role-guard.sh` 在 Git Bash 下的行为。
- `mdpro_mcp.exe` 的安装位置（§5.4 用搜索而不是写死路径，就是因为没看过）。
- Computer Use 在 Windows 上对 mdpro 窗口的可用性。

## 10. 故障对照

| 症状 | 原因 | 处置 |
|---|---|---|
| `Permission denied (publickey,password,keyboard-interactive)` | 公钥没放对文件，或账户名不对；管理员账户只读 `administrators_authorized_keys` | §2.2；`ssh -v` 看 `Offering public key` 后有没有 `Authentication succeeded` |
| 公钥放了仍拒绝 | `administrators_authorized_keys` 的 ACL 没收紧，sshd 静默忽略 | 重跑 §2.2 的 `icacls` |
| `banner line 0: HTTP/1.1 403` | 流量进了 Clash TUN | `tailscale up`；查 `route -n get` |
| `Could not resolve hostname desktop-home` | Clash 劫持 DNS | 别名里用 IP |
| 远端命令引号全乱 | 默认 shell 还是 cmd | §2.3 |
| 整条命令被 Claude Code 拒绝 | 多段命令里某段命中 deny | 拆成一次一条 |
| 满屏 modified | CRLF | `git config core.autocrlf false`，`cross-platform-wsl.md` |
| 无头 `claude -p` 报认证 | SSH 会话读不到桌面登录，或 `--bare` 不读 OAuth | 回控制台，或设 `ANTHROPIC_API_KEY` |
| `claude -p` 挂住不退出 | 等权限提示 | 加 `--permission-prompts none` 与 `--allowedTools` |

## 参考

- Tailscale SSH 支持的服务端平台（Linux、开源版 macOS；Windows 不在列）：
  https://tailscale.com/kb/1193/tailscale-ssh
- Microsoft，OpenSSH for Windows 密钥认证（`administrators_authorized_keys`、`icacls`、ssh-agent）：
  https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement
- Ansible 的 Windows SSH 页（DefaultShell 注册表项的来源之一）：
  https://docs.ansible.com/ansible/latest/os_guide/windows_ssh.html
- Claude Code 安装与 Windows 原生要求（Git for Windows 推荐、`irm … | iex`、`claude doctor`）：
  https://code.claude.com/docs/en/setup
- Claude Code 无头运行（`-p`、`--bare`、`--output-format json`、`--json-schema`、
  `--allowedTools`、`--permission-prompts none`、`--continue`）：
  https://code.claude.com/docs/en/headless
- 本仓库：`.claude/skills/remote-ssh/SKILL.md`（mini 的同一套做法）、
  `.claude/rules/70-multi-session-coordination.md`（真机批次、落地规则）、
  `docs/guide/cross-platform-wsl.md`、`docs/guide/mdpro-mcp-guide.md`、
  `docs/feature-ledger.md` § 怎么维护。
