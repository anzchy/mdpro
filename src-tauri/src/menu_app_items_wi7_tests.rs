//! D190-WI-7 (W7): Services, Hide, Hide Others and Show All are macOS
//! application-menu items. muda reports Services and Show All unsupported on
//! Windows, and the audit saw all four in mdpro's Windows menu. Off macOS the
//! app menu carries none of them.

use super::app_menu_has_macos_items;

#[test]
fn a1_macos_keeps_services_hide_and_show_all() {
    assert!(app_menu_has_macos_items("macos"));
}

#[test]
fn a2_windows_has_none_of_them() {
    assert!(!app_menu_has_macos_items("windows"));
}

#[test]
fn a3_linux_has_none_of_them() {
    assert!(!app_menu_has_macos_items("linux"));
}
