//! ADR-0047 WI-009 WI 4: window generations and page readiness (plan
//! WI-009 items 7, 20).
use super::*;

fn ready(g: &Generations, label: &str) {
    g.started(label);
    g.finished(label);
}

#[test]
fn a_window_with_no_page_load_yet_is_not_ready() {
    let g = Generations::default();
    let f = g.begin("main").unwrap_err();
    assert_eq!(f.code, "page_not_ready");
    assert!(f.driver_failure);
}

#[test]
fn a_page_still_loading_is_not_ready() {
    let g = Generations::default();
    g.started("main");
    assert_eq!(g.begin("main").unwrap_err().code, "page_not_ready");
}

#[test]
fn a_loaded_page_admits_a_request_that_ends_on_the_same_generation() {
    let g = Generations::default();
    ready(&g, "main");
    let gen = g.begin("main").expect("ready");
    assert!(g.end("main", gen).is_ok());
}

#[test]
fn a_reload_during_a_request_fails_it() {
    let g = Generations::default();
    ready(&g, "main");
    let gen = g.begin("main").expect("ready");
    ready(&g, "main");
    let f = g.end("main", gen).unwrap_err();
    assert_eq!(f.code, "window_reloaded");
    assert!(f.driver_failure);
}

#[test]
fn a_reload_that_has_only_started_also_fails_it() {
    let g = Generations::default();
    ready(&g, "main");
    let gen = g.begin("main").expect("ready");
    g.started("main");
    assert_eq!(g.end("main", gen).unwrap_err().code, "window_reloaded");
}

#[test]
fn a_close_during_a_request_fails_it() {
    let g = Generations::default();
    ready(&g, "main");
    let gen = g.begin("main").expect("ready");
    g.closed("main");
    let f = g.end("main", gen).unwrap_err();
    assert_eq!(f.code, "window_closed");
    assert!(f.driver_failure);
    assert_eq!(g.begin("main").unwrap_err().code, "page_not_ready");
}

#[test]
fn each_load_is_a_new_generation_and_the_new_one_is_admitted() {
    let g = Generations::default();
    ready(&g, "main");
    let first = g.begin("main").expect("ready");
    ready(&g, "main");
    let second = g.begin("main").expect("ready again");
    assert_ne!(first, second);
    assert!(g.end("main", second).is_ok());
}

#[test]
fn windows_are_tracked_apart() {
    let g = Generations::default();
    ready(&g, "main");
    ready(&g, "doc-2");
    let gen = g.begin("main").expect("ready");
    ready(&g, "doc-2");
    assert!(g.end("main", gen).is_ok());
}

#[test]
fn a_reopened_label_never_reuses_an_old_generation() {
    let g = Generations::default();
    ready(&g, "doc-2");
    let old = g.begin("doc-2").expect("ready");
    g.closed("doc-2");
    ready(&g, "doc-2");
    assert_eq!(g.end("doc-2", old).unwrap_err().code, "window_reloaded");
}
