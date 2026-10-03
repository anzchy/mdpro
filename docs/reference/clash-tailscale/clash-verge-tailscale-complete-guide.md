# Clash Verge Rev × Tailscale — Complete Guide

> 环境：macOS，Clash Verge Rev **2.5.6**（mihomo 内核，TUN 模式），Tailscale（macOS App）。
> 记录日期：2026-10-04。每条结论都标注了 ✅ 已验证 / ⏳ 待验证。

起因：`ssh 100.124.189.67`（Tailscale 上的 Mac mini）失败，SSH 握手收到的不是 SSH banner，而是
`HTTP/1.1 403 Forbidden`。原因是这个连接被 Clash 的 TUN 接走，交给了代理节点，没有进 Tailscale 的隧道。

---

## 1. 原理：Clash Verge 怎样生成并加载配置

### 1.1 三个关键文件

配置目录：`~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/`

| 文件 | 角色 | 谁写它 |
|---|---|---|
| `profiles.yaml` | **索引**：有哪些订阅、当前用哪个、每个订阅挂了哪些增强文件 | Clash Verge（界面操作） |
| `profiles/<uid>.yaml` / `.js` | 订阅原文件 + 各种增强文件 | 订阅更新 / 你手动编辑 |
| `clash-verge.yaml` | **最终生成的运行配置**，mihomo 内核实际加载的就是它 | Clash Verge 每次生成时整体覆盖 |
| `config.yaml`、`verge.yaml` | Clash Verge 自身的设置（端口、TUN 开关、stack…） | Clash Verge 设置页 |

**要确认某项改动有没有生效，只看 `clash-verge.yaml`。** 订阅原文件和增强文件只是生成它的原料。

### 1.2 订阅和增强文件怎么关联

每个订阅创建时，Clash Verge 会自动给它配 5 个增强文件（文件名是随机 uid），关系记录在 `profiles.yaml`
里该订阅的 `option:` 下。右键菜单的每一项对应其中一个文件：

| 右键菜单 | `option` 字段 | 文件类型 | 作用 |
|---|---|---|---|
| 编辑规则 | `rules` | `type: rules` | `prepend` / `append` / `delete` 规则 |
| 编辑节点 | `proxies` | `type: proxies` | 增删节点 |
| 编辑代理组 | `groups` | `type: groups` | 增删代理组 |
| 扩展覆写配置 | `merge` | `type: merge` | 按 YAML 键深度合并（覆写任意顶层键） |
| 扩展脚本 | `script` | `type: script` | `function main(config, profileName)` 任意改 |

另外还有两个**全局**增强文件 `profiles/Merge.yaml` 和 `profiles/Script.js`，对所有订阅都生效。

### 1.3 生成流程（点「使用」时发生了什么）

```
Rdh5i0bdPdAN.yaml   订阅原文件（只读，订阅更新时整体替换）
   │
   ├─ ① 订阅级增强（profiles.yaml 里该订阅 option 指向的文件）
   │      rules   → rOlpyyGLEMXK.yaml   prepend 插到 rules: 最前
   │      proxies / groups / merge / script
   │
   ├─ ② 全局增强：Merge.yaml → Script.js
   │      ← tun.route-exclude-address 就是从这里加进去的
   │
   ├─ ③ Clash Verge 自身设置覆盖（config.yaml / verge.yaml）
   │      端口、mode、TUN enable、stack 等
   │      ← 所以订阅写 stack: mixed，实际生效的是 gvisor
   ▼
clash-verge.yaml    → mihomo 内核热重载
```

> ⚠️ ① 内部各增强文件的执行先后，没有对照源码核实过；本文的改动不受顺序影响。
> ①→②→③ 的大方向是从实际结果里观察出来的：③ 覆盖了 stack，② 的 `route-exclude-address` 保留下来了。

**有三件事会触发重新生成：**
- 订阅右键 →「使用」（即使它已经是当前订阅）
- 在 Clash Verge 界面里保存任意增强文件
- 订阅自动或手动更新、「设置 → 重启内核」

**在 App 外面用编辑器改文件不会触发重新生成**，必须再做上面任意一个操作。

### 1.4 两个容易踩的坑（2.5.6 实测）

1. **Merge 文件里写的 `prepend-rules` / `prepend-rule-providers` / `append-proxies` 不会被处理。**
   ✅ 已验证：生成的 `clash-verge.yaml` 里出现了一个字面的 `prepend-rules:` 顶层键，`rules:` 列表里却没有对应规则。
   这些是旧版 Clash for Windows / 早期 Verge 的语法。2.x 起规则、节点、代理组改由各自专门的增强文件处理，
   Merge 只做 YAML 深度合并。
   附带影响：原来 Merge 里的 `RULE-SET,AI,AI-中继-202603` 实际**从来没有生效过**。
