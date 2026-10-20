//! Purpose: validate a Settings-page leaf patch and fold it into the latest
//! stored preference group. The caller holds PrefsGuard across read and save.

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::models::preferences::{EditorConfig, ExportConfig, ImageConfig, MarkdownConfig};
use crate::models::{LogSettings, UserPreferences};

fn merge_typed<T: Serialize + DeserializeOwned>(
    current: &T,
    patch: &Map<String, Value>,
) -> Result<T, String> {
    let mut value = serde_json::to_value(current).map_err(|_| "serialize_failed".to_string())?;
    let Some(fields) = value.as_object_mut() else {
        return Err("invalid_group".to_string());
    };
    for (key, replacement) in patch {
        if !fields.contains_key(key) {
            return Err("unknown_field".to_string());
        }
        fields.insert(key.clone(), replacement.clone());
    }
    serde_json::from_value(value).map_err(|_| "invalid_field".to_string())
}

fn validate_editor(editor: &EditorConfig) -> Result<(), String> {
    if !matches!(editor.font_family.as_str(), "system" | "serif" | "mono")
        || !(12..=24).contains(&editor.font_size)
        || !matches!(editor.line_height_x10, 12 | 14 | 16 | 18 | 20)
        || !matches!(editor.tab_size, 2 | 4)
    {
        return Err("invalid_field".to_string());
    }
    Ok(())
}

fn validate_image(image: &ImageConfig) -> Result<(), String> {
    if image.asset_folder.starts_with('/')
        || image.asset_folder.split('/').any(|part| part == "..")
        || image.asset_folder.chars().any(char::is_control)
    {
        return Err("invalid_field".to_string());
    }
    Ok(())
}

/// Whitelisted groups and leaves only. Mutation occurs after full validation.
pub fn apply_patch(
    current: &mut UserPreferences,
    group: &str,
    patch: Value,
) -> Result<Value, String> {
    let Some(fields) = patch.as_object() else {
        return Err("invalid_patch".to_string());
    };
    if fields.is_empty() {
        return Err("empty_patch".to_string());
    }
    match group {
        "editor" => {
            let next: EditorConfig = merge_typed(&current.editor, fields)?;
            validate_editor(&next)?;
            current.editor = next;
            serde_json::to_value(&current.editor).map_err(|_| "serialize_failed".to_string())
        }
        "markdown" => {
            current.markdown = merge_typed::<MarkdownConfig>(&current.markdown, fields)?;
            serde_json::to_value(&current.markdown).map_err(|_| "serialize_failed".to_string())
        }
        "image" => {
            let next: ImageConfig = merge_typed(&current.image, fields)?;
            validate_image(&next)?;
            current.image = next;
            serde_json::to_value(&current.image).map_err(|_| "serialize_failed".to_string())
        }
        "export" => {
            current.export = merge_typed::<ExportConfig>(&current.export, fields)?;
            serde_json::to_value(&current.export).map_err(|_| "serialize_failed".to_string())
        }
        "logging" => {
            current.logging = merge_typed::<LogSettings>(&current.logging, fields)?;
            serde_json::to_value(&current.logging).map_err(|_| "serialize_failed".to_string())
        }
        _ => Err("unknown_group".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::preferences::patch_settings_group;
    use crate::services::{logger, preferences};
    use crate::HOME_LOCK;
    use serde_json::json;
    use std::path::{Path, PathBuf};

    struct HomeRestorer(Option<String>);
    impl Drop for HomeRestorer {
        fn drop(&mut self) {
            match &self.0 {
                Some(home) => unsafe { std::env::set_var("HOME", home) },
                None => unsafe { std::env::remove_var("HOME") },
            }
        }
    }

    struct LogSettingsRestorer(LogSettings);
    impl Drop for LogSettingsRestorer {
        fn drop(&mut self) {
            logger::set_log_settings(self.0.clone());
        }
    }

    fn home(label: &str) -> (PathBuf, HomeRestorer) {
        let dir = std::env::temp_dir().join(format!("wi43b_patch_{label}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let previous = std::env::var("HOME").ok();
        unsafe { std::env::set_var("HOME", &dir) };
        (dir, HomeRestorer(previous))
    }

    fn config_file(home: &Path) -> PathBuf {
        home.join(".mdpro").join("config.json")
    }

    fn run(group: &str, patch: Value) -> Result<Value, String> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(patch_settings_group(group.to_string(), patch))
    }

    #[test]
    fn editor_leaf_patch_merges_under_preferences_lock_without_replacing_unrelated_leaves() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (home, _restore) = home("editor");
        preferences::save_preferences(&UserPreferences::default()).unwrap();
        run("editor", json!({"fontFamily":"serif"})).unwrap();
        run("editor", json!({"fontSize":20})).unwrap();
        let reply = run("editor", json!({"lineHeightX10":18})).unwrap();
        let saved = preferences::load_preferences().unwrap();
        assert_eq!(reply["fontSize"], 20);
        assert_eq!(saved.editor.font_family, "serif");
        assert_eq!(saved.editor.font_size, 20);
        assert_eq!(saved.editor.line_height_x10, 18);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn unknown_or_malformed_leaf_is_rejected_without_writing() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (home, _restore) = home("invalid");
        preferences::save_preferences(&UserPreferences::default()).unwrap();
        let before = std::fs::read(config_file(&home)).unwrap();
        assert!(run("editor", json!({"bogus":true})).is_err());
        assert!(run("editor", json!({"fontSize":"huge"})).is_err());
        assert!(run("editor", json!({"fontFamily":"unknown"})).is_err());
        assert_eq!(std::fs::read(config_file(&home)).unwrap(), before);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn corrupt_config_is_unchanged_after_patch_failure() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (home, _restore) = home("corrupt");
        std::fs::create_dir_all(home.join(".mdpro")).unwrap();
        std::fs::write(config_file(&home), b"{not json").unwrap();
        assert!(run("image", json!({"copyExternalImages":false})).is_err());
        assert_eq!(std::fs::read(config_file(&home)).unwrap(), b"{not json");
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn logging_leaf_patch_updates_cache_with_disk() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (home, _restore) = home("logging");
        let _restore_log = LogSettingsRestorer(logger::get_log_settings());
        preferences::save_preferences(&UserPreferences::default()).unwrap();
        let reply = run("logging", json!({"enabled":false})).unwrap();
        assert_eq!(reply["enabled"], false);
        assert!(!preferences::load_preferences().unwrap().logging.enabled);
        assert!(!logger::get_log_settings().enabled);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn rejected_patch_logs_start_and_fail_without_value_or_path() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (home, _restore) = home("redacted");
        let _restore_log = LogSettingsRestorer(logger::get_log_settings());
        logger::set_log_settings(LogSettings::default());
        preferences::save_preferences(&UserPreferences::default()).unwrap();
        let secret = "/Users/private/secret-folder";
        assert!(run("editor", json!({"fontFamily":secret})).is_err());
        let raw = std::fs::read_to_string(home.join(".mdpro/mdpro.log")).unwrap();
        let events: Vec<Value> = raw
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let patch_events: Vec<&Value> = events
            .iter()
            .filter(|event| event["event"] == "preferences.patch")
            .collect();
        assert_eq!(patch_events.len(), 2);
        assert_eq!(patch_events[0]["status"], "start");
        assert_eq!(patch_events[1]["status"], "fail");
        assert_eq!(patch_events[0]["actionId"], patch_events[1]["actionId"]);
        assert_eq!(patch_events[1]["error"], "invalid_field");
        assert!(!raw.contains(secret));
        let _ = std::fs::remove_dir_all(home);
    }
}
