//! D190-WI-4 (delegator ruling, decision 1c): off macOS the ADR-0036 escape
//! item sits directly after Exit, as it sits after Quit on macOS. The only
//! item allowed between them is the mutually exclusive predefined Quit arm.

fn normalized_menu_source() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/menu.rs");
    let source = std::fs::read_to_string(path).expect("menu.rs is readable");
    source.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn eo1_escape_item_directly_follows_exit() {
    let src = normalized_menu_source();
    let exit = src
        .find("MENU_APP_QUIT, \"Exit\"")
        .expect("the guarded Exit item is built");
    let after = &src[exit..];
    let escape = after
        .find("MENU_APP_STOP_WAITING_QUIT,")
        .expect("the escape item is built after Exit");
    let between = &after[..escape];
    assert!(
        !between.contains(".separator()"),
        "no separator between Exit and the escape: {between}"
    );
    assert!(
        !between.contains(".build()"),
        "both items are in the same menu: {between}"
    );
    let others = between.matches(".item(").count();
    let predefined = between.matches(".item(&PredefinedMenuItem::quit(").count();
    assert_eq!(
        others,
        predefined + 1,
        "only the exclusive predefined Quit arm may sit between: {between}"
    );
}
