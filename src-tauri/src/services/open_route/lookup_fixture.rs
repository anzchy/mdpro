//! Test fixture for `open_route::lookup`: a unique temp dir with real files,
//! a real file symlink and a real directory symlink, plus store builders.
//! Test-only, and Unix-only (symlinks); registered under `cfg(all(test, unix))`.
//!
//! Layout: `<dir>/real/{a.md, b.md, alias.md -> a.md}` and `<dir>/link -> real`.
//! Raw paths go through `link/`, so they are non-canonical on every Unix
//! (not only where `temp_dir()` itself sits behind an alias, as on macOS).
use crate::models::mcp::WindowState;
use crate::models::{DocumentState, ShadowStore};
use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;

/// A unique directory under `temp_dir()` (layout in the module doc). Removed
/// (this directory only) when dropped.
pub(super) struct Fixture {
    dir: PathBuf,
    /// Raw (non-canonical) path of `a.md`, through the `link/` dir symlink.
    pub a: String,
    /// Raw path of `b.md`, through `link/`.
    pub b: String,
    /// Raw path of the file symlink `alias.md` pointing at `a.md`, through `link/`.
    pub alias: String,
    /// `std::fs::canonicalize` of `a.md`.
    pub canon_a: String,
    /// A second alias of `a.md` with no symlink in the last component:
    /// `<dir>/real/./a.md`. Textually different from `a` and `canon_a`.
    pub dotted_a: String,
    /// `/private` + the raw path of `a.md` (the macOS `/var -> /private/var` alias).
    #[cfg(target_os = "macos")]
    pub private_a: String,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("mdpro-open-route-{}", uuid::Uuid::new_v4()));
        let real = dir.join("real");
        let link = dir.join("link");
        fs::create_dir_all(&real).expect("create fixture dir");
        fs::write(real.join("a.md"), "a").expect("write a.md");
        fs::write(real.join("b.md"), "b").expect("write b.md");
        symlink(real.join("a.md"), real.join("alias.md")).expect("symlink alias.md");
        symlink(&real, &link).expect("symlink link -> real");
        let s = |p: &PathBuf| p.to_string_lossy().into_owned();
        let a = s(&link.join("a.md"));
        let canon_a = s(&fs::canonicalize(&a).expect("canonicalize a.md"));
        let dotted_a = format!("{}/./a.md", s(&real));
        // Preconditions: the raw path is non-canonical, and the dotted alias
        // names the same file while differing as a string.
        assert_ne!(canon_a, a, "fixture needs a non-canonical raw path");
        assert_ne!(dotted_a, a);
        assert_ne!(dotted_a, canon_a);
        assert_eq!(
            s(&fs::canonicalize(&dotted_a).expect("canonicalize dotted form")),
            canon_a,
            "fixture needs real/./a.md to name the same file"
        );
        #[cfg(target_os = "macos")]
        let private_a = {
            let private_a = format!("/private{}", a);
            assert_eq!(
                s(&fs::canonicalize(&private_a).expect("canonicalize /private form")),
                canon_a,
                "fixture needs /private + temp_dir() to name the same file"
            );
            private_a
        };
        Fixture {
            a,
            b: s(&link.join("b.md")),
            alias: s(&link.join("alias.md")),
            canon_a,
            dotted_a,
            #[cfg(target_os = "macos")]
            private_a,
            dir,
        }
    }

    /// A path inside the fixture dir that is never created.
    pub(super) fn missing(&self, name: &str) -> String {
        self.dir.join(name).to_string_lossy().into_owned()
    }

    /// The raw fixture dir, for building non-normalized strings.
    pub(super) fn dir_str(&self) -> String {
        self.dir.to_string_lossy().into_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

pub(super) fn doc(id: &str, path: Option<&str>, dirty: bool) -> DocumentState {
    DocumentState {
        id: id.to_string(),
        title: id.to_string(),
        path: path.map(str::to_string),
        content: String::new(),
        cursor: 0,
        is_dirty: dirty,
        is_active: false,
    }
}

pub(super) fn win(
    label: &str,
    docs: Vec<DocumentState>,
    routable: bool,
    focus: i64,
) -> WindowState {
    WindowState {
        label: label.to_string(),
        active_document_id: docs.first().map(|d| d.id.clone()),
        documents: docs,
        last_focused_at: focus,
        routable,
    }
}

/// A store holding `windows`, inserted in the given order.
pub(super) fn store_of(windows: Vec<WindowState>) -> ShadowStore {
    let mut store = ShadowStore::default();
    for w in windows {
        store.windows.insert(w.label.clone(), w);
    }
    store
}

pub(super) fn live(labels: &[&str]) -> HashSet<String> {
    labels.iter().map(|l| l.to_string()).collect()
}
