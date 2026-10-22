use super::effective_image_shortcut;
use serde::Deserialize;

#[derive(Deserialize)]
struct Case {
    platform: String,
    stored: String,
    expected: String,
}

#[test]
fn legacy_image_shortcut_matches_shared_json_cases() {
    let cases: Vec<Case> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/legacy-image-shortcut-cases.json"
    ))
    .expect("fixture parses");
    assert!(cases.len() >= 6);
    for case in cases {
        assert_eq!(
            effective_image_shortcut(case.platform == "macos", &case.stored),
            case.expected,
            "{} stored {:?}",
            case.platform,
            case.stored
        );
    }
}
