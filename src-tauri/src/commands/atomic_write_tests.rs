//! D70: two saves of the same file must not share a temp file.
//!
//! `atomic_write` used `.{name}.{pid}.tmp` opened with `File::create`, so two
//! concurrent writes to one target truncated and rewrote the same temp inode:
//! the target could end up holding a splice of both payloads, and the losing
//! `rename` failed with ENOENT (a false "Save failed").

use super::atomic_write;

fn test_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("mdpro_atomic_write_test")
        .join(format!("{label}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn tmp_leftovers(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect()
}

/// Size of each concurrent payload: large enough that writes overlap in time.
const PAYLOAD_BYTES: usize = 2 * 1024 * 1024;
const WRITERS: usize = 6;
const ROUNDS: usize = 8;

#[test]
fn concurrent_writes_to_one_target_never_interleave_or_fail() {
    let dir = test_dir("concurrent");
    let target = dir.join("doc.md");
    std::fs::write(&target, b"original").unwrap();

    let payloads: std::sync::Arc<Vec<Vec<u8>>> = std::sync::Arc::new(
        (0..WRITERS)
            .map(|i| vec![b'a' + i as u8; PAYLOAD_BYTES - i])
            .collect(),
    );

    for round in 0..ROUNDS {
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(WRITERS));
        let handles: Vec<_> = (0..WRITERS)
            .map(|i| {
                let barrier = barrier.clone();
                let target = target.clone();
                let payloads = payloads.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    atomic_write(&target, &payloads[i])
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        for (i, r) in results.iter().enumerate() {
            assert!(r.is_ok(), "round {round}: writer {i} failed: {r:?}");
        }
        let on_disk = std::fs::read(&target).unwrap();
        assert!(
            payloads.contains(&on_disk),
            "round {round}: target is not any single payload (len {})",
            on_disk.len()
        );
        assert!(
            tmp_leftovers(&dir).is_empty(),
            "round {round}: stray temp files: {:?}",
            tmp_leftovers(&dir)
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn each_write_uses_a_distinct_temp_path() {
    let dir = test_dir("distinct");
    let target = dir.join("doc.md");
    let a = super::atomic_temp_path(&dir, &target);
    let b = super::atomic_temp_path(&dir, &target);
    assert_ne!(a, b, "two writes to one target must not share a temp file");
    assert_eq!(
        a.parent(),
        Some(dir.as_path()),
        "temp must be in the target's dir"
    );
    let name = a.file_name().unwrap().to_string_lossy().into_owned();
    assert!(
        name.starts_with(".doc.md.") && name.ends_with(".tmp"),
        "got {name}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
