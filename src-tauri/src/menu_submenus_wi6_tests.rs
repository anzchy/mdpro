//! D190-WI-6 (ADR-0096): on Windows and Linux Ctrl+1–6 are headings, so the
//! View → Source / WYSIWYG items carry no Ctrl+2 / Ctrl+4 accelerator there;
//! the view switch is Cycle View Mode (Ctrl+/). macOS keeps ⌃2 / ⌃4, which
//! never collide with ⌘2 / ⌘4.

use super::super::menu_plan_builder::theme_item_checked;
use super::{theme_checks, view_item_accelerator, ThemeMode, ViewItem};

#[test]
fn m4_amendment12_active_theme_builder_reasserts_exactly_one_check() {
    let ids = ["theme.light", "theme.dark", "theme.system"];
    for (mode, checked_id) in [
        (ThemeMode::Light, "theme.light"),
        (ThemeMode::Dark, "theme.dark"),
        (ThemeMode::System, "theme.system"),
    ] {
        let states = ids.map(|id| theme_item_checked(id, mode));
        assert_eq!(states.iter().filter(|state| **state).count(), 1, "{mode:?}");
        assert!(theme_item_checked(checked_id, mode), "{mode:?}");
        assert!(!theme_item_checked("theme.unknown", mode));
    }
}

#[test]
fn m4_reasserts_the_checked_theme_after_native_self_toggle() {
    for (mode, index) in [
        (ThemeMode::Light, 0),
        (ThemeMode::Dark, 1),
        (ThemeMode::System, 2),
    ] {
        let expected = [0, 1, 2].map(|position| position == index);
        let mut native = expected;
        native[index] = false; // muda toggles before delivering the click.
        assert_eq!(native.iter().filter(|checked| **checked).count(), 0);
        assert_eq!(theme_checks(mode), expected, "{mode:?} must be restored");
        native = theme_checks(mode);
        assert_eq!(native.iter().filter(|checked| **checked).count(), 1);
        assert_eq!(theme_checks(mode), native, "repeated clicks are idempotent");
    }
}

#[test]
fn m1_macos_keeps_control_2_and_control_4() {
    assert_eq!(
        view_item_accelerator(ViewItem::Source, true),
        Some("Ctrl+2")
    );
    assert_eq!(
        view_item_accelerator(ViewItem::Wysiwyg, true),
        Some("Ctrl+4")
    );
}

#[test]
fn m2_off_mac_the_source_item_has_no_accelerator() {
    assert_eq!(view_item_accelerator(ViewItem::Source, false), None);
}

#[test]
fn m3_off_mac_the_wysiwyg_item_has_no_accelerator() {
    assert_eq!(view_item_accelerator(ViewItem::Wysiwyg, false), None);
}
