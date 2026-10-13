//! D190-WI-5: `simplify_verbatim` conversion table and its laws.
//!
//! The rules follow `dunce`: strip `\\?\` only when the plain spelling names
//! the same file. Decisions this file pins:
//! - Only the exact backslash prefix `\\?\` is verbatim. `//?/…` and
//!   forward-slash plain paths are not recognised and come back unchanged.
//! - Inside a verbatim path `/` is a literal character, not a separator, so a
//!   verbatim path containing `/` is kept (stripping would change meaning).
//! - The plain form must fit MAX_PATH: at most 259 characters (260 with the
//!   terminating NUL). Longer stays verbatim.
//! - Drive letter case is preserved as given.

use super::simplify_verbatim;

fn s(p: &str) -> String {
    simplify_verbatim(p)
}

/// A plain disk path `C:\aaa…\aaa.md` of exactly `n` characters whose
/// components are all short, valid names (a separator every 100 chars).
fn plain_of_len(n: usize) -> String {
    let mut out = String::from("C:\\");
    let body = n - out.len() - ".md".len();
    for i in 0..body {
        out.push(if i % 100 == 99 { '\\' } else { 'a' });
    }
    out.push_str(".md");
    assert_eq!(out.len(), n, "fixture length");
    out
}

// ---- success: the two shapes that simplify ----

#[test]
fn disk_verbatim_becomes_plain_drive_path() {
    assert_eq!(s(r"\\?\C:\Users\jack\a.md"), r"C:\Users\jack\a.md");
}

#[test]
fn unc_verbatim_becomes_plain_unc_path() {
    assert_eq!(
        s(r"\\?\UNC\server\share\dir\a.md"),
        r"\\server\share\dir\a.md"
    );
}

#[test]
fn lowercase_drive_letter_simplifies_and_keeps_its_case() {
    assert_eq!(s(r"\\?\c:\notes\a.md"), r"c:\notes\a.md");
}

