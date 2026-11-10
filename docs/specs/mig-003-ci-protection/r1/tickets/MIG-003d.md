## Parent

#700 (MIG-003 row). Spec: #752 (r1). Decisions MIG003-r1-D8, D10, D21, D22.

## What to build

The delegator can produce plan §17's CI numbers for any window, locally and read-only.

- `node scripts/ci/metrics.mjs --since <date> --until <date> --label <M0|Mn>`, using only read calls through the user's `gh` auth.
- **Seam**: a pure function from recorded API responses (runs, jobs, attempts, merged-report artifacts) to a metrics object; the CLI fetches and writes.
- **Metrics**: PR wall-clock P50/P90 (`ci.yml` `pull_request` runs, each PR's last head SHA, `run_started_at` to `ci-gate` completion, success and failure only, `cancelled` excluded); queue time (`started_at − created_at`); runner minutes by OS over `ci.yml`, `platform-advisory.yml` and `webkit-advisory.yml`; rerun rate (`run_attempt > 1` per head SHA); test-level flake (failed then passed on the same head SHA) from artifacts, else `unavailable(<n> runs)`; advisory nightly pass rate per workflow.
- **Output**: `~/.mdpro-redesign/metrics/<label>-<date>.json` and a markdown summary beside it. No file content, no repo write, no scheduled workflow.
- **M0**: the window is the four weeks before the first run. The save/flush failure rate is out (MIG-005 #704 or MIG-026).

## Acceptance criteria

- [ ] Fixture cases for each metric, including: a cancelled run excluded from wall-clock; only a PR's last head SHA counted; a rerun counted once in the rerun rate; a flake found from two attempts' reports; expired artifacts reported as `unavailable(n runs)`, never 0; minutes split by runner OS; a workflow with no runs in the window.
- [ ] The CLI refuses a missing or reversed date range and an unknown label form, exit non-zero, writing nothing.
- [ ] A test shows the CLI writes only under the metrics directory and never inside the repo.
- [ ] The script issues no non-GET request (a test over the request layer).
- [ ] The delegator's first run (the M0 baseline) is named in the confirm record, by path outside the repo.
- [ ] Size: about 250 counted production lines.

## Citations (master `ddc60447`)

| Cited | Path and name | Exists | Quoted |
|---|---|---|---|
| §17 metrics | `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` § 指标定义（v1.2） | yes | "PR 墙钟时间 P50/P90 … 从 `run_started_at` 到 `ci-gate` 完成；只计成功或失败结论，`cancelled` 不计入" |
| data source | same, below the table | yes | "数据来源是 GitHub Actions API 与本地结构化日志 `~/.mdpro/mdpro.log` 的事件类型，**不含文件内容**；由谁在何时采集写在 MIG-003 的规格中。" |
| timer-flush | same, 保存 / Flush 失败率 row | yes | "定时器 Flush 的成功目前不记录" |
