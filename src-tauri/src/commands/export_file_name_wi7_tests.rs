//! D190-WI-7 (W7): the export dialog suggested `basic.md.html` for
//! `basic.md`. The suggested name drops a Markdown extension before adding
//! `.html`; any other title keeps its full text.

use super::export_file_name;

#[test]
fn e1_a_md_title_loses_its_extension() {
    assert_eq!(export_file_name("basic.md"), "basic.html");
}

#[test]
fn e2_markdown_and_any_letter_case_are_dropped_too() {
    assert_eq!(export_file_name("notes.markdown"), "notes.html");
    assert_eq!(export_file_name("README.MD"), "README.html");
}

#[test]
fn e3_an_untitled_document_keeps_its_title() {
    assert_eq!(export_file_name("Untitled-1"), "Untitled-1.html");
}

#[test]
fn e4_only_a_trailing_markdown_extension_is_dropped() {
    assert_eq!(export_file_name("a.md.txt"), "a.md.txt.html");
    assert_eq!(export_file_name("v1.2 notes"), "v1.2 notes.html");
}

#[test]
fn e5_a_bare_extension_keeps_its_text() {
    assert_eq!(export_file_name(".md"), ".md.html");
}
