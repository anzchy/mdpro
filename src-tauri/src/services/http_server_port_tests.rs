//! ADR-0047 WI-002 / WI-6: the MCP port is 55045 feature-off and ephemeral
//! (0) feature-on, and the app env publishes under the current HOME (matrix
//! WI6-T01..T04). No test binds 55045; T03 binds an ephemeral port only.
use super::{app_controller_env, mcp_server_port};
use crate::HOME_LOCK;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

/// A temp HOME under `canonicalize(temp_dir())`, set for the guard's life.
/// Field order: the dir is removed and HOME restored before the lock drops.
struct TempHome {
    dir: PathBuf,
    prev: Option<OsString>,
    _lock: MutexGuard<'static, ()>,
}

impl TempHome {
    fn new() -> Self {
        let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = fs::canonicalize(std::env::temp_dir()).expect("canonical temp dir");
        let dir = tmp.join(format!("mdpro-port-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).expect("create temp HOME");
        let prev = std::env::var_os("HOME");
        // SAFETY: HOME_LOCK is held.
        unsafe { std::env::set_var("HOME", &dir) };
        TempHome {
            dir,
            prev,
            _lock: lock,
        }
    }
}

impl Drop for TempHome {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
        // SAFETY: HOME_LOCK is still held (`_lock` drops after this).
        unsafe {
            match &self.prev {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }
}

/// `dirs::data_dir()/mdpro` under `home`, where production puts the app's
/// files on this OS. D193: this was the macOS path on every OS. The data dir
/// is proven to be inside `home` and, where the OS has one, equal to its
/// literal location there, so the expectation is not production's own call
/// echoed back.
fn mdpro_dir(home: &Path) -> PathBuf {
    let data = dirs::data_dir().expect("data_dir()");
    assert!(
        data.starts_with(home),
        "data_dir() {data:?} escaped HOME {home:?}"
    );
    #[cfg(target_os = "macos")]
    assert_eq!(data, home.join("Library").join("Application Support"));
    #[cfg(target_os = "linux")]
    assert_eq!(data, home.join(".local").join("share"));
    data.join("mdpro")
}

#[cfg(not(feature = "verify-run"))]
#[test]
fn wi6_t01_feature_off_port_is_55045() {
    let _h = TempHome::new();
    assert_eq!(mcp_server_port(), 55045);
    let env = app_controller_env().expect("data_dir()");
    assert_eq!(
        env.bind_addr,
        std::net::SocketAddr::from(([127, 0, 0, 1], 55045))
    );
}

#[cfg(feature = "verify-run")]
#[test]
fn wi6_t02_feature_on_port_is_ephemeral() {
    let _h = TempHome::new();
    assert_eq!(mcp_server_port(), 0);
    let env = app_controller_env().expect("data_dir()");
    assert_eq!(env.bind_addr.port(), 0);
    assert_eq!(env.bind_addr.ip(), std::net::IpAddr::from([127, 0, 0, 1]));
}

#[cfg(feature = "verify-run")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn wi6_t03_feature_on_start_publishes_the_bound_port() {
    use crate::services::mcp_controller::controller::McpController;
    use crate::services::mcp_controller::snapshot::McpPhase;
    use crate::services::mcp_controller::test_routers::plain;
    use std::time::Duration;

    let h = TempHome::new();
    let mut env = app_controller_env().expect("data_dir()");
    env.drain = Duration::from_millis(200);
    env.join_grace = Duration::from_millis(200);
    env.exit_budget = Duration::from_millis(500);
    let c = McpController::new(env);

    let snap = c.start(plain()).await.expect("start snapshot");

    assert_eq!(snap.phase, McpPhase::Running, "{snap:?}");
    let p = snap.port.expect("running port");
    assert_ne!(p, 0);
    assert_ne!(p, 55045);
    let port_file = mdpro_dir(&h.dir).join("server.port");
    let published: u16 = fs::read_to_string(&port_file)
        .expect("read server.port")
        .trim()
        .parse()
        .expect("server.port is a port number");
    assert_eq!(published, p);
    std::net::TcpStream::connect(("127.0.0.1", p)).expect("connect to the bound port");

    c.stop().await.expect("stop snapshot");
    assert!(!port_file.exists(), "server.port survived stop");
}

#[test]
fn wi6_t04_files_dir_follows_home() {
    let h = TempHome::new();
    let env = app_controller_env().expect("data_dir()");
    assert!(
        env.files_dir.starts_with(&h.dir),
        "files_dir not under HOME"
    );
    #[cfg(target_os = "macos")]
    assert!(env.files_dir.ends_with("Library/Application Support/mdpro"));
    #[cfg(target_os = "linux")]
    assert!(env.files_dir.ends_with(".local/share/mdpro"));
    assert_eq!(env.files_dir, mdpro_dir(&h.dir));
}
