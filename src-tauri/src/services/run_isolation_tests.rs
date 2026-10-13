//! ADR-0047 WI-002 WI-8: every `production` root in
//! `src-tauri/persistence-roots.json` resolves inside a temp `$HOME`, through
//! the real production path functions (acceptance 1, the main evidence).
//!
//! Matrix: `.claude/tdd-guardian/tests-20261003-061500.md` (r1), WI8-T01..T06.
//! Runs under both `cargo test` and `cargo test --features verify-run`.
//!
//! Law: every root is a function of `HOME` alone (T05, two-HOME metamorphic),
//! and the registry's `production` root ids and the resolver table are a
//! bijection (T01). `production-other-os` and `production-guard` entries carry
//! no resolvable root here and are counted, never silently dropped (T02).
//!
//! Every HOME-mutating test holds `crate::HOME_LOCK`; `HOME` is restored before
//! the lock is released. The real home is captured once, compared by path
//! prefix only, and never read or printed.

use super::run_isolation_fixtures::Locked;
use crate::commands::mcp::{get_client_config_path, McpClient};
use crate::services::{draft, http_server, logger, preferences};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const REGISTRY: &str = include_str!("../../persistence-roots.json");

type Resolved = Result<PathBuf, String>;
/// `(root id, production function, resolver)`. Several rows may share a root.
type Row = (&'static str, &'static str, fn() -> Resolved);

/// Claude Desktop's config relative to HOME, per OS, as
/// `mcp::get_client_config_path` builds it (D193: the macOS path was used on
/// every OS). Windows has no row: there the path comes from
/// `dirs::config_dir()`, which does not follow HOME, so this file cannot run.
#[cfg(target_os = "macos")]
const CLAUDE_DESKTOP_REL: &str = "Library/Application Support/Claude/claude_desktop_config.json";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const CLAUDE_DESKTOP_REL: &str = ".config/Claude/claude_desktop_config.json";

/// Every `McpClient`, with its root id and the path relative to HOME on this OS.
/// The `match` makes a new variant a compile error here until it is added.
fn client(c: McpClient) -> (&'static str, &'static str) {
    match c {
        McpClient::ClaudeDesktop => ("mcp-client/claude_desktop", CLAUDE_DESKTOP_REL),
        McpClient::ClaudeCode => ("mcp-client/claude_code", ".claude/settings.json"),
        McpClient::CodexCli => ("mcp-client/codex_cli", ".codex/config.toml"),
        McpClient::GeminiCli => ("mcp-client/gemini_cli", ".config/gemini/settings.json"),
    }
}
const CLIENTS: [McpClient; 4] = [
    McpClient::ClaudeDesktop,
    McpClient::ClaudeCode,
    McpClient::CodexCli,
    McpClient::GeminiCli,
];

fn some(p: Option<PathBuf>) -> Resolved {
    p.ok_or_else(|| "resolver returned None".to_string())
}

fn resolvers() -> Vec<Row> {
    vec![
        ("home/.mdpro", "preferences::config_path", || {
            preferences::config_path().map_err(|e| format!("{e:?}"))
        }),
        ("home/.mdpro", "logger::log_path", || {
            some(logger::log_path())
        }),
        (
            "home/.mdpro/drafts",
            "draft::migration::legacy_drafts_dir",
            || some(draft::legacy_drafts_dir()),
        ),
        ("data/mdpro", "http_server::config_dir", || {
            some(http_server::config_dir())
        }),
        ("data/mdpro/drafts", "draft::paths::drafts_dir", || {
            draft::drafts_dir().map_err(|e| format!("{e:?}"))
        }),
        (
            "mcp-client/claude_desktop",
            "mcp::get_client_config_path(ClaudeDesktop)",
            || get_client_config_path(McpClient::ClaudeDesktop),
        ),
        (
            "mcp-client/claude_code",
            "mcp::get_client_config_path(ClaudeCode)",
            || get_client_config_path(McpClient::ClaudeCode),
        ),
        (
            "mcp-client/codex_cli",
            "mcp::get_client_config_path(CodexCli)",
            || get_client_config_path(McpClient::CodexCli),
        ),
        (
            "mcp-client/gemini_cli",
            "mcp::get_client_config_path(GeminiCli)",
            || get_client_config_path(McpClient::GeminiCli),
        ),
    ]
}

/// The registry split by scope.
#[derive(Debug, Default)]
struct Partition {
    production_roots: BTreeSet<String>,
    production_entries: usize,
    skipped_other_os: usize,
    skipped_guard: usize,
    test: usize,
    unknown: Vec<String>,
    total: usize,
}

fn partition() -> Partition {
    let reg: serde_json::Value = serde_json::from_str(REGISTRY).expect("registry parses");
    let sites = reg["sites"].as_array().expect("registry has a sites array");
    let mut p = Partition {
        total: sites.len(),
        ..Partition::default()
    };
    for s in sites {
        match s["scope"].as_str().unwrap_or("") {
            "production" => {
                p.production_entries += 1;
                let roots = match &s["root"] {
                    serde_json::Value::Array(xs) => xs.clone(),
                    one => vec![one.clone()],
                };
                for r in roots {
                    p.production_roots
                        .insert(r.as_str().unwrap_or("<not a string>").to_string());
                }
            }
            "production-other-os" => p.skipped_other_os += 1,
            "production-guard" => p.skipped_guard += 1,
            "test" => p.test += 1,
            other => p.unknown.push(other.to_string()),
        }
    }
    p
}

