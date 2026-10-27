# Backing up session transcripts to Tencent COS

Each week, mdpro's and picsee's agent transcripts are copied to a private Tencent COS bucket. That covers the
Claude Code, Codex and Kimi `.jsonl` files from the delegators, implementors and auditors. The local copies are kept
indefinitely (`cleanupPeriodDays: 36500` in `~/.claude/settings.json`), but they exist on one disk only. The bucket is
the second copy.

The tooling is a personal Claude Code skill, `backup-session`, at `~/.claude/skills/backup-session/`. It is not in this
repository, because it covers picsee too and holds machine-specific paths. This guide covers setting it up, using it
and checking it.

## What gets uploaded, and where

A session belongs to a project when its working directory is that project's main checkout or one of its worktrees.
Anything else is left out: other repositories, `~/.mdpro-redesign/dtrack`, scratchpad probes, and the claude-mem
observer.

```
cos://<bucket>/<project>/<llm>/<role>/<yyyymmdd>/<agent>__<session-id>.jsonl
                                                /<agent>__<session-id>/…   (Claude subagents, Kimi session folders)
```

| Level | Values | Rule |
|---|---|---|
| project | `mdpro`, `picsee` | from `config.json` → `projects` |
| llm | `claude`, `codex`, `kimi` | the tool that wrote the session |
| role | `delegator`, `implementor`, `auditor` | `delegator` = the main checkout (this includes your own direct sessions there); `auditor` = a worktree whose name contains `auditor`; `implementor` = any other worktree |
| date | `yyyymmdd` | the session's first timestamp, local time. A long or resumed session stays under its start date and is re-uploaded as it grows |
| agent | `main`, `gpt-imple-1`, `opus-auditor`, … | the worktree's folder name |

The agent level comes from the worktree, not the model. A Claude session run in `mdpro-wt/gpt-imple-1` is filed as
`claude/implementor/<date>/gpt-imple-1__…`.

At setup on 2026-10-27, mdpro had 358 sessions (770 MiB) and picsee had 502 (1.14 GiB), about 1.9 GB in total.

### Where the source files are

| Tool | Local location | How the project is known |
|---|---|---|
| Claude Code | `~/.claude/projects/<cwd with / and . → ->/<session-id>.jsonl`, plus `<session-id>/` (subagents/, tool-results/) | the folder name, and `cwd` in the lines |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-<start>-<session-id>.jsonl`, filed by date with all projects mixed | `payload.cwd` in the first line |
| Kimi Code | `~/.kimi-code/sessions/wd_<workspace>/session_<id>/` | `workDir` in `~/.kimi-code/session_index.jsonl` |

To find a live herdr agent's file, run `herdr --session <mdpro|picsee> agent list` and take `agent_session.value`.
- **Claude:** the file is `<value>.jsonl` in the project folder for the pane's working directory.
- **Codex:** it is the rollout file ending in `<value>`.

Every pane reset starts a new session, so one agent name has many files. That is why the backup selects by working
directory, never by session id.

## One-time setup

Your Tencent Cloud secret key is entered only by you, in your own terminal. Never paste it into a chat or a file.

### 1. Install COSCLI

Install Tencent's official arm64 release, checked against its published SHA-256:

```bash
cd "$(mktemp -d)" \
  && curl -sSLO https://github.com/tencentyun/coscli/releases/download/v1.0.9/coscli-v1.0.9-darwin-arm64 \
  && curl -sSLO https://github.com/tencentyun/coscli/releases/download/v1.0.9/sha256sum.log \
  && grep 'darwin-arm64$' sha256sum.log | shasum -a 256 -c - \
  && mkdir -p ~/.local/bin \
  && install -m 755 coscli-v1.0.9-darwin-arm64 ~/.local/bin/coscli \
  && ~/.local/bin/coscli --version
```

The output should show `coscli-v1.0.9-darwin-arm64: OK`, then `coscli version v1.0.9`. If the checksum says `FAILED`,
nothing is installed. (Done on the Mac mini, 2026-10-27.)

### 2. Create the bucket

In the [COS console](https://console.cloud.tencent.com/cos), open **存储桶列表 / Bucket List** → **创建存储桶 / Create Bucket**:

| Setting | Value |
|---|---|
| Region | the nearest one, e.g. `ap-shanghai` or `ap-guangzhou` (note it) |
| Name | `mdpro-transcripts`; the console appends `-<APPID>` (note the full name) |
| Access permission (访问权限) | **私有读写 / Private**: transcripts contain code and conversations |
| Server-side encryption (服务端加密) | **SSE-COS** |
| Versioning (版本控制) | off; turn it on only if you need every weekly version of a growing session |
| Storage class | Standard (标准存储); not Archive, because sessions that grow are replaced every week |

### 3. Create an upload-only key

The backup runs with a sub-account that can only upload to this bucket. If that key leaked, it could not read, delete
or touch anything else.

**3a. Policy.** In [CAM → Policies](https://console.cloud.tencent.com/cam/policy), choose **新建自定义策略 / Create Custom
Policy** → **按策略语法创建 / Create by Policy Syntax** → **空白模板 / Blank Template**. Name it
`mdpro-transcripts-upload`. Replace the region and APPID in both `resource` lines:

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "name/cos:PutObject",
        "name/cos:InitiateMultipartUpload",
        "name/cos:UploadPart",
        "name/cos:CompleteMultipartUpload",
        "name/cos:AbortMultipartUpload",
        "name/cos:ListParts",
        "name/cos:ListMultipartUploads",
        "name/cos:HeadObject",
        "name/cos:GetBucket",
        "name/cos:HeadBucket"
      ],
      "resource": [
        "qcs::cos:ap-shanghai:uid/1250000000:mdpro-transcripts-1250000000/*",
        "qcs::cos:ap-shanghai:uid/1250000000:mdpro-transcripts-1250000000/"
      ]
    }
  ]
}
```

