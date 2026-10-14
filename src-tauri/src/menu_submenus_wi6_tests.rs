//! D190-WI-6 (ADR-0096): on Windows and Linux Ctrl+1–6 are headings, so the
//! View → Source / WYSIWYG items carry no Ctrl+2 / Ctrl+4 accelerator there;
//! the view switch is Cycle View Mode (Ctrl+/). macOS keeps ⌃2 / ⌃4, which
//! never collide with ⌘2 / ⌘4.

use super::{view_item_accelerator, ViewItem};

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
