//! D7 cases R1–R5: the fail-closed decision behind the logger's initial
//! settings (moved from `logger.rs` `mod tests` by M1a WI-3a).

use super::*;

// ---- D7: the log-settings cache must fail CLOSED ----------------------
//
// `settings_cache()` used to build its initial value with
// `load_preferences().map(..).unwrap_or_default()`, and `LogSettings::default()`
// is `enabled: true`. So a user who had explicitly turned logging OFF got it
// silently turned back ON whenever their config.json was unreadable — and the
// resulting value is byte-identical to a healthy fresh install, so nothing
// downstream can tell the two apart.
//
// Reaching that branch at all means config.json EXISTS and is corrupt:
// `load_preferences` (services/preferences.rs) treats a MISSING file as the
// success path, writing defaults and returning `Ok`. A first launch never gets
// here. That is what makes fail-closed safe rather than merely paranoid — it
// cannot silence logging for a new user.
//
// The frontend half of this defect (D2) was already fixed this way; see
// FAIL_CLOSED_SETTINGS in src/services/loggingService.ts. This mirrors it
// deliberately, including the choice to leave `LogSettings::default()` alone so
// that models/log_entry.rs's
// `default_log_settings_are_enabled_at_info_and_mirror_ts_default_preferences`
// stays valid.
//
// R1 is the regression test: it is the one case that fails against
// `unwrap_or_default()`.

#[test]
fn r1_a_failed_preferences_load_disables_logging_rather_than_enabling_it() {
    let resolved = resolve_initial_settings(None);

    assert!(
        !resolved.enabled,
        "a failed preferences load must not enable logging; \
         LogSettings::default() is enabled:true, which is why \
         unwrap_or_default() was the defect"
    );
}

#[test]
fn r2_a_successful_load_is_passed_through_untouched_including_enabled_true() {
    // Fail-closed must apply ONLY to the failure branch. If it also clamped
    // the success branch, logging would never work at all — and R1 alone
    // cannot tell those two implementations apart.
    let user = LogSettings {
        enabled: true,
        level: LogLevel::Debug,
    };
    let resolved = resolve_initial_settings(Some(user.clone()));

    assert!(resolved.enabled, "a successful load must keep enabled:true");
    assert_eq!(
        resolved.level.rank(),
        user.level.rank(),
        "a successful load must keep the user's level"
    );
}

#[test]
fn r3_a_user_who_disabled_logging_stays_disabled_through_a_successful_load() {
    let resolved = resolve_initial_settings(Some(LogSettings {
        enabled: false,
        level: LogLevel::Warn,
    }));

    assert!(!resolved.enabled);
    assert_eq!(resolved.level.rank(), LogLevel::Warn.rank());
}

#[test]
fn r4_the_fallback_differs_from_default_on_enabled_and_agrees_on_level() {
    // Pins WHICH field carries the safety meaning. `enabled` is the one that
    // can silently contradict a user's explicit choice; `level` cannot, so it
    // stays at the ordinary default. Without this case, a "fix" that also
    // dropped the level to Error would pass R1.
    let fallback = resolve_initial_settings(None);
    let default = LogSettings::default();

    assert!(
        default.enabled,
        "guarding the premise: default IS fail-open"
    );
    assert!(
        !fallback.enabled,
        "the fallback must flip exactly this field"
    );
    assert_eq!(
        fallback.level.rank(),
        default.level.rank(),
        "level carries no safety meaning and must not be changed"
    );
}

#[test]
fn r5_nothing_is_logged_at_any_level_when_the_fallback_is_in_force() {
    // The point of fail-closed, stated in terms of observable behaviour
    // rather than a struct field.
    let fallback = resolve_initial_settings(None);

    for level in [
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ] {
        assert!(
            !(fallback.enabled && level.rank() >= fallback.level.rank()),
            "should_log must be false at {level:?} under the fail-closed fallback"
        );
    }
}