2. **不要直接改订阅原文件。** 远程订阅有 `update_interval: 1440`，每天会被整体覆盖。
   关掉自动更新再改，节点和到期时间就同步不到了。

---

## 2. 最佳实践：Clash TUN 与 Tailscale 共存

### 2.1 冲突是怎么发生的

两者都会在 macOS 上建一个 utun 虚拟网卡，并往路由表里写路由：

| 谁 | 网卡 | 写的路由 |
|---|---|---|
| Clash TUN | `utun1`，网关 `198.18.0.1` | `1/8`, `2/7`, `4/6` … `64/2`, `128/1`（切片覆盖全网） |
| Tailscale | `utun7` | `100.64/10`、每个 peer 的 `/32`、`100.100.100.100`（MagicDNS） |

macOS 按**最长前缀匹配**选路由：
- **Tailscale 运行时**，`100.64/10` 比 Clash 的 `64/2` 更具体，tailnet 流量走 `utun7`。
- **Tailscale 停止时**，`100.64/10` 路由消失，`100.124.189.67` 落进 Clash 的 `64/2`，
  被 Clash 当普通流量转给代理节点，代理返回 403。✅ 这次故障就是这样：`tailscale status` 显示 `Tailscale is stopped.`

所以 403 的直接原因是 Tailscale 没开。下面这套配置是兜底，保证 Clash 永远不碰 tailnet 网段：
就算 Tailscale 没开，SSH 也是直接连不上，不会出现看不懂的 403。

### 2.2 推荐方案（三层）

| 层 | 放在哪 | 内容 | 作用 | 状态 |
|---|---|---|---|---|
| **路由层** | 全局 `Merge.yaml` → `tun.route-exclude-address` | `100.64.0.0/10` | Clash 不为这个网段建路由，流量根本不进 Clash | ✅ 已生效 |
| **规则层** | 订阅「编辑规则」 → `prepend` | `IP-CIDR,100.64.0.0/10,DIRECT,no-resolve` | 万一流量还是进了 Clash，也直连、不走代理 | ✅ 已生效（2026-10-04 点「使用」后验证） |
| **系统代理层** | 订阅自带 `skip-proxy` | `100.64.0.0/10` | 系统代理模式下绕过（TUN 模式下不起作用） | ✅ 订阅已自带 |

**为什么路由层是主力：** 它在操作系统路由表这一层生效，和 Clash 的 `mode`（rule / global / direct）
无关。规则层在 `mode: global` 下会被整个跳过，只在 rule 模式下兜底。

**为什么 `tun` 放全局 Merge、规则放订阅的「编辑规则」：**
- `tun` 属于 Clash Verge 自身设置会覆盖的区域。实测 Merge 里**新增**的 `route-exclude-address` 字段能保留下来，
  订阅里写的 `stack` 则被覆盖掉了。放全局 Merge 对所有订阅都生效，换订阅也不会丢。
- 规则只能通过 `type: rules` 增强文件注入（见 1.4）。它是按订阅分开的，**换订阅后要在新订阅里再加一次**。

### 2.3 SSH 侧配套（`~/.ssh/config`）

```
Host mac-mini
    HostName jacks-mac-mini        # MagicDNS 名，IP 变了也能连
    User jack                      # 远端用户 ≠ 本机用户 jackcheng
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new   # 首次连接自动接受 host key；之后 key 变了仍会报错
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

日常诊断流程见项目 skill `.claude/skills/remote-ssh/SKILL.md`。

### 2.4 验证清单

```bash
D=~/Library/Application\ Support/io.github.clash-verge-rev.clash-verge-rev

# 路由层：tun 下应有 route-exclude-address
grep -n -A1 'route-exclude-address' "$D/clash-verge.yaml"

# 规则层：rules: 第一条应为 IP-CIDR,100.64.0.0/10,DIRECT,no-resolve
awk '/^rules:/{f=1;n=0} f&&n<3{print;n++}' "$D/clash-verge.yaml"

# 系统路由：应走 Tailscale 的 utun，而不是网关 198.18.0.1
route -n get 100.124.189.67 | grep -E 'interface|gateway'

# 端到端
tailscale status | head
ssh -o BatchMode=yes mac-mini 'hostname; whoami'
```

### 2.5 可选：MagicDNS 保护

当前 DNS 是 `enhanced-mode: fake-ip` + `dns-hijack: any:53`。实测 `jacks-mac-mini` 解析正常，暂时不用处理。
如果以后 `*.ts.net` 解析失败或者解析成 `198.18.x.x`，在订阅的「扩展覆写配置」里加：

```yaml
dns:
  fake-ip-filter:
    - '+.ts.net'
  nameserver-policy:
    '+.ts.net': 100.100.100.100
