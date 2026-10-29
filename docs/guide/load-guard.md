# Load guard for heavy and GUI jobs

The mdpro and picsee wrappers share `~/.cache/mdpro-heavy.lock`. A GUI batch
takes that lock first, then `~/.cache/desktop-gui.lock`, and releases them in
reverse order. A full test or build lane holds the heavy lock for its entire
process group. Focused RED/GREEN runs use `scripts/heavy-lock.sh --guard-only
<command...>`: they are monitored without taking the shared lock and must use
at most two Vitest workers. Guard-only Vitest workers get a 1024 MiB V8 heap;
locked workers get 2048 MiB. A worker heap failure is a test failure.
Locked Vitest runs default to two workers; explicit overrides are capped at
three and at the available core count minus two (minimum one). Cargo test
jobs are capped at cores minus two, respecting a smaller existing limit.

## Admission and runtime

On macOS, `kern.memorystatus_vm_pressure_level` reports libdispatch's
**NORMAL 1**, **WARN 2**, or **CRITICAL 4**. These are not the internal XNU
memorystatus levels. Jetsam does not reliably kill a runaway test worker;
the guard must stop it. Admission requires pressure 1 and available memory
from `kern.memorystatus_level` (a 0–100 percentage of `hw.memsize`) at least
the job-class budget plus 1 GiB. An unreadable or out-of-range level holds a
macOS job until the admission deadline. The older `vm_stat` free + inactive +
purgeable figure is logged beside the new estimate for comparison. The
measured full Vitest coverage budget is 2 GiB (1358.2 MiB peak × 1.2 =
1.592 GiB, rounded up); every other unmeasured class,
including picsee's, starts at 4 GiB. Replace each with measured peak
group RSS plus 20%. Pressure 2 or 4 waits until the shared deadline and then
exits 75 without starting. An unreadable or unexpected pressure value on
macOS acts as WARN and is logged with its raw value on **every** sample. On
other operating systems it starts the job with one note, so Linux CI can run.

During a run, two consecutive pressure-4 samples stop the job. Three samples
of machine CPU busy above 95% stop a wrapped job only
when its process group accounts for more than 80% of busy CPU across those
samples. The wrapper sends TERM to the group, waits the grace period, sends
KILL if needed, and releases the lock after the group is gone. The launchd
backstop checks unregistered test-runner groups only. It never targets a
registered wrapper group or an app/build/signing/agent group.

Any admission sample above 95% CPU busy waits for a cooler sample before
starting the job; the third consecutive high sample also logs a warning.

## Interface for both repositories

| Setting | Meaning |
|---|---|
| `MDPRO_HEAVY_LOCK` | Shared lock directory; default `~/.cache/mdpro-heavy.lock`. |
| `MDPRO_HEAVY_LOCK_WAIT_SECS` | One deadline for lock wait and admission; default 1800. |
| `MDPRO_HEAVY_LOCK_HELD` | Wrapper exports `1` to locked children; nested locked calls run directly. Guard-only clears it. |
| `MDPRO_HEAVY_LOCK_KILL_GRACE_SECS` | TERM grace before KILL; default 10 seconds. |
| `MDPRO_LOAD_GUARD_INTERVAL_SECS` | Runtime sample interval; default 5 seconds. |
| `MDPRO_LOAD_GUARD_SAMPLER` | Executable sampler returning `pressure busy% availableGiB [groupCPU%] [vmStatFreeGiB memorystatusLevel]`; for tests. |
| `MDPRO_LOAD_GUARD_BUDGET_GIB` | Test override for the job-class budget. |
| `MDPRO_LOAD_GUARD_LOG` | JSON-lines log path; default `~/.cache/load-guard.log`. |
| `MDPRO_LOAD_GUARD_ACTIVE` | Registration directory; default `~/.cache/load-guard/active`. |
| `MDPRO_VITEST_WORKER_HEAP_MIB` | Worker heap size; 2048 locked, 1024 guard-only. |
| `VITEST_MAX_WORKERS` | Numeric or percentage override; locked runs clamp it to the measured/CPU cap. |
| `CARGO_BUILD_JOBS` | Cargo-test concurrency; wrapper clamps to cores minus two or a smaller supplied value. |

The wrapper returns the child's exit code on ordinary completion, **64** for
invalid invocation, **75** for refusal or admission deadline, and **76** when
the guard stops a running job. A caller records 76 as an infrastructure stop,
never as a pass or a test failure. There is no immediate retry. At most one
retry is allowed after pressure remains 1 for ten minutes, with fewer workers
or a smaller shard. A second stop goes to the item owner and delegator.

Each log line is JSON with `event` (`admission`, `warn`, `note`, `snapshot`, or `stop`),
`time`, `project`, `cmd`, `cwd`, `readings` (`pressure`, `cpuBusy`, and
`availableGiB`, `vmStatFreeGiB`, `memorystatusLevel`, and `rawPressure` when
unreadable), `reason`, and `topRss`. `topRss` lists up to
eight processes with `pid`, `ppid`, `rssMiB`, `elapsed`, and a redacted,
200-character command line. Environment values are never logged. The
backstop writes at most one `snapshot` per minute while pressure is at least
2. A wrapper writes one `stop` line per stopped job.

## Backstop installation

`python3 scripts/load-guard/install.py install` renders
`com.mdpro.load-guard.plist.in` to
`~/Library/LaunchAgents/com.mdpro.load-guard.plist`; `uninstall` removes only
the managed file. The installer does not load the agent and refuses to
overwrite or remove a foreign plist. After both projects land their wrappers,
the delegator installs and loads the agent under the user-approved operational
barrier. The plist runs `backstop.py --once` every five seconds.
