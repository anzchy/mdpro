use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_DIR_ID: AtomicU64 = AtomicU64::new(0);

fn copy_fixture() -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "mdpro-d255-copy-{}-{}",
        std::process::id(),
        TEST_DIR_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let project = root.join("project");
    let external = root.join("external");
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(&external).unwrap();
    let doc = project.join("doc.md");
    fs::write(&doc, "# test").unwrap();
    (root, doc, external)
}

async fn copy(doc: &Path, source: &Path) -> Result<CopyExternalImageResult, ImageError> {
    copy_external_image(
        doc.to_string_lossy().into_owned(),
        source.to_string_lossy().into_owned(),
        None,
    )
    .await
}

#[tokio::test]
async fn copy_external_image_same_basename_preserves_both_sources() {
    let (root, doc, external) = copy_fixture();
    let first = external.join("first/photo.png");
    let second = external.join("second/photo.png");
    fs::create_dir_all(first.parent().unwrap()).unwrap();
    fs::create_dir_all(second.parent().unwrap()).unwrap();
    fs::write(&first, b"first bytes").unwrap();
    fs::write(&second, b"second bytes").unwrap();
    let one = copy(&doc, &first).await.unwrap();
    let two = copy(&doc, &second).await.unwrap();
    assert_eq!(fs::read(&one.absolute_path).unwrap(), b"first bytes");
    assert_eq!(fs::read(&two.absolute_path).unwrap(), b"second bytes");
    assert_ne!(one.absolute_path, two.absolute_path);
    assert_eq!(two.relative_path, "./assets/photo-1.png");
    assert_eq!(two.markdown_syntax, "![](./assets/photo-1.png)");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn copy_external_image_preserves_existing_referenced_asset() {
    let (root, doc, external) = copy_fixture();
    let source = external.join("photo.png");
    let asset = doc.parent().unwrap().join("assets/photo.png");
    fs::create_dir_all(asset.parent().unwrap()).unwrap();
    fs::write(&source, b"new bytes").unwrap();
    fs::write(&asset, b"referenced bytes").unwrap();
    let copied = copy(&doc, &source).await.unwrap();
    assert_eq!(fs::read(&asset).unwrap(), b"referenced bytes");
    assert_eq!(fs::read(&copied.absolute_path).unwrap(), b"new bytes");
    assert_ne!(copied.absolute_path, asset.to_string_lossy());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn copy_external_image_never_writes_through_final_symlinks() {
    use std::os::unix::fs::symlink;
    let (root, doc, external) = copy_fixture();
    let source = external.join("photo.png");
    let outside = external.join("outside.png");
    let assets = doc.parent().unwrap().join("assets");
    fs::create_dir_all(&assets).unwrap();
    fs::write(&source, b"new bytes").unwrap();
    fs::write(&outside, b"outside bytes").unwrap();
    symlink(&outside, assets.join("photo.png")).unwrap();
    let copied = copy(&doc, &source).await.unwrap();
    assert_eq!(fs::read(&outside).unwrap(), b"outside bytes");
    assert_eq!(fs::read(&copied.absolute_path).unwrap(), b"new bytes");
    assert_ne!(
        copied.absolute_path,
        assets.join("photo.png").to_string_lossy()
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn copy_external_image_dangling_final_symlink_is_not_followed() {
    use std::os::unix::fs::symlink;
    let (root, doc, external) = copy_fixture();
    let source = external.join("photo.png");
    let missing = external.join("missing.png");
    let assets = doc.parent().unwrap().join("assets");
    fs::create_dir_all(&assets).unwrap();
    fs::write(&source, b"new bytes").unwrap();
    symlink(&missing, assets.join("photo.png")).unwrap();
    let copied = copy(&doc, &source).await.unwrap();
    assert!(!missing.exists());
    assert_eq!(fs::read(&copied.absolute_path).unwrap(), b"new bytes");
    assert_ne!(
        copied.absolute_path,
        assets.join("photo.png").to_string_lossy()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn copy_external_image_concurrent_same_names_both_survive() {
    let (root, doc, external) = copy_fixture();
    let first = external.join("first/photo.png");
    let second = external.join("second/photo.png");
    fs::create_dir_all(first.parent().unwrap()).unwrap();
    fs::create_dir_all(second.parent().unwrap()).unwrap();
    fs::write(&first, b"first bytes").unwrap();
    fs::write(&second, b"second bytes").unwrap();
    let a = std::thread::spawn({
        let doc = doc.clone();
        move || {
            tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap()
                .block_on(copy(&doc, &first))
                .unwrap()
        }
    });
    let b = std::thread::spawn({
        let doc = doc.clone();
        move || {
            tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap()
                .block_on(copy(&doc, &second))
                .unwrap()
        }
    });
    let a = a.join().unwrap();
    let b = b.join().unwrap();
    assert_ne!(a.absolute_path, b.absolute_path);
    let mut bytes = [
        fs::read(&a.absolute_path).unwrap(),
        fs::read(&b.absolute_path).unwrap(),
    ];
    bytes.sort();
    assert_eq!(bytes, [b"first bytes".to_vec(), b"second bytes".to_vec()]);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn copy_external_image_removes_partial_file_after_copy_failure() {
    let (root, doc, external) = copy_fixture();
    let unreadable_source = external.join("photo.png");
    fs::create_dir_all(&unreadable_source).unwrap();
    let result = copy(&doc, &unreadable_source).await;
    assert!(matches!(result, Err(ImageError::IoError { .. })));
    assert!(!doc.parent().unwrap().join("assets/photo.png").exists());
    fs::remove_dir_all(root).unwrap();
}