```

### 2.6 回滚

- `profiles/Merge.yaml.bak-20261003` — 全局 Merge 改动前的备份
- `~/.ssh/config.bak-20261003` — SSH 配置改动前的备份
- 规则增强文件：把 `prepend` 改回 `[]`，再点「使用」

---

## 3. 范例文件

> 敏感信息（订阅 token、uuid、公钥）已替换为 `<REDACTED>`。

### 3.1 `profiles.yaml`（索引，节选当前订阅）

```yaml
current: Rdh5i0bdPdAN            # 当前订阅 → 决定用哪套增强文件
items:
- uid: Merge                     # 全局 Merge（对所有订阅生效）
  type: merge
  file: Merge.yaml
- uid: Script                    # 全局 Script
  type: script
  file: Script.js

# —— 当前订阅自带的 5 个增强文件 ——
- uid: mt0eifGB8lpP
  type: merge
  file: mt0eifGB8lpP.yaml
- uid: seAEinyZ6UB3
  type: script
  file: seAEinyZ6UB3.js
- uid: rOlpyyGLEMXK
  type: rules
  file: rOlpyyGLEMXK.yaml
- uid: paFU8lXAdcbY
  type: proxies
  file: paFU8lXAdcbY.yaml
- uid: gfzVKzaTSxt1
  type: groups
  file: gfzVKzaTSxt1.yaml

# —— 订阅本体 ——
- uid: Rdh5i0bdPdAN
  type: remote
  name: EqualVPN
  file: Rdh5i0bdPdAN.yaml
  url: https://<REDACTED>
  option:
    update_interval: 1440        # 每天自动更新 → 不要直接改订阅原文件
    allow_auto_update: true
    merge:   mt0eifGB8lpP        # 右键「扩展覆写配置」
    script:  seAEinyZ6UB3        # 右键「扩展脚本」
    rules:   rOlpyyGLEMXK        # 右键「编辑规则」
    proxies: paFU8lXAdcbY        # 右键「编辑节点」
    groups:  gfzVKzaTSxt1        # 右键「编辑代理组」
```

### 3.2 `profiles/Rdh5i0bdPdAN.yaml`（订阅原文件，节选，不要改）

```yaml
mode: rule
tun:
  enable: true
  stack: mixed                   # 会被 Verge 设置覆盖成 gvisor
  auto-route: true
  auto-detect-interface: true
  dns-hijack:
    - any:53
    - tcp://any:53
skip-proxy:                      # 只对系统代理生效
  - 192.168.0.0/16
  - 10.0.0.0/8
  - 172.16.0.0/12
  - 100.64.0.0/10
rules:
  - GEOSITE,category-ads-all,REJECT
  - GEOIP,PRIVATE,DIRECT,no-resolve
  # …
  - GEOIP,CN,DIRECT
  - MATCH,EqualVPN
```

### 3.3 `profiles/rOlpyyGLEMXK.yaml`（订阅级「编辑规则」）

```yaml
# Profile Enhancement Rules Template for Clash Verge

prepend:
  - IP-CIDR,100.64.0.0/10,DIRECT,no-resolve   # Tailscale 网段直连
  # - RULE-SET,AI,AI-中继-202603              # 依赖 rule-providers，见 1.4
append: []
delete: []
```

### 3.4 `profiles/Merge.yaml`（全局 Merge，节选）

```yaml
# ✅ 生效：深度合并进 tun
tun:
  route-exclude-address:
    - 100.64.0.0/10

# ❌ 2.5.6 不处理以下旧语法，只会作为字面键被原样拼进去
prepend-rule-providers:
  AI: { type: http, behavior: classical, url: <…>, path: ./ruleset/AI.yaml, interval: 86400 }
prepend-rules:
  - RULE-SET,AI,AI-中继-202603
```

### 3.5 `clash-verge.yaml`（生成结果，已验证）

```yaml
mode: rule
tun:
  enable: true
  stack: gvisor                  # ③ Verge 设置覆盖
  auto-route: true
  auto-detect-interface: true
  dns-hijack:
  - any:53
  strict-route: false
  route-exclude-address:         # ② 全局 Merge  ✅
  - 100.64.0.0/10
rules:
- IP-CIDR,100.64.0.0/10,DIRECT,no-resolve   # ① 订阅规则增强  ✅
- GEOSITE,category-ads-all,REJECT
- GEOIP,PRIVATE,DIRECT,no-resolve
# …
```

---

## 4. 配套

- 给孩子讲的版本：[`clash-verge-eli5.html`](./clash-verge-eli5.html)
- SSH skill：`.claude/skills/remote-ssh/SKILL.md`
