use crate::models::{LogEntryPayload, LogSettings, UserPreferences};
use crate::services::prefs_guard::{GuardError, PrefsGuard};
use crate::services::{logger, preferences};

/// Maximum serialized payload size in bytes (64 KB).
/// Prevents disk-filling attacks from a compromised frontend.
const MAX_LOG_PAYLOAD_BYTES: usize = 64 * 1024;

#[tauri::command]
pub async fn log_event(payload: LogEntryPayload) -> Result<(), String> {
    // Validate payload size to prevent log injection / disk-filling (fixes #316)
    let serialized = serde_json::to_string(&payload)
        .map_err(|e| format!("Failed to serialize log payload: {}", e))?;
    if serialized.len() > MAX_LOG_PAYLOAD_BYTES {
        return Err(format!(
            "Log payload too large: {} bytes (max {})",
            serialized.len(),
            MAX_LOG_PAYLOAD_BYTES
        ));
    }
    logger::log_event(payload);
    Ok(())
}

#[tauri::command]
pub async fn get_logging_settings() -> Result<LogSettings, String> {
    let prefs = preferences::load_preferences()
        .map_err(|e| format!("Failed to load logging settings: {:?}", e))?;
    Ok(prefs.logging)
}

/// Performs the logging-settings read-modify-write synchronously:
/// load preferences → struct-update the `logging` field → `save_preferences`
/// → update the in-process logger settings cache.
///
/// Split out of [`set_logging_settings`] so the cycle is a plain synchronous
/// function: the whole sequence is one unit, and `logger::set_log_settings`
/// stays *inside* it so the disk write and the in-process cache never diverge.
/// The `#[tauri::command]` wrapper is a one-line delegate and holds no logic.
///
/// A failing `load_preferences()` is propagated rather than being swallowed by
/// `unwrap_or_default()`: falling back to defaults here would rewrite the
/// user's entire config.json from defaults on the strength of one unreadable or
/// corrupt file, silently discarding every other preference. Failing loudly
/// leaves the existing file untouched.
///
/// `set_preferences` and `save_window_state` used to diverge on this and no
/// longer do — ADR-0031 step 1 replaced both `unwrap_or_default()` calls with
/// `?`. One difference remains, and it is this function's inaccuracy rather
/// than theirs: the `map_err` below re-labels **every** load failure as
/// `IoError`, including a serde failure that `load_preferences` reports as
/// `ParseError` (`services/preferences.rs:74`). The two sibling commands
/// propagate the native variant. Correcting this one is pre-existing work that
/// ADR-0031 step 1 deliberately left out of scope.
///
/// # Locking
///
/// The entire read-modify-write is serialised on `preferences_rw_lock()`, held
/// as a `PrefsGuard` — the same guard `set_preferences` and `save_window_state`
/// take, all writing the same `~/.mdpro/config.json`. A single `guard` binding
/// spans `load_preferences_locked`, the struct update, `save_preferences` **and**
/// `logger::set_log_settings`; narrowing it to a subset reintroduces the lost
/// update, because another writer could then interleave inside this
/// function's read→write window and have its change silently discarded.
///
/// **Lock ordering: `preferences_rw_lock` first, then the logger
/// settings-cache mutex** (`services/logger.rs::settings_cache`, taken inside
/// `set_log_settings`). There is no inverse ordering anywhere and therefore no
/// deadlock: `services/logger.rs` takes neither `preferences_rw_lock` nor a
/// `PrefsGuard`, and never calls the preferences loader. Its first-use
/// initialisation reads `config.json` lock-free and read-only
/// (`read_initial_logging`, M1a WI-1), so it cannot wait on, or be refused by,
/// the guard held here. That fact is what makes holding this guard across
/// `set_log_settings` safe, and it is why the disk write and the in-process
/// cache update can be one atomic unit.
///
/// The guard is never held across an `.await` — this function is synchronous,
/// which is precisely why the read-modify-write was extracted out of the
/// `async` command in the first place.
fn apply_logging_settings(
    settings: LogSettings,
) -> Result<LogSettings, preferences::PreferencesError> {
    (|| {
        // GS-1 — REVIEW-ENFORCED INVARIANT, NOT COVERED BY ANY TEST.
        //
        // This guard must dominate ALL FOUR of the steps below: the load, the
        // struct update, the save, and `set_log_settings`. Do not narrow it to
        // the load — e.g. `let current = { let _lock = ...; load()? };` — even
        // though that shape is what a `locked_load()` extraction across the four
        // sibling writers would naturally produce. Narrowing it reintroduces the
        // lost update this function exists to prevent.
        //
        // Nothing will tell you if you break it. Verified by mutation on
        // 2026-09-16: the load-only shape keeps R1-R6 green (8/8 passed),
        // including R5, which says so in its own doc comment. An executable
        // witness was then attempted and DISCARDED after measuring 0/10
        // detection — a competing writer must re-read under the lock to be
        // correct, and that re-read means it can never finish inside the window
        // between this closure's unlock-after-load and its save. Catching it
        // needs a pause hook in production code, which is a worse trade than
        // this comment. Do not re-attempt it without reading that result first:
        // docs/adr/0005-lock-span-invariant-is-review-enforced.md.
        let guard = PrefsGuard::acquire().map_err(|e| match e {
            GuardError::Poisoned => preferences::PreferencesError::IoError {
                message: "preferences lock poisoned".to_string(),
            },
            GuardError::Reentrant => preferences::PreferencesError::ReentrantLoad,
        })?;
        let current = preferences::load_preferences_locked(&guard).map_err(|e| {
            preferences::PreferencesError::IoError {
                message: format!("Failed to load preferences: {:?}", e),
            }
        })?;
        let next = UserPreferences {
            logging: settings.clone(),
            ..current
        };
        preferences::save_preferences(&next)?;
        logger::set_log_settings(settings.clone());
        Ok(settings)
    })()
}

