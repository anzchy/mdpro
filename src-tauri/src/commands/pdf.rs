//! WI-1 — PDF export window-free helpers.
//!
//! Purpose: house the I/O-error mapper and the byte-writing helper that the
//! HTML and PDF export commands share, so the duplicated `io::ErrorKind` match
//! lives in exactly one tested place. The live WKWebView print path is driven
//! by `export::export_pdf` (deferred to manual/E2E); only these pure helpers
//! are covered by `cargo test`.

use std::path::{Path, PathBuf};

use crate::commands::export::ExportError;

/// Derive the print-ready HTML sidecar target (`<dir>`, `<stem>.html`) from the
/// path the user chose in the save dialog. Extracted from `export::export_pdf`
/// so the non-dialog-bound part of the command — directory + filename
/// derivation, including the empty/extension-only fallbacks — is unit-testable
/// without a live `rfd` window. `fallback_title` is used when the chosen path
/// has no usable file stem (e.g. a bare `.pdf`).
pub fn pdf_sidecar_target(chosen: &Path, fallback_title: &str) -> (PathBuf, String) {
    // `Path::parent` returns `Some("")` for a bare filename and `None` only for
    // the root / empty path — treat both "" and None as the current directory.
    let dir = match chosen.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };
    // A leading-dot name like ".pdf" yields a `file_stem` of ".pdf" (a dotfile
    // with no extension), and a bare "." has an empty stem — fall back to the
    // document title in both cases so the sidecar name is never ".html" or
    // ".pdf.html".
    let stem = chosen
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty() && !s.starts_with('.'))
        .unwrap_or_else(|| fallback_title.to_string());
    (dir, format!("{stem}.html"))
}

/// Map a `std::io::ErrorKind` to the shared `ExportError` variant. Single source
/// of truth for the previously-duplicated match in `export_html` /
/// `export_rendered_html`.
pub fn map_io_error(kind: std::io::ErrorKind, path: &str) -> ExportError {
    match kind {
        std::io::ErrorKind::PermissionDenied => ExportError::PermissionDenied {
            path: path.to_string(),
        },
        std::io::ErrorKind::WriteZero | std::io::ErrorKind::OutOfMemory => ExportError::DiskFull,
        _ => ExportError::ExportFailed {
            message: format!("io error: {kind:?}"),
        },
    }
}

/// Write `bytes` to `dir/name`, returning the absolute path string on success.
/// I/O failures are mapped through [`map_io_error`] so callers surface a typed
/// `ExportError` and never panic.
pub fn write_pdf_bytes(dir: &Path, name: &str, bytes: &[u8]) -> Result<String, ExportError> {
    let target = dir.join(name);
    let path_string = target.to_string_lossy().to_string();
    std::fs::write(&target, bytes).map_err(|err| map_io_error(err.kind(), &path_string))?;
    Ok(path_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::export::ExportError;
    use std::io::ErrorKind;

    // B1: PermissionDenied maps to ExportError::PermissionDenied carrying the path.
    #[test]
    fn map_permission_denied() {
        let err = map_io_error(ErrorKind::PermissionDenied, "/some/locked.pdf");
        match err {
            ExportError::PermissionDenied { path } => assert_eq!(path, "/some/locked.pdf"),
            other => panic!("expected PermissionDenied, got {other:?}"),
        }
    }

    // B2: WriteZero maps to DiskFull.
    #[test]
    fn map_write_zero_is_disk_full() {
        assert!(matches!(
            map_io_error(ErrorKind::WriteZero, "/x"),
            ExportError::DiskFull
        ));
    }

    // B3: OutOfMemory maps to DiskFull.
    #[test]
    fn map_out_of_memory_is_disk_full() {
        assert!(matches!(
            map_io_error(ErrorKind::OutOfMemory, "/x"),
            ExportError::DiskFull
        ));
    }

    // B4: any other kind maps to ExportFailed.
    #[test]
    fn map_other_is_export_failed() {
        assert!(matches!(
            map_io_error(ErrorKind::NotFound, "/x"),
            ExportError::ExportFailed { .. }
        ));
    }

    // B5: write_pdf_bytes returns the joined path string on success.
    #[test]
    fn write_returns_joined_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let returned = write_pdf_bytes(dir.path(), "out.pdf", b"%PDF-1.7\n%%EOF\n")
            .expect("write should succeed");
        let expected = dir.path().join("out.pdf");
        assert_eq!(returned, expected.to_string_lossy());
    }

    // B6: bytes round-trip — written file is non-empty and starts with %PDF.
    #[test]
    fn write_round_trips_pdf_bytes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fixture: &[u8] = b"%PDF-1.7\n%%EOF\n";
        write_pdf_bytes(dir.path(), "rt.pdf", fixture).expect("write");
        let read = std::fs::read(dir.path().join("rt.pdf")).expect("read back");
        assert!(read.len() > 0, "written PDF must be non-empty");
        assert!(read.starts_with(b"%PDF"), "must start with %PDF magic");
    }

    // B7: a bad path under a nonexistent parent errors without panicking.
    #[test]
    fn write_bad_path_errors_no_panic() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bad_parent = dir.path().join("does-not-exist");
        let result = write_pdf_bytes(&bad_parent, "x.pdf", b"%PDF");
        assert!(result.is_err(), "writing under a missing parent must error");
    }

    // B8: sidecar target derives <dir> + "<stem>.html" from the chosen .pdf path.
    #[test]
    fn sidecar_target_uses_chosen_dir_and_stem() {
        let (dir, name) = pdf_sidecar_target(Path::new("/tmp/docs/report.pdf"), "fallback");
        assert_eq!(dir, PathBuf::from("/tmp/docs"));
        assert_eq!(name, "report.html");
    }

    // B9: a chosen path whose stem is a dotfile (bare ".pdf") falls back to the
    // title, never producing a hidden/extension-only sidecar name.
    #[test]
    fn sidecar_target_dotfile_stem_falls_back_to_title() {
        let (dir, name) = pdf_sidecar_target(Path::new("/tmp/.pdf"), "My Doc");
        assert_eq!(dir, PathBuf::from("/tmp"));
        assert_eq!(name, "My Doc.html");
    }

    // B10: a bare filename has an empty parent ("") — derive "." as the dir.
    #[test]
    fn sidecar_target_bare_filename_uses_dot_dir() {
        let (dir, name) = pdf_sidecar_target(Path::new("report.pdf"), "fallback");
        assert_eq!(dir, PathBuf::from("."));
        assert_eq!(name, "report.html");
    }
}

