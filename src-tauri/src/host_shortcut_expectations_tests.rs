pub(super) fn host_has_default_image_shortcut() -> bool {
    cfg!(target_os = "macos")
}