/// Persists the frontend's logging settings and applies them to the running
/// logger.
///
/// This is the IPC surface only — the whole read-modify-write lives in the
/// private synchronous [`apply_logging_settings`], to which this delegates in
/// one line. Behavior, signature, and error mapping are unchanged by that
/// split.
#[tauri::command]
pub async fn set_logging_settings(
    settings: LogSettings,
) -> Result<LogSettings, preferences::PreferencesError> {
    apply_logging_settings(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LogLevel;
    use crate::HOME_LOCK;

    // -----------------------------------------------------------------------
    // WI-4-E — `get_logging_settings` through the real load path.
    //
    // Nothing is mocked: real $HOME, real config.json on disk, real serde, real
    // command function. Isolated under a temporary $HOME so the test never
    // touches the developer's own ~/.mdpro/config.json. The HOME_LOCK /
    // HomeRestorer / temp_home idiom is copied from services/preferences.rs,
    // whose test helpers are private to their own module.
    // -----------------------------------------------------------------------

    struct HomeRestorer(Option<String>);
    impl Drop for HomeRestorer {
        fn drop(&mut self) {
            match &self.0 {
                Some(v) => unsafe { std::env::set_var("HOME", v) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    /// SAFETY: caller must hold HOME_LOCK for the lifetime of the guard.
    fn set_home(path: &std::path::Path) -> HomeRestorer {
        let prev = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", path.to_str().expect("temp dir path is non-UTF-8")) };
        HomeRestorer(prev)
    }

    fn temp_home(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join("mdpro_logging_cmd_test")
            .join(format!("{label}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes a real config.json under `home` whose `logging` block is exactly
    /// `logging_json`, leaving every other field at its default.
    ///
    /// The document is built by round-tripping `UserPreferences::default()`
    /// through serde rather than hand-writing a literal: that keeps the file
    /// complete and correctly cased automatically as fields are added, so a
    /// failure here can only be about logging.
    fn write_config_with_logging(home: &std::path::Path, logging_json: serde_json::Value) {
        let dir = home.join(".mdpro");
        std::fs::create_dir_all(&dir).unwrap();
        let mut v = serde_json::to_value(UserPreferences::default()).unwrap();
        v["logging"] = logging_json;
        std::fs::write(dir.join("config.json"), serde_json::to_string(&v).unwrap()).unwrap();
    }

    /// Restores the process-global logger settings cache
    /// (`services/logger.rs::settings_cache`) on drop.
    ///
    /// A `Drop` guard rather than a trailing statement: an assertion panic must
    /// not leak a disabled logger into every later test in this binary.
    struct LoggerSettingsRestorer(LogSettings);
    impl Drop for LoggerSettingsRestorer {
        fn drop(&mut self) {
            logger::set_log_settings(self.0.clone());
        }
    }

    /// Captures the logger settings cache for later restoration.
    ///
    /// Must be called *after* `set_home`. Known, accepted residue: if the cache
    /// has not been initialised yet, reading it initialises it from the **temp**
    /// config. Capturing before `set_home` would be worse — it would make
    /// `load_preferences()` materialise a config file in the developer's real
    /// `~/.mdpro/`.
    fn capture_logger_settings() -> LoggerSettingsRestorer {
        LoggerSettingsRestorer(logger::get_log_settings())
    }

    /// Writes a real config.json under `home` from `UserPreferences::default()`,
    /// overriding the `logging` block (when given) and `autoSaveInterval`.
    ///
    /// `autoSaveInterval` is the unrelated-field witness: any implementation
    /// that persists a fresh `UserPreferences::default()` instead of a
    /// struct-update over the loaded value loses it.
    fn write_config_with_interval(
        home: &std::path::Path,
        logging_json: Option<serde_json::Value>,
        auto_save_interval: u32,
    ) {
        let dir = home.join(".mdpro");
        std::fs::create_dir_all(&dir).unwrap();
        let mut v = serde_json::to_value(UserPreferences::default()).unwrap();
        if let Some(logging) = logging_json {
            v["logging"] = logging;
        }
        v["autoSaveInterval"] = serde_json::json!(auto_save_interval);
        std::fs::write(dir.join("config.json"), serde_json::to_string(&v).unwrap()).unwrap();
    }

    /// Reads `$HOME/.mdpro/config.json` as a parsed `serde_json::Value`.
    ///
    /// Never compare the raw bytes: `UserPreferences::window_states` is a
    /// `HashMap`, whose serialisation order is not stable across instances.
    fn read_config_value(home: &std::path::Path) -> serde_json::Value {
        let raw = std::fs::read_to_string(home.join(".mdpro").join("config.json"))
            .expect("config.json must exist after a successful apply");
        serde_json::from_str(&raw).expect("config.json must be valid JSON")
    }

    // -----------------------------------------------------------------------
    // R1 / R2 — the write-then-read round-trip law for the logging-settings
    // read-modify-write. Characterization tests: green before the WI-1
    // extraction and green after it, so the refactor has a net that was
    // already proven to hold.
    // -----------------------------------------------------------------------

    /// Case R1 — round-trip law (S5): the `LogSettings` handed to the
    /// read-modify-write is exactly what `get_logging_settings` subsequently
    /// yields, via the `logging` field of `~/.mdpro/config.json`.
    ///
    /// The witness `(false, Warn)` differs from `LogSettings::default()` in
    /// **both** fields, so no defaults fallback can satisfy it; the pre-written
    /// config holds `(true, Info)`, so a body that persists nothing reads the
    /// old values back and fails. Asserted at Level 1 (return value) *and*
    /// Level 2 (re-read through the real load path) — Level 1 alone passes an
    /// implementation that never persists, Level 2 alone passes one that
    /// persists and returns junk. `LogSettings` has no `PartialEq`
    /// (`models/log_entry.rs:60`), so fields are compared separately.
    #[tokio::test]
    // HOME_LOCK guards the process-global $HOME env var, so it cannot be released before the await.
    #[allow(clippy::await_holding_lock)]
    async fn applying_logging_settings_round_trips_through_get_logging_settings() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("apply_roundtrip");
        let _home_guard = set_home(&home);
        let _logger_guard = capture_logger_settings();

        write_config_with_interval(
            &home,
            Some(serde_json::json!({ "enabled": true, "level": "info" })),
            111,
        );

        let written = apply_logging_settings(LogSettings {
            enabled: false,
            level: LogLevel::Warn,
        })
        .expect("applying valid logging settings must succeed");

        assert!(
            !written.enabled,
            "the applied enabled=false must be the value handed back"
        );
        assert_eq!(
            written.level,
            LogLevel::Warn,
            "the applied level=warn must be the value handed back"
        );

        let read_back = get_logging_settings()
            .await
            .expect("reading the settings back must succeed");

        assert!(
            !read_back.enabled,
            "enabled=false must survive the round-trip through config.json"
        );
        assert_eq!(
            read_back.level,
            LogLevel::Warn,
            "level=warn must survive the round-trip through config.json"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Case R2 — the write lands in the `logging` field specifically (S1), and
    /// disturbs nothing else.
    ///
    /// Three Level-2 assertions against the parsed config.json document:
    /// the JSON key (`logging`), the wire casing (`"warn"` lowercase — the
    /// `#[serde(rename_all = "lowercase")]` contract the TypeScript `levelRank`
    /// lookup depends on), and the load-bearing one, `autoSaveInterval == 111`,
    /// which fails for any implementation that writes a fresh
    /// `UserPreferences::default()` with the logging block attached instead of
    /// a struct-update over the loaded preferences.
    ///
    /// The document is parsed to `serde_json::Value` and compared field-wise —
    /// never byte-wise, because `window_states` is a `HashMap`.
    // The unit under test is the synchronous helper and nothing here awaits, so
    // this is a plain `#[test]`; HOME_LOCK is never held across an await.
    #[test]
    fn applying_logging_settings_writes_the_logging_field_and_preserves_the_rest() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("apply_field");
        let _home_guard = set_home(&home);
        let _logger_guard = capture_logger_settings();

        write_config_with_interval(&home, None, 111);

        apply_logging_settings(LogSettings {
            enabled: false,
            level: LogLevel::Warn,
        })
        .expect("applying valid logging settings must succeed");

        let v = read_config_value(&home);

        assert_eq!(
            v["logging"]["enabled"],
            serde_json::json!(false),
            "the write must land in the `logging` field of config.json"
        );
        assert_eq!(
            v["logging"]["level"],
            serde_json::json!("warn"),
            "the level must serialise lowercase — the TS levelRank lookup depends on it"
        );
        assert_eq!(
            v["autoSaveInterval"],
            serde_json::json!(111),
            "an unrelated preference must survive the logging write (no defaults clobber)"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Compile-time tripwire for the "exhaustive" claim in R4/R6.
    ///
    /// `ALL_LOG_LEVELS` is a hand-written array, so adding a fifth `LogLevel`
    /// variant would silently shrink the supposedly-complete domain to a
    /// subset. This `match` has no wildcard arm, so that addition fails to
    /// compile here and forces the array to be updated with it.
    const ALL_LOG_LEVELS: [LogLevel; 4] = [
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ];
    #[allow(dead_code)]
    fn log_level_domain_is_complete(level: LogLevel) {
        match level {
            LogLevel::Debug | LogLevel::Info | LogLevel::Warn | LogLevel::Error => {}
        }
    }

    /// The complete `LogSettings` domain: `{bool} × {4 levels}` = 8 values.
    ///
    /// Small enough that exhaustive enumeration (S6) is strictly stronger than
    /// sampled property generation, which is why no property library is needed.
    fn all_log_settings() -> Vec<LogSettings> {
        let mut out = Vec::with_capacity(8);
        for enabled in [true, false] {
            for level in ALL_LOG_LEVELS {
                out.push(LogSettings { enabled, level });
            }
        }
        out
    }

    /// Case R3 — a corrupt config.json makes the apply fail **and** change
    /// nothing. This is the case that makes WI-1's "`unwrap_or_default()` is
    /// NOT introduced" criterion observable.
    ///
    /// S3: the equivalence class "config.json exists but does not parse as
    /// `UserPreferences`", witnessed by a truncated document.
    ///
    /// Copying the `preferences.rs:41` `unwrap_or_default()` idiom here would
    /// make the apply *succeed* and overwrite the user's entire config with
    /// defaults — a rule-60 data-loss path. That implementation goes green on
    /// R1/R2/R4 and is caught only here.
    ///
    /// Level 1 (error variant + message prefix) plus Level 2 ×2 (file bytes
    /// unchanged, logger cache unchanged) — the all-or-nothing law for a load
    /// failure. Byte comparison of config.json is safe in this one case
    /// precisely because the assertion is that *nothing rewrote the file*.
    #[test]
    fn apply_logging_settings_fails_on_corrupt_config_and_changes_neither_disk_nor_cache() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("corrupt_config");
        let _home_guard = set_home(&home);
        let _logger_guard = capture_logger_settings();

        let dir = home.join(".mdpro");
        std::fs::create_dir_all(&dir).unwrap();
        let config = dir.join("config.json");
        // Truncated on purpose: no closing braces, so serde cannot parse it.
        let corrupt = br#"{"autoSaveInterval": 111, "logging": {"enabled": true, "level": "NOPE"}"#;
        std::fs::write(&config, corrupt).unwrap();

        let bytes_before = std::fs::read(&config).unwrap();
        let cache_before = logger::get_log_settings();

        let result = apply_logging_settings(LogSettings {
            enabled: false,
            level: LogLevel::Warn,
        });

        match result {
            Ok(s) => panic!(
                "a corrupt config.json must not be parsed around or overwritten; \
                 apply returned Ok({:?}, {:?})",
                s.enabled, s.level
            ),
            Err(err) => assert!(
                matches!(
                    &err,
                    preferences::PreferencesError::IoError { message }
                        if message.starts_with("Failed to load preferences:")
                ),
                "load failure must map to IoError with the pinned message prefix; got {:?}",
                err
            ),
        }

        assert_eq!(
            std::fs::read(&config).unwrap(),
            bytes_before,
            "a failed apply must leave config.json byte-identical — no defaults clobber"
        );

        let cache_after = logger::get_log_settings();
        assert_eq!(
            cache_after.enabled, cache_before.enabled,
            "a failed apply must leave the logger cache enabled flag untouched"
        );
        assert_eq!(
            cache_after.level, cache_before.level,
            "a failed apply must leave the logger cache level untouched"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Restores directory permissions **and** the logger settings cache on drop.
    ///
    /// Both restorations live in one guard, as R3b's cleanup obligation
    /// requires: an assertion panic between the `chmod` and the restore would
    /// otherwise leave a non-writable directory behind, and the `remove_dir_all`
    /// in global cleanup contract 4 would then fail *silently*.
    #[cfg(unix)]
    struct DirPermsAndLoggerRestorer {
        dir: std::path::PathBuf,
        mode: u32,
        settings: LogSettings,
    }

    #[cfg(unix)]
    impl Drop for DirPermsAndLoggerRestorer {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.dir, std::fs::Permissions::from_mode(self.mode));
            logger::set_log_settings(self.settings.clone());
        }
    }

    #[cfg(unix)]
    fn set_dir_mode(dir: &std::path::Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode))
            .expect("changing the temp dir mode must succeed");
    }

    /// Case R3b — a failing **save** changes neither the cache nor the disk.
    ///
    /// S3: the equivalence class "config.json loads cleanly but cannot be
    /// written" — a different class from R3's "cannot be read". R3's failure
    /// occurs at the *load* and returns before either write, so R3 cannot see
    /// the ordering of `save_preferences` and `logger::set_log_settings`. This
    /// case is the only one that can: an implementation that updates the cache
    /// **before** the save returns `Err` and still leaves the in-process logger
    /// disagreeing with disk for the rest of the session.
    ///
    /// The write is made to fail by making `$HOME/.mdpro` non-writable, so
    /// `save_preferences`' temp-file creation (`preferences.rs:101`) fails.
    #[cfg(unix)]
    #[test]
    fn apply_logging_settings_leaves_cache_and_disk_untouched_when_the_save_fails() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("save_fails");
        let _home_guard = set_home(&home);

        write_config_with_interval(
            &home,
            Some(serde_json::json!({ "enabled": true, "level": "info" })),
            111,
        );

        let dir = home.join(".mdpro");
        let cache_before = logger::get_log_settings();
        let _restore = DirPermsAndLoggerRestorer {
            dir: dir.clone(),
            mode: 0o700,
            settings: cache_before.clone(),
        };

        set_dir_mode(&dir, 0o500);

        // Root ignores the write bit. Skip rather than assert a guarantee the
        // platform is not providing; asserting here would fail for a reason
        // that has nothing to do with the code under test.
        let probe = dir.join(".writability_probe");
        if std::fs::File::create(&probe).is_ok() {
            let _ = std::fs::remove_file(&probe);
            // Say so on the way out. `cargo test` prints "ok" for a test that
            // returns early, so a vacuous run is otherwise indistinguishable
            // from a real pass — and this case is the ONLY witness for
            // `save_preferences` preceding `set_log_settings`. Without this
            // line, a root container silently drops that coverage and the run
            // still reads green.
            eprintln!(
                "SKIPPED apply_logging_settings_leaves_cache_and_disk_untouched_when_the_save_fails: \
                 {} is still writable at mode 0o500 (running as root?), so the save cannot be made \
                 to fail. Save-vs-cache ordering is UNVERIFIED in this run.",
                dir.display()
            );
            return;
        }

        let result = apply_logging_settings(LogSettings {
            enabled: false,
            level: LogLevel::Warn,
        });

        assert!(
            matches!(result, Err(preferences::PreferencesError::IoError { .. })),
            "an unwritable config dir must surface as IoError, never a swallowed Ok"
        );

        let cache_after = logger::get_log_settings();
        assert_eq!(
            cache_after.enabled, cache_before.enabled,
            "a failed save must not have already mutated the logger cache enabled flag"
        );
        assert_eq!(
            cache_after.level, cache_before.level,
            "a failed save must not have already mutated the logger cache level"
        );

        // Restore write access so the disk half can be read back. The Drop
        // guard above still covers the panic path; this is additional, not a
        // replacement for it.
        set_dir_mode(&dir, 0o700);

        let on_disk = preferences::load_preferences();
        assert!(
            on_disk.is_ok(),
            "the seeded config must still be readable after a failed save; got {:?}",
            on_disk.err()
        );
        let logging = on_disk.expect("checked immediately above").logging;
        assert!(
            logging.enabled,
            "a failed save must leave the seeded enabled=true on disk"
        );
        assert_eq!(
            logging.level,
            LogLevel::Info,
            "a failed save must leave the seeded level=info on disk"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Case R4 (+ Case R6 folded in) — exhaustive round-trip, idempotence, and
    /// disk/cache agreement over the complete 8-value `LogSettings` domain.
    ///
    /// S6: all of `{enabled: bool} × {4 LogLevel variants}`, iterated in
    /// sequence so each row starts from the *previous* row's persisted state —
    /// this exercises the overwrite transition, not just a first write.
    ///
    /// Three relations are asserted per row:
    /// 1. **round-trip** — the applied value is what `load_preferences` yields;
    /// 2. **idempotence** — `apply ∘ apply == apply`, compared as two parsed
    ///    config snapshots;
    /// 3. **disk/cache agreement (R6)** — `logger::get_log_settings()` equals
    ///    the applied value, plus the Level-4 behavioural form
    ///    `should_log(Error) == v.enabled`, which states the user-visible
    ///    consequence (whether records actually flow) rather than the storage
    ///    detail.
    ///
    /// Relation 3 is folded in here rather than written standalone because it
    /// iterates exactly the same domain, which lifts R6 from S5 to S6 for free.
    /// It is load-bearing: relations 1 and 2, like R1 and R2, read back through
    /// **disk**, so deleting `logger::set_log_settings` from the helper passes
    /// all of them. Relation 3 is the only assertion in this file that reads
    /// the cache on a success path.
    #[test]
    fn apply_logging_settings_round_trips_and_is_idempotent_across_the_whole_settings_domain() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("exhaustive");
        let _home_guard = set_home(&home);
        let _logger_guard = capture_logger_settings();

        write_config_with_interval(&home, None, 111);

        let domain = all_log_settings();
        assert_eq!(
            domain.len(),
            8,
            "the LogSettings domain must be the complete 2 x 4 product"
        );

        for v in domain {
            let first = apply_logging_settings(v.clone());
            assert!(
                first.is_ok(),
                "apply must succeed for ({}, {:?}); got {:?}",
                v.enabled,
                v.level,
                first.err()
            );
            let returned = first.expect("checked immediately above");
            assert_eq!(
                returned.enabled, v.enabled,
                "returned enabled must equal the applied value for {:?}",
                v.level
            );
            assert_eq!(
                returned.level, v.level,
                "returned level must equal the applied value for enabled={}",
                v.enabled
            );

            // Relation 1 — round-trip through the real load path.
            let loaded = preferences::load_preferences();
            assert!(
                loaded.is_ok(),
                "config must stay loadable after applying ({}, {:?}); got {:?}",
                v.enabled,
                v.level,
                loaded.err()
            );
            let persisted = loaded.expect("checked immediately above").logging;
            assert_eq!(
                persisted.enabled, v.enabled,
                "persisted enabled must round-trip for {:?}",
                v.level
            );
            assert_eq!(
                persisted.level, v.level,
                "persisted level must round-trip for enabled={}",
                v.enabled
            );

            // Relation 3 (R6) — the in-process cache must agree with disk.
            let cached = logger::get_log_settings();
            assert_eq!(
                cached.enabled, v.enabled,
                "logger cache enabled must match the applied value for {:?} \
                 (is logger::set_log_settings still inside the helper?)",
                v.level
            );
            assert_eq!(
                cached.level, v.level,
                "logger cache level must match the applied value for enabled={} \
                 (is logger::set_log_settings still inside the helper?)",
                v.enabled
            );

            // Relation 3, Level-4 behavioural form: whether records actually
            // flow. `should_log(Error)` reduces to `enabled` for every level,
            // since Error outranks all of them.
            if v.level != LogLevel::Error {
                assert_eq!(
                    logger::should_log(LogLevel::Error),
                    v.enabled,
                    "error records must flow exactly when logging is enabled, for {:?}",
                    v.level
                );
            }

            // Relation 2 — idempotence.
            let snapshot_once = read_config_value(&home);
            let second = apply_logging_settings(v.clone());
            assert!(
                second.is_ok(),
                "re-applying ({}, {:?}) must also succeed; got {:?}",
                v.enabled,
                v.level,
                second.err()
            );
            let snapshot_twice = read_config_value(&home);
            assert_eq!(
                snapshot_once, snapshot_twice,
                "re-applying an already-applied value must change nothing, for ({}, {:?})",
                v.enabled, v.level
            );
            assert_eq!(
                snapshot_twice["autoSaveInterval"],
                serde_json::json!(111),
                "an unrelated preference must survive every row, incl. ({}, {:?})",
                v.enabled,
                v.level
            );
        }

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Case R5 — the Defect-1 regression test: a concurrent locked writer's
    /// change must not be clobbered by the logging read-modify-write, and the
    /// logging change must survive too.
    ///
    /// S5, the conservation law (no lost update), on the single interleaving
    /// that can violate it. Asserting **both** surviving writes is what makes
    /// this a conservation claim — asserting only `logging.enabled == false`
    /// would pass an implementation that serialises by dropping the other
    /// writer.
    ///
    /// Shape (deviating from it makes this a race rather than a reproducer):
    /// the main thread takes `preferences_rw_lock` and snapshots preferences
    /// *before the worker exists*, then lets the worker attempt its whole RMW,
    /// then writes its stale snapshot and only then releases the guard.
    /// - **Unfixed**: the worker's RMW completes immediately, writing
    ///   `{111, false/warn}`; the stale save then puts `{222, true/info}` over
    ///   it. Final file has `logging.enabled == true` → RED on a lost update.
    /// - **Fixed**: the worker blocks on the lock, the poll burns its full
    ///   upper bound, the stale save lands, the guard drops, and the worker
    ///   then re-reads `222` and writes `{222, false/warn}` → GREEN.
    ///
    /// Deadlock check: the main thread never calls `apply_logging_settings`
    /// (`std::sync::Mutex` is not reentrant). It holds a `PrefsGuard` and
    /// calls `load_preferences_locked(&guard)` / `save_preferences`, neither of
    /// which takes the lock. (M1a WI-1: the public `load_preferences()` now
    /// takes it, so this test no longer calls that one under the guard.)
    ///
    /// **What this does NOT pin**: guard *span*. A guard scoped to the load
    /// alone, with `save_preferences` left outside, passes this green. Span is
    /// carried by review criterion GS-1, not by this case.
    ///
    /// No `unwrap()` / `expect()` / `assert!` executes anywhere inside the
    /// `_prefs_lock` scope: `std::sync::Mutex` poisoning is irreversible for the
    /// whole test binary, and one panic under this guard would make
    /// `commands/preferences.rs:36` and `commands/window.rs:102` return
    /// `IoError { "preferences lock poisoned" }` for every subsequent test in
    /// the process. Results are collected and asserted after the guard drops.
    #[test]
    fn set_logging_settings_does_not_clobber_a_concurrent_preference_write() {
        use std::time::{Duration, Instant};

        // Both constants are an **upper bound with early exit**, never a sleep:
        // the poll below breaks the moment the worker's write is observed. A
        // slow machine therefore cannot turn a correct implementation red. If
        // unfixed code ever fails to go red on 10/10 runs, raise this bound —
        // never lower it.
        const POLL_MS: u64 = 5;
        const WORKER_RMW_OBSERVE_TIMEOUT_MS: u64 = 1000;

        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("lost_update");
        let _home_guard = set_home(&home);
        let _logger_guard = capture_logger_settings();

        write_config_with_interval(
            &home,
            Some(serde_json::json!({ "enabled": true, "level": "info" })),
            111,
        );
        let config_path = home.join(".mdpro").join("config.json");

        let (started_tx, started_rx) = std::sync::mpsc::channel::<()>();
        // Retained per the case's step 3; detection is done by polling the file
        // (step 4), which is the observable the lost update actually concerns.
        let (done_tx, _done_rx) = std::sync::mpsc::channel::<()>();

        let save_res;
        let handle;
        {
            // Taking the guard cannot panic under it: a refusal panics before
            // anything is held.
            let Ok(_prefs_lock) = crate::services::prefs_guard::PrefsGuard::acquire() else {
                panic!("the preferences lock must be free and unpoisoned");
            };

            // Non-panicking bind: the guard is dropped *before* any panic, so a
            // bad seed fails this test without poisoning the lock for the rest
            // of the binary.
            let load_res = preferences::load_preferences_locked(&_prefs_lock);
            let Ok(mut snapshot) = load_res else {
                drop(_prefs_lock);
                panic!("seed config must load");
            };

            handle = std::thread::spawn(move || {
                let _ = started_tx.send(());
                let r = apply_logging_settings(LogSettings {
                    enabled: false,
                    level: LogLevel::Warn,
                });
                let _ = done_tx.send(());
                r
            });

            // Blocking, no timeout: removes thread-spawn latency from the
            // observation budget below.
            let _ = started_rx.recv();

            let deadline = Instant::now() + Duration::from_millis(WORKER_RMW_OBSERVE_TIMEOUT_MS);
            while Instant::now() < deadline {
                // Total: any read or parse failure counts as "not yet observed"
                // rather than as an error, so this cannot panic under the guard.
                let observed = std::fs::read_to_string(&config_path)
                    .ok()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                    .map(|v| v["logging"]["enabled"] == serde_json::json!(false))
                    .unwrap_or(false);
                if observed {
                    break;
                }
                std::thread::sleep(Duration::from_millis(POLL_MS));
            }

            // Mutate the *stale* snapshot and write it. Result stored, not
            // asserted — asserting here would panic under the guard.
            snapshot.auto_save_interval = 222;
            save_res = preferences::save_preferences(&snapshot);
        } // `_prefs_lock` drops here, and only here.

        // Joined before `_home_guard` / HOME_LOCK drop: a worker still running
        // after $HOME is restored would write the developer's real
        // ~/.mdpro/config.json.
        let worker_res = handle.join();

        assert!(
            save_res.is_ok(),
            "the concurrent locked writer's save must succeed; got {:?}",
            save_res.err()
        );

        let applied = match worker_res {
            Err(_) => panic!("the worker thread panicked"),
            Ok(inner) => inner,
        };
        assert!(
            applied.is_ok(),
            "the worker's apply must succeed; got {:?}",
            applied.err()
        );
        let applied = applied.expect("checked immediately above");
        assert!(!applied.enabled, "the worker must report enabled=false");
        assert_eq!(
            applied.level,
            LogLevel::Warn,
            "the worker must report level=warn"
        );

        let final_doc = read_config_value(&home);
        assert_eq!(
            final_doc["autoSaveInterval"],
            serde_json::json!(222),
            "the concurrent writer's autoSaveInterval=222 must survive the logging write"
        );
        assert_eq!(
            final_doc["logging"]["enabled"],
            serde_json::json!(false),
            "the logging write must survive the concurrent writer — this is the lost update"
        );
        assert_eq!(
            final_doc["logging"]["level"],
            serde_json::json!("warn"),
            "the logging level must survive the concurrent writer"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// The persisted value must survive the whole load path and come back out
    /// of the command unchanged. Both fields differ from the default, so a
    /// silent fallback to defaults cannot pass this.
    ///
    /// HOME_LOCK is held for the entire test: $HOME is process-global, and
    /// releasing it before the await would let a concurrent test observe the
    /// temporary value.
    #[tokio::test]
    // HOME_LOCK guards the process-global $HOME env var, so it cannot be released before the await.
    #[allow(clippy::await_holding_lock)]
    async fn get_logging_settings_returns_the_persisted_values_not_the_defaults() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("persisted");
        let _home_guard = set_home(&home);

        write_config_with_logging(
            &home,
            serde_json::json!({ "enabled": false, "level": "warn" }),
        );

        let settings = get_logging_settings().await.expect("command must succeed");

        assert!(
            !settings.enabled,
            "persisted enabled=false must survive the load path"
        );
        assert_eq!(
            settings.level,
            LogLevel::Warn,
            "persisted level=warn must survive the load path"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// R8 — the registered command itself, not just the helper it delegates to.
    ///
    /// Every other case in this module calls `apply_logging_settings` directly.
    /// That left `set_logging_settings` — the `#[tauri::command]` that is
    /// actually registered in `commands/mod.rs::handlers()` and is the only
    /// entry point the frontend can reach — with **zero executions in either
    /// lane**: replacing its body with `unimplemented!()` kept both lanes green.
    /// Rule 10 requires Rust commands to be tested; the delegation being one
    /// line is an argument for the test being cheap, not for skipping it.
    ///
    /// Deliberately end-to-end through the command: arguments in, `Result` out,
    /// and the effect re-read from disk through the *sibling* command rather
    /// than from the return value, so a delegate that computes the right answer
    /// and never persists cannot pass.
    #[tokio::test]
    // HOME_LOCK guards the process-global $HOME env var, so it cannot be released before the await.
    #[allow(clippy::await_holding_lock)]
    async fn set_logging_settings_command_persists_through_to_get_logging_settings() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("command_delegate");
        let _home_guard = set_home(&home);
        let _logger_guard = capture_logger_settings();

        // Seed differs from the written value in BOTH fields, so a no-op
        // delegate cannot pass by coincidence.
        write_config_with_interval(
            &home,
            Some(serde_json::json!({ "enabled": true, "level": "info" })),
            111,
        );

        let returned = set_logging_settings(LogSettings {
            enabled: false,
            level: LogLevel::Warn,
        })
        .await
        .expect("the command must succeed");

        assert!(!returned.enabled, "the command must echo enabled=false");
        assert_eq!(
            returned.level,
            LogLevel::Warn,
            "the command must echo level=warn"
        );

        // Through the sibling command, i.e. a genuine re-read from disk.
        let read_back = get_logging_settings()
            .await
            .expect("the sibling command must succeed");
        assert!(
            !read_back.enabled,
            "the command's write must be visible to get_logging_settings"
        );
        assert_eq!(
            read_back.level,
            LogLevel::Warn,
            "the command's level must be visible to get_logging_settings"
        );

        // The delegate must not have lost the unrelated field on the way past.
        let doc = read_config_value(&home);
        assert_eq!(
            doc["autoSaveInterval"],
            serde_json::json!(111),
            "the command must preserve preferences it does not own"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// The deserialize direction of the same cross-language contract WI-4-D
    /// pins on the serialize side.
    ///
    /// `"Info"` is the spelling the wire format would drift to if the
    /// lowercase rename were dropped. `load_preferences` has no
    /// `unwrap_or_default()` and no `#[serde(other)]`, so one bad enum spelling
    /// fails the entire parse — the command must surface that as `Err` rather
    /// than quietly handing the frontend a default.
    #[tokio::test]
    // HOME_LOCK guards the process-global $HOME env var, so it cannot be released before the await.
    #[allow(clippy::await_holding_lock)]
    async fn get_logging_settings_errors_on_a_drifted_log_level_spelling() {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = temp_home("drifted");
        let _home_guard = set_home(&home);

        write_config_with_logging(
            &home,
            serde_json::json!({ "enabled": false, "level": "Info" }),
        );

        let result = get_logging_settings().await;

        assert!(
            result.is_err(),
            "a capitalised level must fail the parse, not silently fall back to defaults; got {:?}",
            result.ok().map(|s| (s.enabled, s.level))
        );

        let _ = std::fs::remove_dir_all(&home);
    }
}
