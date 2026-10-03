---
name: remote-ssh
description: Connect to a remote device over Tailscale SSH — default host is `mac-mini` (Jack's Mac mini). Use when the user asks to ssh / connect / run a command on the mac mini or another tailnet device, or when an SSH to a 100.x address fails (403 banner, permission denied, host key verification failed).
---

# Remote SSH over Tailscale

Default target: **`mac-mini`** — an alias in `~/.ssh/config`:

```
Host mac-mini
    HostName jacks-mac-mini      # MagicDNS → 100.124.189.67
    User jack                    # NOT the local user `jackcheng`
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
```

Use a different host only when the user names one (`$ARGUMENTS` = host alias or
tailnet name; empty → `mac-mini`).

## 1. Preflight (one call)

```bash
tailscale status 2>&1 | head -20; route -n get <host-ip> | grep interface
```

- `Tailscale is stopped.` → run `tailscale up`, then re-check. This is the
  usual cause of failures.
- The peer row says `offline` → stop and tell the user the device is offline.
  Retrying won't help.
- The route interface must be the **Tailscale utun**, not Clash's. Clash TUN
  shows gateway `198.18.0.1`.

## 2. Connect

Non-interactive check (always use `BatchMode` from the agent — a password
prompt would hang):

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 mac-mini 'hostname; whoami'
```

Run a remote command: `ssh -o BatchMode=yes mac-mini '<cmd>'`.
For an interactive shell, tell the user to type `! ssh mac-mini`.

Report `ok` plus the hostname/user on success.

## 3. Failure → cause

| Symptom | Cause | Fix |
|---|---|---|
| `kex_exchange_identification: banner line 0: HTTP/1.1 403` | Traffic went into Clash TUN instead of Tailscale. Usually Tailscale was stopped | `tailscale up`. Clash should exclude `100.64.0.0/10` (see below) |
| `Host key verification failed` | First connection, so the key isn't in `known_hosts` | The alias already sets `accept-new`. For a raw IP add `-o StrictHostKeyChecking=accept-new`. Before trusting the key, compare `ssh-keygen -lF <host>` with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the remote |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | The key changed | **Do not auto-fix.** Ask the user. Run `ssh-keygen -R <host>` only after they confirm the remote was reinstalled |
| `Permission denied (publickey,password,…)` | Wrong user (the local `jackcheng` ≠ the remote `jack`), or the key isn't authorized | Use the alias. Otherwise check `~/.ssh/authorized_keys` on the remote |
| `Could not resolve hostname jacks-mac-mini` | MagicDNS is blocked (Clash `dns-hijack`) | Use the IP from `tailscale status` |

## Clash coexistence

Clash Verge Rev runs a TUN (`utun1`, gateway `198.18.0.1`). The tailnet CGNAT
range is kept out of Clash in two places, both under
`~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/`:

- Global `Merge.yaml` sets `tun.route-exclude-address: [100.64.0.0/10]`. This is
  the main fix: the range never gets a Clash route, in any mode.
- The subscription's 「编辑规则」 file (`rOlpyyGLEMXK.yaml`) has
  `prepend: IP-CIDR,100.64.0.0/10,DIRECT,no-resolve`. This is the fallback in
  rule mode. It is per-subscription, so add it again after switching
  subscriptions. `prepend-rules` inside `Merge.yaml` is ignored by Verge 2.5.6.

To verify, grep the generated `clash-verge.yaml` in that folder for
`100.64.0.0/10`. It should appear under `tun:` and at the top of `rules:`.
Full write-up: `docs/reference/clash-tailscale/clash-verge-tailscale-complete-guide.md`.

## Rules

- Never pass `StrictHostKeyChecking=no`. Never delete `known_hosts` entries without asking.
- Never run destructive commands on the remote (rule 25 applies remotely too).
