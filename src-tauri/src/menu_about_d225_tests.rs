//! D225: muda opens the About dialog off macOS only when it is given
//! metadata. Windows and Linux get the app's name, version and website;
//! macOS keeps `None` and AppKit's native panel.

use super::about_metadata_for;

const SITE: &str = "https://github.com/anzchy/mdpro";

#[test]
fn a1_macos_keeps_the_native_panel() {
    assert!(about_metadata_for("macos", "mdpro", "0.3.5").is_none());
}

#[test]
fn a2_windows_gets_name_version_and_website() {
    let m = about_metadata_for("windows", "mdpro", "0.3.5").expect("metadata on windows");
    assert_eq!(m.name.as_deref(), Some("mdpro"));
    assert_eq!(m.version.as_deref(), Some("0.3.5"));
    assert_eq!(m.website.as_deref(), Some(SITE));
}

#[test]
fn a3_linux_gets_the_same_metadata() {
    let m = about_metadata_for("linux", "mdpro", "0.3.5").expect("metadata on linux");
    assert_eq!(m.name.as_deref(), Some("mdpro"));
    assert_eq!(m.version.as_deref(), Some("0.3.5"));
    assert_eq!(m.website.as_deref(), Some(SITE));
}

#[test]
fn a4_the_name_and_version_are_the_callers() {
    let m = about_metadata_for("windows", "other", "9.9.9").expect("metadata on windows");
    assert_eq!(m.name.as_deref(), Some("other"));
    assert_eq!(m.version.as_deref(), Some("9.9.9"));
}

#[test]
fn a5_no_placeholder_author_is_shown() {
    let m = about_metadata_for("windows", "mdpro", "0.3.5").expect("metadata on windows");
    assert!(m.authors.is_none());
}
