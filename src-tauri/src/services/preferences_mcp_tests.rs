//! P-4..P-7 (ADR-0040 WI-6): `persist_server_enabled` changes only
//! `mcp.serverEnabled` relative to the typed round trip, never writes over an
//! unreadable config, creates a missing one, and keeps the old bytes when the
//! save fails.
//!
//! Every case holds a `TestHome` (temp `$HOME` under `HOME_LOCK`); the
//! developer's `~/.mdpro/` is never touched.

use super::{persist_server_enabled, PersistError};
use crate::models::{LogLevel, LogSettings, UserPreferences};
use crate::services::preferences::load_preferences;
use crate::services::window_restore::test_home::{
    config_file, read_config_bytes, seed_config, write_raw_config, TestHome,
};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn tmp_file(home: &Path) -> PathBuf {
    home.join(".mdpro").join("config.json.tmp")
}

fn read_json(home: &Path) -> Value {
    serde_json::from_slice(&read_config_bytes(home)).expect("config.json is JSON")
}

/// `v` with `/mcp/serverEnabled` removed (the one field the persist may change).
fn without_server_enabled(mut v: Value) -> Value {
    if let Some(mcp) = v.get_mut("mcp").and_then(Value::as_object_mut) {
        mcp.remove("serverEnabled");
    }
    v
}

/// Seed (i): every group populated with non-default values, plus one empty
/// shortcut so the load-side repair is exercised.
fn seed_full(home: &Path) -> Vec<u8> {
    seed_config(home, |v| {
        v["themeMode"] = json!("dark");
        v["editor"]["fontFamily"] = json!("serif");
        v["editor"]["fontSize"] = json!(20);
        v["logging"] = serde_json::to_value(LogSettings {
            enabled: false,
            level: LogLevel::Warn,
        })
        .expect("log settings serialize");
        v["mcp"]["startOnLaunch"] = json!(true);
        v["mcp"]["autoApproveEdits"] = json!(true);
        v["keyboardShortcuts"]["fileNew"] = json!("");
        v["autoSaveInterval"] = json!(77);
        v["showSidebar"] = json!(false);
    })
}

/// Keys `UserPreferences` requires (no `#[serde(default)]`).
const REQUIRED_KEYS: [&str; 7] = [
    "themeMode",
    "autoSaveInterval",
    "defaultViewMode",
    "showSidebar",
    "enableScrollSync",
    "recentFiles",
    "windowState",
];

/// Seed (ii): the minimal document that loads — only the required keys, so
/// every defaulted group is materialised by the typed round trip. (The
/// matrix named `{}`, but `{}` does not deserialise; see `p5e`.)
fn seed_minimal(home: &Path) -> Vec<u8> {
    seed_config(home, |v| {
        v.as_object_mut()
            .expect("object")
            .retain(|k, _| REQUIRED_KEYS.contains(&k.as_str()));
    })
}

/// Seed (iii): `mcp` absent, other groups present.
fn seed_no_mcp(home: &Path) -> Vec<u8> {
    seed_config(home, |v| {
        v["themeMode"] = json!("dark");
        v["editor"]["fontSize"] = json!(18);
        v.as_object_mut().expect("object").remove("mcp");
    })
}

/// Writes one seed document into the temp HOME.
type SeedFn = fn(&Path) -> Vec<u8>;

/// P-4: over three seeds and both values, the saved document equals the typed
/// round trip of the seed with only `/mcp/serverEnabled` changed.
#[test]
fn p4_persist_changes_only_server_enabled_relative_to_typed_round_trip() {
    let h = TestHome::new("wi6_p4");
    let seeds: [(&str, SeedFn); 3] = [
        ("full", seed_full),
        ("minimal", seed_minimal),
        ("mcp-absent", seed_no_mcp),
    ];
    for (name, seed) in seeds {
        for enabled in [true, false] {
            seed(&h.dir);
            let expected =
                serde_json::to_value(load_preferences().expect("seed loads")).expect("to_value");

            let res = persist_server_enabled(enabled);
            assert_eq!(res, Ok(()), "{name}/{enabled}: persist result");

            let actual = read_json(&h.dir);
            assert_eq!(
                actual["mcp"]["serverEnabled"],
                json!(enabled),
                "{name}/{enabled}: serverEnabled on disk"
            );
            assert_eq!(
                without_server_enabled(actual),
                without_server_enabled(expected),
                "{name}/{enabled}: every other field must equal the typed round trip"
            );
            assert!(!tmp_file(&h.dir).exists(), "{name}/{enabled}: tmp left");
        }
    }
}

/// Whether a mode-000 file is unreadable to this process (false as root).
#[cfg(unix)]
fn chmod_is_enforced(dir: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    let probe = dir.join("chmod_probe");
    fs::write(&probe, b"x").expect("write probe");
    fs::set_permissions(&probe, fs::Permissions::from_mode(0o000)).expect("chmod probe");
    let readable = fs::read(&probe).is_ok();
    let _ = fs::set_permissions(&probe, fs::Permissions::from_mode(0o600));
    let _ = fs::remove_file(&probe);
    !readable
}