#[test]
fn drive_root_simplifies() {
    assert_eq!(s(r"\\?\D:\"), r"D:\");
}

#[test]
fn non_ascii_components_simplify() {
    assert_eq!(s(r"\\?\C:\笔记\中文.md"), r"C:\笔记\中文.md");
}

// ---- identity: not verbatim ----

#[test]
fn plain_disk_path_is_unchanged() {
    assert_eq!(s(r"C:\Users\jack\a.md"), r"C:\Users\jack\a.md");
}

#[test]
fn plain_unc_path_is_unchanged() {
    assert_eq!(s(r"\\server\share\a.md"), r"\\server\share\a.md");
}

#[test]
fn unix_path_is_unchanged() {
    assert_eq!(s("/Users/jack/a.md"), "/Users/jack/a.md");
}

#[test]
fn empty_string_is_unchanged() {
    assert_eq!(s(""), "");
}

#[test]
fn forward_slash_plain_path_is_unchanged() {
    assert_eq!(s("C:/Users/jack/a.md"), "C:/Users/jack/a.md");
}

#[test]
fn forward_slash_prefix_is_not_recognised_as_verbatim() {
    assert_eq!(s("//?/C:/a.md"), "//?/C:/a.md");
}

#[test]
fn device_namespace_prefix_is_unchanged() {
    assert_eq!(s(r"\\.\C:\a.md"), r"\\.\C:\a.md");
}

// ---- kept verbatim: plain spelling would change meaning ----

#[test]
fn reserved_device_names_stay_verbatim() {
    for p in [
        r"\\?\C:\docs\CON",
        r"\\?\C:\docs\nul.md",
        r"\\?\C:\docs\Com1.md",
        r"\\?\C:\docs\LPT9",
        r"\\?\C:\aux\a.md",
        r"\\?\C:\docs\prn.txt.md",
    ] {
        assert_eq!(s(p), p, "{p} must stay verbatim");
    }
}

#[test]
fn trailing_dot_or_space_in_any_component_stays_verbatim() {
    for p in [
        r"\\?\C:\docs\a.",
        r"\\?\C:\docs\a.md ",
        r"\\?\C:\dir.\a.md",
        r"\\?\C:\dir \a.md",
    ] {
        assert_eq!(s(p), p, "{p} must stay verbatim");
    }
}

#[test]
fn dot_and_dotdot_components_stay_verbatim() {
    for p in [r"\\?\C:\a\..\b.md", r"\\?\C:\a\.\b.md"] {
        assert_eq!(s(p), p, "{p} must stay verbatim");
    }
}

#[test]
fn empty_component_stays_verbatim() {
    let p = r"\\?\C:\a\\b.md";
    assert_eq!(s(p), p);
}

#[test]
fn forward_slash_inside_verbatim_path_stays_verbatim() {
    let p = r"\\?\C:\a/b.md";
    assert_eq!(s(p), p);
}

#[test]
fn bare_drive_without_root_stays_verbatim() {
    // `C:` alone is drive-relative; `\\?\C:` is not.
    let p = r"\\?\C:";
    assert_eq!(s(p), p);
}

#[test]
fn volume_guid_and_globalroot_stay_verbatim() {
    for p in [
        r"\\?\Volume{0b2f3c4d-1111-2222-3333-444455556666}\a.md",
        r"\\?\GLOBALROOT\Device\HarddiskVolume3\a.md",
    ] {
        assert_eq!(s(p), p, "{p} must stay verbatim");
    }
}

#[test]
fn unc_without_share_stays_verbatim() {
    for p in [r"\\?\UNC\server", r"\\?\UNC\server\"] {
        assert_eq!(s(p), p, "{p} must stay verbatim");
    }
}

#[test]
fn component_longer_than_255_stays_verbatim() {
    let p = format!(r"\\?\C:\{}.md", "a".repeat(253));
    assert_eq!(s(&p), p);
}

// ---- boundary: MAX_PATH ----

#[test]
fn plain_form_of_259_chars_simplifies() {
    let plain = plain_of_len(259);
    let verbatim = format!(r"\\?\{plain}");
    assert_eq!(s(&verbatim), plain);
}

#[test]
fn plain_form_of_260_chars_stays_verbatim() {
    let verbatim = format!(r"\\?\{}", plain_of_len(260));
    assert_eq!(s(&verbatim), verbatim);
}

#[test]
fn plain_form_over_260_chars_stays_verbatim() {
    let verbatim = format!(r"\\?\{}", plain_of_len(300));
    assert_eq!(s(&verbatim), verbatim);
}

// ---- laws over an enumerated grid ----

/// Every combination of a prefix and a body: verbatim disk, verbatim UNC,
/// plain, Unix, and the unrecognised spellings.
fn grid() -> Vec<String> {
    let prefixes = [
        r"\\?\C:\",
        r"\\?\z:\",
        r"\\?\UNC\srv\share\",
        r"\\?\Volume{abc}\",
        r"\\?\GLOBALROOT\",
        r"C:\",
        r"\\srv\share\",
        "/",
        "//?/C:/",
        "",
    ];
    let bodies = [
        "a.md",
        r"dir\a.md",
        r"笔记\中文.md",
        "CON",
        r"dir\nul.md",
        "a.",
        "a ",
        r"a\..\b.md",
        r"a\\b.md",
        "a/b.md",
        "",
    ];
    let mut out = Vec::new();
    for p in prefixes {
        for b in bodies {
            out.push(format!("{p}{b}"));
        }
    }
    out.push(format!(r"\\?\{}", plain_of_len(259)));
    out.push(format!(r"\\?\{}", plain_of_len(260)));
    out
}

#[test]
fn law_idempotent() {
    for x in grid() {
        let once = s(&x);
        assert_eq!(s(&once), once, "not idempotent on {x}");
    }
}

#[test]
fn law_identity_on_non_verbatim_input() {
    for x in grid().into_iter().filter(|x| !x.starts_with(r"\\?\")) {
        assert_eq!(s(&x), x, "changed a non-verbatim path");
    }
}

#[test]
fn law_only_strips_the_prefix_never_rewrites_the_rest() {
    for x in grid() {
        let out = s(&x);
        let allowed = out == x
            || x.strip_prefix(r"\\?\UNC\").map(|r| format!(r"\\{r}")) == Some(out.clone())
            || (!x.starts_with(r"\\?\UNC\") && x.strip_prefix(r"\\?\") == Some(out.as_str()));
        assert!(allowed, "{x} -> {out} is not a prefix strip");
    }
}

#[test]
fn law_clean_disk_and_unc_paths_always_lose_the_prefix() {
    let roots = [
        (r"\\?\C:\", r"C:\"),
        (r"\\?\z:\", r"z:\"),
        (r"\\?\UNC\srv\share\", r"\\srv\share\"),
    ];
    for (verbatim_root, plain_root) in roots {
        // Bodies whose every component the plain spelling cannot reinterpret.
        for body in ["a.md", r"dir\a.md", r"笔记\中文.md"] {
            let x = format!("{verbatim_root}{body}");
            assert_eq!(s(&x), format!("{plain_root}{body}"), "on {x}");
        }
    }
}
