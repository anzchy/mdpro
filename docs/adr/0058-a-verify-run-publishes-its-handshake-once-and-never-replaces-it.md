# 0058. A verify run publishes its handshake once and never replaces it

**Status**: Accepted (2026-10-08, user decision). Builds on
[ADR-0047](./0047-agents-verify-in-the-real-app-through-a-feature-gated-control-channel.md)
decision 3 (one active run, a launcher that proves ownership); does not
supersede it.

## Context

A verify build writes `<RUN>/instance.json` (`{nonce, pid, buildId}`) so the
WI-003 launcher can prove which process it owns before it sends `quit` or
`--via open`. As built in WI-002, the pre-Tauri guard wrote it as the first
statement of `main()`, by temp file and `rename`, replacing whatever was there.

The device check on 2026-10-07 started a second process in the same run, as
journey J7a does on purpose. The second process ran the guard, replaced
`instance.json` with its own pid (36009 → 36146), forwarded its argv to the
primary through tauri-plugin-single-instance, and exited 0. The file then
named a dead pid, so the launcher would have identified the wrong process.

The forces as understood at the time:

- **Which process is the primary is only known after plugin setup.** In
  tauri 2.9.5, `Builder::build()` runs `initialize_plugins` (`app.rs:2291`)
  before the app `.setup` closure runs on `Ready` (`app.rs:1299-1302`); the
  single-instance plugin either exits 0 or claims the socket there.
- **The plugin does not guarantee a single primary.** Its macOS code (2.3.7,
  and 2.5.2 the same) launches normally on any notify error other than
  `NotFound` / `ConnectionRefused`, and on a bind failure.
- **A `.setup` closure that returns `Err` panics.** It cannot report a clean
  refusal.
- Env validation has to stay first in `main()`, before `app.launch` logging
  and draft migration touch the run's `HOME`.

## Decision

Split the guard into validation and publication, and make publication
exclusive.

- `enforce()` stays the first statement of `main()`. It validates the four
  variables and exits 78 with one stderr line on failure. It writes nothing
  and logs nothing.
- `publish_or_exit()` is the first statement of the `.setup` closure. It
  writes `.instance.json.<uuid>.tmp` (create-new, 0600, `sync_all`),
  `hard_link`s it to `instance.json`, and removes the temp on every outcome.
- **An existing entry is refused, never replaced or followed.** A file,
  symlink, dangling symlink or directory at `instance.json` gives
  `instance.json already exists` and exit 78. Any other failure is
  `InstanceWrite` and exit 78. At most one publication per run directory can
  succeed.
- The `app.verify_run` success line is written only after the link exists,
  and the fail line carries `reason` `instance_exists` / `instance_write`.
- A new tdd-guardian lane, `rust-verify-run`, runs `cargo test` with the
  feature on, because the plain `rust` lane never compiles these modules.

## Consequences

- **A run directory is single-use.** The launcher must create a fresh run
  directory per launch and must never pre-create `instance.json`. A retry
  after any failure needs a new directory.
- **A refused process gets further than before.** By the time it reaches
  setup it has logged `app.launch`, run draft migration inside the run
  directory, and may have shown its `main` window briefly (not observed on
  device). It exits from inside setup, which skips `RunEvent::Exit`, so its
  single-instance socket is left behind; the next launch cleans it on
  `ConnectionRefused`, and `doctor` has to report it.
- **The race can invert.** If a process that fell through the plugin
  publishes first, the launcher's own child exits 78. The run fails closed
  and loudly, not silently with the wrong pid.
- A temp file can survive if its removal fails. After a successful link this
  is logged (`app.verify_run.temp_cleanup`) but has no test, because there is
  no fault seam in production code. A removal failure after a failed write is
  not logged. `doctor` / `clean` must handle `.instance.json.*.tmp`.
- **The ordering proof is structural.** No `cargo test` drives Tauri's event
  loop. Tests pin that the publish call is the first statement of `.setup` in
  a builder that registers single-instance, and that the locked versions are
  ones whose source was read. A Tauri or plugin upgrade outside that set fails
  the test and has to be re-read.
- Commits now run both Rust lanes, about 40 s more per commit.
- Evidence: unit and exec tests in `src-tauri/src/services/verify_run_publish_*`;
  device re-check R1–R4 in
  [`docs/test/20261007-adr0047-wi002-device.md`](../test/20261007-adr0047-wi002-device.md) §3.
