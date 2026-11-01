# 0164. 0.3.6 ships macOS and Linux only, and Windows waits for its device batch

## Status

Accepted, 2026-11-01. Decided by the user: 「MacOS如果已经通过了test，先冻结并发布release，Windows的问题后续再处理」, then
「MacOS and Linux only，目前Windows ship卡在什么地方，把bug统一提交一个issue」.
Partially supersedes [ADR-0160](0160-development-continues-on-master-under-a-feature-freeze-until-0-3-6.md) decision 3
for its "once the W036 Windows rerun passes" clause.

## Context

ADR-0160 decision 3 cut 0.3.6 only after two things: the W036 Windows menu rerun passing on a locked SHA, and the 0.3.6
device regression.

On 2026-11-01 the macOS half was done. The RC036 regression passed with zero proven regressions, and the app trees on master
(`src`, `src-tauri`, `package.json`) are byte-identical to its lock `fc61e93c` (`docs/test/20261101-rc-036-macos-device-check.md`).

The Windows half had not started. Every native call of the Windows test driver failed on the host: D342, D343, D344 and D346
were found one per run. Their fix, PR #575, had no passing run of its production route. opus-auditor's assessment
(`~/.mdpro-redesign/herdr-spike/opus-auditor/PR575-assessment.md`) put the next run at about one chance in three of
passing every stage, at a cadence of about half a day to a day per round, before the audit could start.

None of this is a known Windows product defect. It is a missing proof.

The release workflow builds Windows as an optional, installer-only platform. Windows is never in `latest.json`, so
Windows users are not offered in-app updates by this channel. The workflow had no way to leave Windows out of a run.

## Options considered

1. **Ship all platforms and verify Windows later.** Rejected by the user. It would publish a Windows installer whose 0.3.6
   menu work (D261, M3a, M7, D255-windows, D264) was never exercised on Windows.
2. **Run W036b by hand first** (the user performs the cards; the tester reads `mdpro.log`). Recommended by opus-auditor and
   not chosen. It costs the user about an hour at the Windows desk, and it still loses the driver's precise oracles.
3. **Keep the ADR-0160 order and wait for #575 and W036b.** Rejected. It delays the macOS and Linux release by days for a
   platform whose check is blocked on test tooling.
4. **Ship macOS and Linux only, and track Windows in one issue.** Chosen.

## Decision

1. 0.3.6 is cut from `master` once the macOS RC regression has passed on a SHA whose app trees equal the lock. That
   condition holds now.
2. The release run builds no Windows installer. The release workflow gains a `windows` dispatch input, default
   `true`, so that `false` leaves out the Windows build row. Every other check stays as it is.
3. Everything that blocks a Windows release goes in [#582](https://github.com/anzchy/mdpro/issues/582):
   - the six W036b cards;
   - PR #575 (D342–D346) and its device run 3;
   - D336–D338 verification;
   - D348, D351, D352 and D353.
4. Windows ships again in the first release after #582's exit condition holds: #575 landed with its smoke PASS, W036b on
   a verified Windows build of that release's SHA, and any product FAIL fixed.
5. ADR-0160's other decisions stand: the feature freeze, and the post-0.3.6 order of #558–#563 and #556 solutions 6, 7 and 8.
   The freeze lifts on the user's word after 0.3.6 ships, not by this record.

## Consequences

- macOS and Linux users get 0.3.6 now.
- Windows users stay on 0.3.5. They miss the 0.3.6 fixes and menu work until a later release, and nothing in the app tells
  them a newer version exists for other platforms.
- The release notes must say that 0.3.6 has no Windows installer, or Windows users will look for one.
- A release-tooling change (a new workflow input) lands during the freeze, at High tier. It adds one more audited PR in
  front of the cut.
- The 0.3.6 Windows menu work stays unverified on Windows. If W036b later finds a product failure, it is fixed in the next
  release, not in 0.3.6.
- A release that omits a platform is now an ordinary dispatch. That makes it easier to skip a platform's verification by
  choice. Each such omission needs its own recorded decision.
