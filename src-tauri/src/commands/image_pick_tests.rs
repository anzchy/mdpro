use super::{selected_path, IMAGE_EXTENSIONS};
use std::path::PathBuf;

#[test]
fn picker_filters_supported_image_extensions() {
    assert_eq!(
        IMAGE_EXTENSIONS,
        &["png", "jpg", "jpeg", "gif", "webp", "bmp"]
    );
}

#[test]
fn picker_cancel_is_none_and_selection_is_a_path() {
    assert_eq!(selected_path(None), None);
    assert_eq!(
        selected_path(Some(PathBuf::from("/tmp/汉字.png"))),
        Some("/tmp/汉字.png".to_string())
    );
}