fn reset_mdpro(home: &Path) {
    let d = home.join(".mdpro");
    if d.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&d, fs::Permissions::from_mode(0o700));
        }
        fs::remove_dir_all(&d).expect("reset .mdpro");
    }
}

/// P-5: corrupt, directory, mode-000 and wrong-typed configs are all
/// `Err(Unreadable)`; the bytes are identical and no tmp is left.
#[test]
fn p5_unreadable_config_is_err_unreadable_and_untouched() {
    let h = TestHome::new("wi6_p5");

    // (a) corrupt JSON, (d) valid JSON with a wrong-typed field.
    for (name, raw) in [
        ("a-corrupt", "{ not json"),
        ("d-wrong-type", "{\"editor\": 42}"),
    ] {
        reset_mdpro(&h.dir);
        let before = write_raw_config(&h.dir, raw);
        let res = persist_server_enabled(false);
        assert_eq!(res, Err(PersistError::Unreadable), "{name}: result");
        assert_eq!(read_config_bytes(&h.dir), before, "{name}: bytes changed");
        assert!(!tmp_file(&h.dir).exists(), "{name}: tmp left");
    }

    // (b) a directory in place of config.json.
    reset_mdpro(&h.dir);
    fs::create_dir_all(config_file(&h.dir)).expect("dir at config.json");
    let res = persist_server_enabled(false);
    assert_eq!(res, Err(PersistError::Unreadable), "b-directory: result");
    assert!(config_file(&h.dir).is_dir(), "b-directory: no longer a dir");
    assert!(!tmp_file(&h.dir).exists(), "b-directory: tmp left");

    // (c) mode 000.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        reset_mdpro(&h.dir);
        fs::create_dir_all(h.dir.join(".mdpro")).expect("create .mdpro");
        if !chmod_is_enforced(&h.dir.join(".mdpro")) {
            println!("P-5(c): skipping mode-000 — this process can read a 0o000 file (root?)");
            return;
        }
        let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(true));
        let path = config_file(&h.dir);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).expect("chmod 000");
        let res = persist_server_enabled(false);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("restore mode");
        assert_eq!(res, Err(PersistError::Unreadable), "c-mode-000: result");
        assert_eq!(
            read_config_bytes(&h.dir),
            before,
            "c-mode-000: bytes changed"
        );
        assert!(!tmp_file(&h.dir).exists(), "c-mode-000: tmp left");
    }
}

/// P-5(e) (added in WI-6 green): `{}` lacks required keys, so it is a failed
/// read like (d) — `Err(Unreadable)`, bytes identical, no tmp, no defaults.
#[test]
fn p5e_empty_object_is_err_unreadable_and_untouched() {
    let h = TestHome::new("wi6_p5e");
    let before = write_raw_config(&h.dir, "{}");
    assert_eq!(persist_server_enabled(true), Err(PersistError::Unreadable));
    assert_eq!(read_config_bytes(&h.dir), before, "bytes changed");
    assert!(!tmp_file(&h.dir).exists(), "tmp left");
}

/// P-6: a missing config is created with the requested value, for both values.
#[test]
fn p6_missing_config_is_created_with_requested_value() {
    for enabled in [false, true] {
        let h = TestHome::new(&format!("wi6_p6_{enabled}"));
        assert!(!config_file(&h.dir).exists(), "precondition: no config");

        let res = persist_server_enabled(enabled);
        assert_eq!(res, Ok(()), "{enabled}: result");
        assert!(
            config_file(&h.dir).exists(),
            "{enabled}: config not created"
        );

        let parsed: Result<UserPreferences, _> = serde_json::from_slice(&read_config_bytes(&h.dir));
        assert!(parsed.is_ok(), "{enabled}: not a full UserPreferences");
        let reloaded = load_preferences().expect("reload");
        assert_eq!(reloaded.mcp.server_enabled, enabled, "{enabled}: reloaded");
    }
}

/// Restores `~/.mdpro` to 0o700 on drop, so a failed assertion cannot leave
/// an undeletable temp dir.
#[cfg(unix)]
struct ModeRestore(PathBuf);
#[cfg(unix)]
impl Drop for ModeRestore {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o700));
    }
}

/// P-7: a read-only `~/.mdpro` makes the save fail: `Err(WriteFailed)` and
/// the original bytes are kept.
#[cfg(unix)]
#[test]
fn p7_write_failure_is_err_write_failed_and_bytes_kept() {
    use std::os::unix::fs::PermissionsExt;
    let h = TestHome::new("wi6_p7");
    let before = seed_config(&h.dir, |v| v["mcp"]["serverEnabled"] = json!(true));
    let dir = h.dir.join(".mdpro");

    fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).expect("chmod 555");
    let _restore = ModeRestore(dir.clone());
    let probe = dir.join("write_probe");
    if fs::write(&probe, b"x").is_ok() {
        let _ = fs::remove_file(&probe);
        println!("P-7: skipping — this process can write into a 0o555 dir (root?)");
        return;
    }

    let res = persist_server_enabled(false);
    assert_eq!(res, Err(PersistError::WriteFailed), "result");
    assert_eq!(read_config_bytes(&h.dir), before, "bytes changed");
}
