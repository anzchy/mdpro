//! D43 WI-3 command source contracts (CS-02, CS-03 of
//! `.claude/tdd-guardian/tests-20261007-143049.md`) over
//! `commands/menu.rs` `sync_recent_files_menu` and `commands/mod.rs`, plus a
//! self-check of the shared `closure_param_feeds_build_menu` helper.

use super::tests::{closure_param_feeds_build_menu, is_ident, COMMAND_SRC};

/// Find `|a, b|` closures and return the argument text of the `build_menu(`
/// call inside the body (up to the first `}`), with the two parameter names.
fn two_param_closures_calling_build_menu(src: &str) -> Vec<(String, String, String)> {
    let mut found = Vec::new();
    for (start, c) in src.char_indices() {
        if c != '|' {
            continue;
        }
        let rest = &src[start + 1..];
        let Some(close) = rest.find('|') else {
            continue;
        };
        let params: Vec<&str> = rest[..close].split(',').map(str::trim).collect();
        if params.len() != 2
            || !params
                .iter()
                .all(|p| !p.is_empty() && p.chars().all(is_ident))
        {
            continue;
        }
        let body = &rest[close + 1..];
        let body = &body[..body.find('}').unwrap_or(body.len())];
        let Some(call) = body.find("build_menu(") else {
            continue;
        };
        let args = &body[call + "build_menu(".len()..];
        let args = &args[..args.find(')').unwrap_or(args.len())];
        found.push((
            params[0].to_string(),
            params[1].to_string(),
            args.to_string(),
        ));
    }
    found
}

fn arg_tokens(args: &str) -> Vec<String> {
    args.split(',')
        .map(|a| {
            let a = a.trim();
            let a = a.strip_prefix('&').unwrap_or(a);
            a.chars().take_while(|&ch| is_ident(ch)).collect()
        })
        .collect()
}

#[test]
fn cs02_command_routes_through_publish_op_and_builds_from_its_closure_args() {
    assert!(
        COMMAND_SRC.matches("publish_op(").count() >= 1,
        "routes through publish_op"
    );
    assert_eq!(
        COMMAND_SRC.matches("recent_files()").count(),
        0,
        "never reads the state"
    );
    assert_eq!(
        COMMAND_SRC.matches("set_recent_files(").count(),
        0,
        "never publishes"
    );
    assert!(
        closure_param_feeds_build_menu(COMMAND_SRC),
        "the closure's list parameter must be build_menu's second argument"
    );
    let closures = two_param_closures_calling_build_menu(COMMAND_SRC);
    assert!(
        closures.iter().any(|(list, mode, args)| {
            let tokens = arg_tokens(args);
            tokens.get(1) == Some(list) && tokens.iter().skip(2).any(|t| t == mode)
        }),
        "build_menu must take the closure's list (2nd arg) and remembered mode: {closures:?}"
    );
    assert!(
        closures
            .iter()
            .all(|(_, _, args)| !arg_tokens(args).iter().any(|t| t == "view_mode")),
        "the command's own view_mode must go to publish_op, not build_menu"
    );
    assert!(
        !COMMAND_SRC.contains("set_recent_files_menu"),
        "old command removed"
    );
    assert!(
        COMMAND_SRC.contains("fn sync_recent_files_menu"),
        "new command present"
    );
}

/// Self-check of the extended helper: it still rejects closures whose first
/// parameter is not `build_menu`'s second argument, and keeps the original
/// single-parameter behaviour.
#[test]
fn closure_param_feeds_build_menu_helper_self_check() {
    let accepts = [
        "|list| { build_menu(&app, list, mode) }",
        "|list| { build_menu(&app, &list, mode) }",
        "|list, mode| { build_menu(&app, list, mode) }",
        "|list, mode, extra| { build_menu(&app, list, mode) }",
    ];
    for src in accepts {
        assert!(closure_param_feeds_build_menu(src), "should accept: {src}");
    }
    let rejects = [
        // first param is not build_menu's second argument
        "|mode, list| { build_menu(&app, list, mode) }",
        "|list, mode| { build_menu(&app, other, mode) }",
        "|list, mode| { build_menu(&app, mode, list) }",
        "|list| { build_menu(&app, other, mode) }",
        // malformed parameter lists / no build_menu in the body
        "|list, | { build_menu(&app, list, mode) }",
        "|list, mode| { set_menu(list) }",
        "|list, mode| { x }; build_menu(&app, list, mode)",
    ];
    for src in rejects {
        assert!(!closure_param_feeds_build_menu(src), "should reject: {src}");
    }
}

#[test]
fn cs03_mod_registers_the_new_command_and_not_the_old() {
    const MOD_SRC: &str = include_str!("commands/mod.rs");
    assert!(MOD_SRC.contains("menu::sync_recent_files_menu"));
    assert!(!MOD_SRC.contains("set_recent_files_menu"));
}