The policy grants neither `DeleteObject` nor `GetObject`. `HeadObject` and `GetBucket` let sync skip files that are
already uploaded. To download a backup, use your main account in the console.

**3b. Sub-account.** In [CAM → Users](https://console.cloud.tencent.com/cam), choose **新建用户 / Create User** →
**自定义创建 / Custom** → **可访问资源并接收消息 / Access resources**:
- user name `mdpro-transcripts-uploader`;
- **编程访问 / Programmatic access** only, with no console login;
- the `mdpro-transcripts-upload` policy only.

The last page shows the SecretId and SecretKey once. Keep it open for step 4.

### 4. Configure COSCLI

```bash
~/.local/bin/coscli config init
```

| Prompt | Answer |
|---|---|
| Secret ID / Secret Key | from step 3b |
| Session Token | empty (Enter) |
| Mode | default (Enter) |
| Bucket name | the full name, e.g. `mdpro-transcripts-1250000000` |
| Region / Endpoint | e.g. `ap-shanghai` (or `cos.ap-shanghai.myqcloud.com` if it asks for an endpoint) |
| Alias | **`transcripts`**, exactly. The skill uploads to `cos://transcripts/…` |

If `init` does not ask about a bucket, add it with:

```bash
~/.local/bin/coscli config add -b mdpro-transcripts-1250000000 -r ap-shanghai -a transcripts
```

The config file holds the key in plain text, so make it readable only by you:

```bash
chmod 600 ~/.cos.yaml
~/.local/bin/coscli config show | grep -iv secret
```

Then set `bucket` in `~/.claude/skills/backup-session/config.json` to the full bucket name. The script uses it only
for display; uploads go through the alias.

### 5. Check the key, then upload

1. **Check that the key is upload-only.** Upload one small test file and list the bucket; both must work. Then try
   to delete the test file: COS must refuse.
2. **Upload.** Preview first, then run (examples below). Each project's sync must exit 0.
3. **Schedule.** Install the weekly job (next section).

## Using the skill

`S=~/.claude/skills/backup-session`. With no project named, every project in `config.json` is used.

```bash
/usr/bin/python3 -I $S/scripts/backup_session.py locate mdpro --files   # where each session file is, by role/tool/agent
/usr/bin/python3 -I $S/scripts/backup_session.py plan                   # print the COS tree with sizes; uploads nothing
/usr/bin/python3 -I $S/scripts/backup_session.py run                    # upload
```

- **`plan` and `run` rebuild `~/.backup-session/stage`** each time. It is a tree of hard links to the original
  files, so it takes no disk space.
- **`run` uses `coscli sync -r` without `--delete`.** Nothing in the bucket is ever deleted, so a transcript removed
  locally stays in COS.
- **A session that grew is uploaded again**, replacing the older copy.

**Change detection (tested 2026-10-27).** `coscli sync` compares each local file with its COS object by size and CRC64 content hash before sending anything. It skips an unchanged file, re-uploads one whose size or content changed (even when the size and modification time are equal), uploads a new file, and skips a file whose timestamp alone changed. The second real run uploaded 24 grown sessions and skipped 2,122 files. Each log's `Succeed:` line shows the `upload N files, skip M files` split.

To add a project, put `"<name>": {"main": "<checkout>", "worktrees": "<worktree root>"}` under `projects` in
`config.json`, then run `plan <name>`.

## Weekly schedule (Sunday 03:00)

```bash
S=~/.claude/skills/backup-session
sed "s#__HOME__#$HOME#g" $S/com.user.backup-session.plist.template > ~/Library/LaunchAgents/com.user.backup-session.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.backup-session.plist
launchctl print gui/$(id -u)/com.user.backup-session | head -20
```

- **Logs:** `scripts/scheduled-run.sh` writes one log per run to `~/.backup-session/logs/<yyyymmdd-HHMM>.log`; each
  log ends with `rc=0` on success.
- **A missed run:** if the Mac is asleep at 03:00, launchd runs the job when it wakes.
- **Running it now:** `launchctl kickstart gui/$(id -u)/com.user.backup-session`.
- **Removing it:** `launchctl bootout gui/$(id -u)/com.user.backup-session`, then delete the plist.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `coscli not found at ~/.local/bin/coscli` | step 1 not done, or COSCLI installed elsewhere: fix `coscli` in `config.json` |
| `AccessDenied` on upload | the policy's `resource` lines name the wrong region, APPID or bucket; or the alias points at another bucket (`coscli config show`) |
| Sync re-uploads everything every week | the `HeadObject` / `GetBucket` permissions are missing from the policy |
| A session is missing from `plan` | its working directory is outside the project's `main` and `worktrees` paths; check with `locate --files` and its first lines |
| A new agent lands under the wrong role | the role comes from the worktree name; adjust `auditor_patterns` in `config.json` |
