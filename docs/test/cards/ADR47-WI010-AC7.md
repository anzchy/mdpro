# Card ADR47-WI010-AC7: probe v1 and the console buffer in the real app

**Controlling ACs** ([plan § WI-010](../../plans/20261002-plan-agent-control-channel.md#wi-010-固定探针-v1-与控制台缓冲), quoted):

> 1. 探针集合有版本号。v1 含：窗口标签列表、每个窗口的前端是否就绪、活动文档、脏标记、视图模式、待确认的提示（ADR-0042 的确认框、`ConfirmDialog`）、控制台与错误缓冲。每个字段写明来源（DOM、Rust 侧、shadow store）。
> 2. 缓冲捕获 `console.error`、`console.warn`、`error`、`unhandledrejection`；每条有递增序号；容量固定，溢出时计数；模块初始化阶段抛的错也在里面。
> 4. 脏标记读自 DOM（由 store 直接渲染），不经 300 ms 防抖的 shadow store。

Brief AC-7 (issue #542 item 1) narrows how these are checked in the real app. This card adds no behaviour.

## Setup
- A verify build of the branch head, built with `MDPRO_RELEASE_ID=<version>-dev@<40-char sha>` (`pnpm control:build
  --profile verify`), and `pnpm control:doctor` clean before launch.
- A copy of `tests/manual-fixtures/d37-small-doc.md` in a fresh temp directory, named `probe.md`.
- The desktop GUI lock held (`gui-lock.sh take`) before the launch, released after cleanup.
- The control token in `control.json` is never printed, logged or reported.

## Steps
1. `cli`: `pnpm control:launch --control on --view-mode source <dir>/probe.md`. Record the ready line and RUN.
2. `cli`: probe `{"kind":"cm"}` through the socket, saved as `wi010-before.json`.
3. `cli`: `click` `.cm-content`, then `type` `" WI010-device-typed"` through the channel.
4. `cli`: probe `{"kind":"cm"}` again, saved as `wi010-after-type.json`.
5. `computer-use`: in the verify app's Web Inspector Console (channel `eval` stays off), enter
   `console.error("ADR47-WI010-device-error")`.
6. `cli`: probe `{}`, saved as `wi010-after-error.json`; read the last `app.ready` line of the run's log; run
   `pnpm control:doctor`.
7. `cli`: `pnpm control:quit <RUN>`, `pnpm control:clean <RUN>`, `pnpm control:doctor`.

## Failure condition
Any of these fails the card:
- step 2 does not show `probeVersion: 1`, `main` in the window labels, ready `true`, Source mode, `probe.md` as the
  active document, and dirty `false`;
- step 4 does not show the same document with dirty `true`, or the typed text is not in the editor;
- step 6's buffer lacks the `ADR47-WI010-device-error` entry, or its sequence number is not greater than every earlier
  entry's, or the earlier entries or the overflow count changed inconsistently;
- `app.ready.releaseId` is not the build's `<version>-dev@<sha>`, or more than one mdpro process runs from the bundle.

A step that cannot be done (focus fails, Web Inspector unavailable) is NOT EXERCISED with the step that stopped it,
never PASS. Channel `eval` is never turned on to work around it.

## Proof
- Log: the `app.ready` line with the expected `releaseId` and the verify build id and pid.
- Effect: the three reply files (token omitted), showing the dirty flip from DOM and the buffered error with its
  sequence number; doctor's output before launch and after cleanup.