/// Every resolver's output under the current HOME, which must be `home`.
fn resolve_all(home: &Path) -> Vec<(&'static str, &'static str, PathBuf)> {
    resolvers()
        .into_iter()
        .map(|(root, label, f)| {
            let p = f().unwrap_or_else(|e| panic!("{label} ({root}) failed under temp HOME: {e}"));
            assert!(
                p.starts_with(home),
                "{label} ({root}) escaped the temp HOME"
            );
            (root, label, p)
        })
        .collect()
}

#[test]
fn wi8_t01_registry_production_roots_and_resolvers_are_a_bijection() {
    let reg = partition().production_roots;
    let table: BTreeSet<String> = resolvers().iter().map(|r| r.0.to_string()).collect();
    let mut errors: Vec<String> = reg
        .difference(&table)
        .map(|id| format!("unresolvable root {id}"))
        .collect();
    errors.extend(
        table
            .difference(&reg)
            .map(|id| format!("stale resolver {id}")),
    );
    assert!(errors.is_empty(), "{}", errors.join("\n"));
    let clients: BTreeSet<String> = CLIENTS.iter().map(|c| client(*c).0.to_string()).collect();
    assert!(
        clients.is_subset(&reg),
        "every McpClient has a registered root"
    );
    assert!(!reg.is_empty());
}

#[test]
fn wi8_t02_excluded_entries_are_counted_not_dropped() {
    let p = partition();
    let reg: serde_json::Value = serde_json::from_str(REGISTRY).unwrap();
    let count = |scope: &str| {
        reg["sites"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["scope"] == scope)
            .count()
    };
    println!(
        "skipped_other_os={} skipped_guard={}",
        p.skipped_other_os, p.skipped_guard
    );
    assert_eq!(p.skipped_other_os, count("production-other-os"));
    assert_eq!(p.skipped_guard, count("production-guard"));
    assert!(p.unknown.is_empty(), "unknown scopes {:?}", p.unknown);
    assert_eq!(
        p.production_entries + p.skipped_other_os + p.skipped_guard + p.test,
        p.total,
        "every entry lands in exactly one bucket"
    );
}

#[test]
fn wi8_t03_every_root_resolves_inside_temp_home_a() {
    let mut env = Locked::new();
    let a = env.home("A");
    let got = resolve_all(&a);
    assert_eq!(got.len(), resolvers().len());
}

#[test]
fn wi8_t04_root_id_agrees_with_location() {
    let mut env = Locked::new();
    let a = env.home("A");
    // D193: `data/` roots live under `dirs::data_dir()`, which is
    // `Library/Application Support` on macOS and `.local/share` on Linux; the
    // literal was macOS-only. Pinned to the per-OS literal where there is one.
    let data_rel = dirs::data_dir()
        .expect("data_dir()")
        .strip_prefix(&a)
        .expect("data_dir() inside the temp HOME")
        .to_path_buf();
    #[cfg(target_os = "macos")]
    assert_eq!(data_rel, Path::new("Library/Application Support"));
    #[cfg(target_os = "linux")]
    assert_eq!(data_rel, Path::new(".local/share"));
    for (root, label, p) in resolve_all(&a) {
        let rel = p.strip_prefix(&a).unwrap();
        let ok = if let Some(x) = root.strip_prefix("home/") {
            rel.starts_with(x)
        } else if let Some(x) = root.strip_prefix("data/") {
            rel.starts_with(data_rel.join(x))
        } else {
            CLIENTS
                .iter()
                .map(|c| client(*c))
                .any(|(id, path)| id == root && rel == Path::new(path))
        };
        assert!(ok, "{label}: root {root} does not match {rel:?}");
    }
}

#[test]
fn wi8_t05_two_homes_give_the_same_relative_paths() {
    let mut env = Locked::new();
    let a = env.home("A");
    let under_a = resolve_all(&a);
    let b = env.home("B");
    let under_b = resolve_all(&b);
    assert_ne!(a, b);
    for ((root, label, pa), (_, _, pb)) in under_a.iter().zip(under_b.iter()) {
        assert_eq!(
            pa.strip_prefix(&a).unwrap(),
            pb.strip_prefix(&b).unwrap(),
            "{label} ({root}) depends on something other than HOME"
        );
    }
}

#[test]
fn wi8_t06_no_resolver_output_points_into_the_real_home() {
    let mut env = Locked::new();
    let Some(real) = env.real.clone().filter(|r| !r.is_empty()) else {
        println!("SKIPPED: HOME was unset, so there is no real home to leak into");
        return;
    };
    let real = PathBuf::from(real);
    let a = env.home("A");
    assert!(
        !a.starts_with(&real),
        "temp HOME under the real home: the check would be vacuous"
    );
    for (root, label, p) in resolve_all(&a) {
        assert!(
            !p.starts_with(&real),
            "{label} ({root}) resolved into the real home"
        );
    }
}
