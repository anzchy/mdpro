//! D261-WI-1b: every native menu action is bound to one window, resolved
//! from `MenuFocus` when the click arrives, emitted with `emit_to` at most
//! once, and logged exactly once without its `value`.
//!
//! The matrix is `.claude/tdd-guardian/tests-20261017-201500.md` § WI-2,
//! Revision 2 (route, any_live, value in the payload, glue pins) and
//! Revision 3 (the injected log sink). The emitter and the log sink are
//! recording closures; the real `emit_to` and logger are device items DB-1
//! to DB-3.

use super::*;
use crate::services::shadow_store::{create_shadow_store, is_any_window_focused};
use crate::services::window_focus::on_focus_event;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::BTreeSet;

const MENU_SRC: &str = include_str!("menu.rs");
const TARGET_SRC: &str = include_str!("menu_target.rs");
const MAIN_SRC: &str = include_str!("main.rs");

const A: &str = "A";
const B: &str = "B";
const C: &str = "C";

// ---------------------------------------------------------------- helpers

/// `src` without comment lines, so a comment naming a token cannot satisfy
/// or trip a check.
fn code(src: &str) -> String {
    src.lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The text from `start` up to the next `end` after it.
fn slice<'a>(src: &'a str, start: &str, end: &str) -> &'a str {
    let from = src
        .find(start)
        .unwrap_or_else(|| panic!("source has no `{start}`"));
    let rest = &src[from..];
    let to = rest
        .find(end)
        .unwrap_or_else(|| panic!("source has no `{end}` after `{start}`"));
    &rest[..to]
}

/// The body of top-level `fn name` (generic or not), up to its closing `}`
/// at column 0.
fn body_of(src: &str, name: &str) -> String {
    let start = [format!("fn {name}<"), format!("fn {name}(")]
        .iter()
        .filter_map(|n| src.find(n.as_str()))
        .min()
        .unwrap_or_else(|| panic!("no `fn {name}`"));
    let rest = &src[start..];
    let end = rest
        .find("\n}")
        .unwrap_or_else(|| panic!("`fn {name}` has no closing brace"));
    rest[..end].to_string()
}

fn lv(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|l| l.to_string()).collect()
}

/// The five live lists of the decision tables. `[B, A]` is the same set as
/// `[A, B]` in the other order, so "first live label" fails it.
fn lives() -> Vec<Vec<String>> {
    vec![lv(&[]), lv(&[A]), lv(&[B]), lv(&[A, B]), lv(&[B, A])]
}

/// The class decision for every action `menu.rs` emits.
const EXPECTED: &[(&str, ActionClass)] = &[
    ("file.new", ActionClass::App),
    ("file.new_window", ActionClass::App),
    ("file.open", ActionClass::App),
    ("file.open_recent", ActionClass::App),
    ("file.preferences", ActionClass::App),
    ("theme.light", ActionClass::App),
    ("theme.dark", ActionClass::App),
    ("theme.system", ActionClass::App),
    ("file.save", ActionClass::Window),
    ("file.save_as", ActionClass::Window),
    ("file.close", ActionClass::Window),
    ("file.export_html", ActionClass::Window),
    ("cycle-view-mode", ActionClass::Window),
    ("set-view-mode", ActionClass::Window),
    ("view.toggle_sidebar", ActionClass::Window),
    ("view.switch_documents", ActionClass::Window),
    ("view.toggle_fullscreen", ActionClass::Window),
    ("format.highlight", ActionClass::Window),
    ("paragraph.table", ActionClass::Window),
];

fn expected_class(action: &str) -> ActionClass {
    EXPECTED
        .iter()
        .find(|(a, _)| *a == action)
        .map(|(_, c)| *c)
        .unwrap_or_else(|| panic!("no EXPECTED row for {action}"))
}

/// Every action string `handle_menu_event` passes to `emit_menu_action`.
fn emitted_actions() -> BTreeSet<String> {
    let src = code(MENU_SRC);
    let needle = "emit_menu_action(app, \"";
    let set: BTreeSet<String> = src
        .match_indices(needle)
        .map(|(i, _)| {
            let rest = &src[i + needle.len()..];
            rest[..rest.find('"').unwrap()].to_string()
        })
        .collect();
    assert_eq!(
        set.len(),
        19,
        "non-vacuity: 19 emitted actions, got {set:?}"
    );
    set
}

/// The 20 (action, value) pairs: each emitted action with the value(s) its
/// arm sends.
fn action_values() -> Vec<(String, Option<String>)> {
    let mut out = Vec::new();
    for action in emitted_actions() {
        match action.as_str() {
            "file.open_recent" => out.push((action, Some("/tmp/a.md".to_string()))),
            "set-view-mode" => {
                out.push((action.clone(), Some("source".to_string())));
                out.push((action, Some("wysiwyg".to_string())));
            }
            _ => out.push((action, None)),
        }
    }
    assert_eq!(out.len(), 20, "non-vacuity: 20 (action, value) pairs");
    out
}

type Emits = RefCell<Vec<(String, Value)>>;
type Sink = RefCell<Vec<Value>>;

/// An emitter that records `(label, payload as JSON)` and returns `result`.
fn recorder<'a>(
    emits: &'a Emits,
    result: Result<(), &'static str>,
) -> impl FnOnce(&str, &MenuActionPayload) -> Result<(), &'static str> + 'a {
    move |label, payload| {
        emits
            .borrow_mut()
            .push((label.to_string(), serde_json::to_value(payload).unwrap()));
        result
    }
}

/// A log sink that records each entry as JSON.
fn sink(logs: &Sink) -> impl FnOnce(LogEntryPayload) + '_ {
    move |entry| logs.borrow_mut().push(serde_json::to_value(entry).unwrap())
}

fn entry_json(action: &str, outcome: &DispatchOutcome) -> Value {
    serde_json::to_value(dispatch_log_entry(action, outcome)).unwrap()
}

fn payload(action: &str, value: Option<&str>, target: &str) -> Value {
    json!({ "action": action, "value": value, "target": target })
}

/// The resolution law, written independently of `resolve_target`.
fn law(focused: Option<&str>, last: Option<&str>, class: ActionClass, live: &[String]) -> Resolved {
    match (focused, class) {
        (Some(f), _) => Ok((f.to_string(), Via::Focused)),
        (None, ActionClass::Window) => Err(CancelReason::NoFocusedWindow),
        (None, ActionClass::App) => match last {
            Some(l) if live.iter().any(|x| x == l) => Ok((l.to_string(), Via::LastFocused)),
            _ => live
                .iter()
                .min()
                .map(|l| (l.clone(), Via::AnyLive))
                .ok_or(CancelReason::NoLiveWindow),
        },
    }
}

fn via_str(via: Via) -> &'static str {
    match via {
        Via::Focused => "focused",
        Via::LastFocused => "last_focused",
        Via::AnyLive => "any_live",
    }
}

fn reason_str(reason: CancelReason) -> &'static str {
    match reason {
        CancelReason::NoFocusedWindow => "no_focused_window",
        CancelReason::NoLiveWindow => "no_live_window",
    }
}

#[derive(Clone, Copy, Debug)]
enum Ev {
    Focus(&'static str),
    Blur(&'static str),
    Forget(&'static str),
}

const EVENTS: [Ev; 9] = [
    Ev::Focus(A),
    Ev::Focus(B),
    Ev::Focus(C),
    Ev::Blur(A),
    Ev::Blur(B),
    Ev::Blur(C),
    Ev::Forget(A),
    Ev::Forget(B),
    Ev::Forget(C),
];

fn apply_ev(mf: &MenuFocus, ev: Ev) {
    match ev {
        Ev::Focus(l) => mf.apply(l, true),
        Ev::Blur(l) => mf.apply(l, false),
        Ev::Forget(l) => mf.forget(l),
    }
}

fn focus_of(events: &[Ev]) -> MenuFocus {
    let mf = MenuFocus::default();
    for ev in events {
        apply_ev(&mf, *ev);
    }
    mf
}

fn some(l: &str) -> Option<String> {
    Some(l.to_string())
}

/// The MenuFocus law as a backward scan, not a replay of the transitions.
fn oracle(seq: &[Ev]) -> FocusSnapshot {
    let mut cancelled_focus: BTreeSet<&str> = BTreeSet::new();
    let mut forgotten: BTreeSet<&str> = BTreeSet::new();
    for ev in seq.iter().rev() {
        match *ev {
            Ev::Focus(x) => {
                let focused = (!cancelled_focus.contains(x)).then(|| x.to_string());
                let last = (!forgotten.contains(x)).then(|| x.to_string());
                return (focused, last);
            }
            Ev::Blur(x) => {
                cancelled_focus.insert(x);
            }
            Ev::Forget(x) => {
                cancelled_focus.insert(x);
                forgotten.insert(x);
            }
        }
    }
    (None, None)
}

/// Calls `f` with every sequence over `EVENTS` of length 0..=max_len.
fn for_each_sequence(max_len: usize, mut f: impl FnMut(&[Ev])) -> usize {
    let mut count = 0;
    for len in 0..=max_len {
        let mut idx = vec![0usize; len];
        loop {
            let seq: Vec<Ev> = idx.iter().map(|i| EVENTS[*i]).collect();
            f(&seq);
            count += 1;
            let mut pos = 0;
            while pos < len {
                idx[pos] += 1;
                if idx[pos] < EVENTS.len() {
                    break;
                }
                idx[pos] = 0;
                pos += 1;
            }
            if pos == len {
                break;
            }
        }
    }
    count
}

fn permutations(items: &[String]) -> Vec<Vec<String>> {
    if items.len() <= 1 {
        return vec![items.to_vec()];
    }
    let mut out = Vec::new();
    for i in 0..items.len() {
        let mut rest = items.to_vec();
        let head = rest.remove(i);
        for mut tail in permutations(&rest) {
            tail.insert(0, head.clone());
            out.push(tail);
        }
    }
    out
}

/// Checks one log entry against the outcome it was built from, and that no
/// `value` leaked into it.
fn assert_log_shape(action: &str, outcome: &DispatchOutcome, entry: &Value, ctx: &str) {
    let text = entry.to_string();
    assert!(!text.contains("secret"), "{ctx}: value leaked: {text}");
    assert!(!text.contains("\"value\""), "{ctx}: value key: {text}");
    assert_eq!(entry["event"], "menu.action.dispatch", "{ctx}: {text}");
    assert_eq!(entry["context"]["action"], action, "{ctx}: {text}");
    match outcome {
        DispatchOutcome::Success { label, via } => {
            assert_eq!(entry["status"], "success", "{ctx}: {text}");
            assert_eq!(entry["context"]["target"], label.as_str(), "{ctx}: {text}");
            assert_eq!(entry["context"]["via"], via_str(*via), "{ctx}: {text}");
            assert!(entry["error"].is_null(), "{ctx}: {text}");
        }
        DispatchOutcome::Cancel { reason } => {
            assert_eq!(entry["status"], "cancel", "{ctx}: {text}");
            assert!(entry["context"]["target"].is_null(), "{ctx}: {text}");
            assert_eq!(entry["error"], reason_str(*reason), "{ctx}: {text}");
        }
        DispatchOutcome::Fail { label, reason } => {
            assert_eq!(entry["status"], "fail", "{ctx}: {text}");
            assert_eq!(entry["context"]["target"], label.as_str(), "{ctx}: {text}");
            assert_eq!(entry["error"], *reason, "{ctx}: {text}");
        }
    }
}

// ---------------------------------------------------------- MenuFocus law

#[test]
fn d261_menu_focus_law_holds_over_every_sequence_up_to_length_five() {
    let count = for_each_sequence(5, |seq| {
        let mf = MenuFocus::default();
        for (i, ev) in seq.iter().enumerate() {
            apply_ev(&mf, *ev);
            let snap = mf.snapshot();
            assert_eq!(snap, oracle(&seq[..=i]), "prefix {:?}", &seq[..=i]);
            if snap.0.is_some() {
                assert_eq!(snap.0, snap.1, "focused implies last_focused: {seq:?}");
            }
        }
        assert_eq!(mf.snapshot(), oracle(seq), "{seq:?}");
    });
    assert_eq!(count, 66_430, "non-vacuity: every sequence of length 0..=5");
}

#[test]
fn d261_a_stale_blur_after_another_focus_is_harmless() {
    let mf = focus_of(&[Ev::Focus(A), Ev::Focus(B), Ev::Blur(A)]);
    assert_eq!(mf.snapshot(), (some(B), some(B)));
    assert_eq!(
        resolve_target(&mf.snapshot(), ActionClass::Window, &lv(&[A, B])),
        Ok((B.to_string(), Via::Focused))
    );
}

#[test]
fn d261_a_blur_keeps_last_focused_for_app_actions() {
    let mf = focus_of(&[Ev::Focus(A), Ev::Blur(A)]);
    assert_eq!(mf.snapshot(), (None, some(A)));
    assert_eq!(
        resolve_target(&mf.snapshot(), ActionClass::App, &lv(&[A, B])),
        Ok((A.to_string(), Via::LastFocused))
    );
}

#[test]
fn d261_forget_has_no_fallback_chain() {
    // A history stack would give ("C", LastFocused); the ruling gives the
    // lowest live label.
    let mf = focus_of(&[Ev::Focus(C), Ev::Focus(A), Ev::Blur(A), Ev::Forget(A)]);
    assert_eq!(mf.snapshot(), (None, None));
    assert_eq!(
        resolve_target(&mf.snapshot(), ActionClass::App, &lv(&[C, B])),
        Ok((B.to_string(), Via::AnyLive))
    );
}

#[test]
fn d261_main_forgets_only_on_destroyed_and_manages_menu_focus() {
    let main = code(MAIN_SRC);
    let destroyed = slice(&main, "WindowEvent::Destroyed =>", "_ => {}");
    assert!(
        destroyed.contains("forget_window("),
        "Destroyed forgets the window:\n{destroyed}"
    );
    let close = slice(&main, "WindowEvent::CloseRequested", "WindowEvent::Moved");
    assert!(close.lines().count() > 5, "non-vacuity:\n{close}");
    for token in ["forget_window(", ".forget("] {
        assert!(
            !close.contains(token),
            "the vetoable CloseRequested must not forget (`{token}`):\n{close}"
        );
    }
    assert!(
        main.lines()
            .any(|l| l.contains("manage(") && l.contains("MenuFocus::default()")),
        "main.rs manages a MenuFocus"
    );
}

#[test]
fn d261_main_feeds_menu_focus_into_the_one_on_focus_event_call() {
    let main = code(MAIN_SRC);
    let from = main.find("app.run(").expect("main.rs has no `app.run(`");
    let run = &main[from..];
    let arm = &run[run
        .find("RunEvent::WindowEvent")
        .expect("no WindowEvent arm")..];
    let call_at = arm.find("on_focus_event(").expect("no on_focus_event call");
    assert!(
        arm[..call_at]
            .lines()
            .any(|l| l.contains("try_state::<") && l.contains("MenuFocus>()")),
        "MenuFocus is reached through try_state before the call:\n{arm}"
    );
    let call = slice(&arm[call_at..], "on_focus_event(", ");");
    assert!(
        !call.contains("None"),
        "the call passes the managed MenuFocus: {call}"
    );
    assert_eq!(main.matches("on_focus_event(").count(), 1, "one call");
}

#[test]
fn d261_on_focus_event_feeds_menu_focus_and_the_shadow_store() {
    let store = create_shadow_store();
    let mf = MenuFocus::default();
    on_focus_event(Some(&store), Some(&mf), A, true);
    assert_eq!(mf.snapshot(), (some(A), some(A)));
    assert!(is_any_window_focused(&store).unwrap());

    on_focus_event(Some(&store), Some(&mf), A, false);
    assert_eq!(mf.snapshot(), (None, some(A)));
    assert!(!is_any_window_focused(&store).unwrap());

    on_focus_event(Some(&store), None, B, true);
    assert_eq!(mf.snapshot(), (None, some(A)), "no MenuFocus, no write");
    assert!(is_any_window_focused(&store).unwrap());
}

// ---------------------------------------------------------------- classify

#[test]
fn d261_classification_table_equals_the_emitted_set() {
    let emitted = emitted_actions();
    let table: BTreeSet<String> = EXPECTED.iter().map(|(a, _)| a.to_string()).collect();
    assert_eq!(
        table, emitted,
        "every emitted action has one class decision"
    );
    for (action, class) in EXPECTED {
        assert_eq!(classify(action), *class, "{action}");
    }
}

#[test]
fn d261_an_unknown_action_classifies_as_window() {
    for action in [
        "",
        "quit",
        "FILE.NEW",
        "file.newx",
        "file.new ",
        "themes.dark",
    ] {
        assert_eq!(classify(action), ActionClass::Window, "{action:?}");
    }
}

#[test]
fn d261_quit_and_escape_arms_still_emit_nothing() {
    let menu = code(MENU_SRC);
    let handler = body_of(&menu, "handle_menu_event");
    for marker in ["MENU_APP_STOP_WAITING_QUIT =>", "MENU_APP_QUIT =>"] {
        let at = handler
            .find(marker)
            .unwrap_or_else(|| panic!("no `{marker}`"));
        let rest = &handler[at + marker.len()..];
        let arm = &rest[..rest.find(" =>").expect("a following arm")];
        for token in ["emit_menu_action", "route(", "dispatch("] {
            assert!(!arm.contains(token), "`{marker}` arm has `{token}`: {arm}");
        }
    }
    let quit = body_of(&menu, "request_guarded_quit");
    for token in ["emit_menu_action", "route(", "dispatch("] {
        assert!(!quit.contains(token), "request_guarded_quit has `{token}`");
    }
}

// ---------------------------------------------------------- resolve_target

#[test]
fn d261_resolve_target_decision_table_90_rows() {
    let labels = [None, Some(A), Some(B)];
    let mut rows = 0;
    for focused in labels {
        for last in labels {
            for class in [ActionClass::App, ActionClass::Window] {
                for live in lives() {
                    let snap = (focused.map(String::from), last.map(String::from));
                    assert_eq!(
                        resolve_target(&snap, class, &live),
                        law(focused, last, class, &live),
                        "focused={focused:?} last={last:?} class={class:?} live={live:?}"
                    );
                    rows += 1;
                }
            }
        }
    }
    assert_eq!(rows, 90);
}

#[test]
fn d261_any_live_examples_required_by_the_ruling() {
    // (i) nothing ever focused, App-class: the lowest live label.
    let (emits, logs) = (Emits::default(), Sink::default());
    let mf = MenuFocus::default();
    let out = route(
        "file.new",
        None,
        &mf,
        &lv(&[B, A]),
        recorder(&emits, Ok(())),
        sink(&logs),
    );
    let want = DispatchOutcome::Success {
        label: A.to_string(),
        via: Via::AnyLive,
    };
    assert_eq!(out, want);
    assert_eq!(
        *emits.borrow(),
        vec![(A.to_string(), payload("file.new", None, A))]
    );
    let entry = entry_json("file.new", &out);
    assert_eq!(entry["status"], "success");
    assert_eq!(entry["context"]["via"], "any_live");
    assert_eq!(entry["context"]["target"], "A");
    assert_eq!(*logs.borrow(), vec![entry]);

    // (ii) the same state, Window-class: cancelled.
    let (emits, logs) = (Emits::default(), Sink::default());
    let out = route(
        "file.save",
        None,
        &mf,
        &lv(&[B, A]),
        recorder(&emits, Ok(())),
        sink(&logs),
    );
    assert_eq!(
        out,
        DispatchOutcome::Cancel {
            reason: CancelReason::NoFocusedWindow
        }
    );
    assert!(emits.borrow().is_empty());
    let entry = entry_json("file.save", &out);
    assert_eq!(entry["status"], "cancel");
    assert_eq!(entry["error"], "no_focused_window");
    assert_eq!(*logs.borrow(), vec![entry]);

    // (iii) no live window at all.
    let (emits, logs) = (Emits::default(), Sink::default());
    let out = route(
        "theme.dark",
        None,
        &mf,
        &[],
        recorder(&emits, Ok(())),
        sink(&logs),
    );
    assert_eq!(
        out,
        DispatchOutcome::Cancel {
            reason: CancelReason::NoLiveWindow
        }
    );
    assert!(emits.borrow().is_empty());
    let entry = entry_json("theme.dark", &out);
    assert_eq!(entry["status"], "cancel");
    assert_eq!(entry["error"], "no_live_window");
    assert_eq!(*logs.borrow(), vec![entry]);
}

#[test]
fn d261_any_live_does_not_depend_on_live_order() {
    let names = ["main", "window-2", "window-10"];
    let mut checked = 0;
    for mask in 1u8..8 {
        let subset: Vec<String> = names
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, n)| n.to_string())
            .collect();
        for last in [None, Some("main"), Some("window-2"), Some("gone")] {
            let snap = (None, last.map(String::from));
            let perms = permutations(&subset);
            let first = resolve_target(&snap, ActionClass::App, &perms[0]);
            assert!(first.is_ok(), "a live window exists: {subset:?}");
            for p in &perms {
                assert_eq!(
                    resolve_target(&snap, ActionClass::App, p),
                    first,
                    "order changed the result: {p:?} last={last:?}"
                );
                checked += 1;
            }
        }
    }
    assert_eq!(checked, 4 * (3 + 3 * 2 + 6), "non-vacuity");
    assert_eq!(
        resolve_target(
            &(None, None),
            ActionClass::App,
            &lv(&["window-2", "window-10"])
        ),
        Ok(("window-10".to_string(), Via::AnyLive)),
        "byte order, not numeric order"
    );
}

#[test]
fn d261_focused_target_examples() {
    let mf = focus_of(&[Ev::Focus(A)]);
    assert_eq!(
        resolve_target(&mf.snapshot(), ActionClass::Window, &lv(&[A])),
        Ok((A.to_string(), Via::Focused))
    );
    let mf = focus_of(&[Ev::Focus(A), Ev::Focus(B)]);
    assert_eq!(
        resolve_target(&mf.snapshot(), ActionClass::Window, &lv(&[A, B])),
        Ok((B.to_string(), Via::Focused))
    );
}

// ---------------------------------------------------------------- dispatch

#[test]
fn d261_success_emits_once_to_the_resolved_label_with_target() {
    let (emits, logs) = (Emits::default(), Sink::default());
    let out = dispatch(
        "file.save",
        None,
        Ok((B.to_string(), Via::Focused)),
        recorder(&emits, Ok(())),
        sink(&logs),
    );
    assert_eq!(
        *emits.borrow(),
        vec![(
            B.to_string(),
            json!({"action":"file.save","value":null,"target":"B"})
        )]
    );
    assert_eq!(
        out,
        DispatchOutcome::Success {
            label: B.to_string(),
            via: Via::Focused
        }
    );
    assert_eq!(*logs.borrow(), vec![entry_json("file.save", &out)]);
}

#[test]
fn d261_the_payload_carries_value_for_every_emitted_action() {
    let mut n = 0;
    for (action, value) in action_values() {
        for label in [A, B] {
            for via in [Via::Focused, Via::LastFocused, Via::AnyLive] {
                let (emits, logs) = (Emits::default(), Sink::default());
                dispatch(
                    &action,
                    value.clone(),
                    Ok((label.to_string(), via)),
                    recorder(&emits, Ok(())),
                    sink(&logs),
                );
                assert_eq!(
                    *emits.borrow(),
                    vec![(label.to_string(), payload(&action, value.as_deref(), label))],
                    "{action} {value:?} {label} {via:?}"
                );
                n += 1;
            }
        }
    }
    assert_eq!(n, 120, "non-vacuity");
}

#[test]
fn d261_no_target_means_no_emit_and_cancel_with_the_reason() {
    for (action, reason) in [
        ("file.close", CancelReason::NoFocusedWindow),
        ("file.new", CancelReason::NoLiveWindow),
    ] {
        let (emits, logs) = (Emits::default(), Sink::default());
        let out = dispatch(
            action,
            None,
            Err(reason),
            recorder(&emits, Ok(())),
            sink(&logs),
        );
        assert!(emits.borrow().is_empty(), "{action}: no emit");
        assert_eq!(out, DispatchOutcome::Cancel { reason });
        assert_eq!(*logs.borrow(), vec![entry_json(action, &out)], "{action}");
    }
}

#[test]
fn d261_emit_err_is_fail_with_one_attempt_and_a_fixed_reason() {
    let (emits, logs) = (Emits::default(), Sink::default());
    let out = dispatch(
        "file.save",
        None,
        Ok((A.to_string(), Via::Focused)),
        recorder(&emits, Err("boom")),
        sink(&logs),
    );
    assert_eq!(emits.borrow().len(), 1, "one attempt, no retry");
    assert_eq!(emits.borrow()[0].0, A);
    assert_eq!(
        out,
        DispatchOutcome::Fail {
            label: A.to_string(),
            reason: EMIT_FAILED
        }
    );
    assert!(!EMIT_FAILED.is_empty() && !EMIT_FAILED.contains("boom"));
    assert_eq!(*logs.borrow(), vec![entry_json("file.save", &out)]);
    assert!(!logs.borrow()[0].to_string().contains("boom"));
}

#[test]
fn d261_the_label_is_fixed_at_resolution() {
    let mut n = 0;
    for x in [A, B, C] {
        for ev in EVENTS {
            let mf = focus_of(&[Ev::Focus(x)]);
            let target = resolve_target(&mf.snapshot(), ActionClass::Window, &lv(&[A, B, C]));
            apply_ev(&mf, ev);
            let (emits, logs) = (Emits::default(), Sink::default());
            dispatch(
                "file.save",
                None,
                target,
                recorder(&emits, Ok(())),
                sink(&logs),
            );
            assert_eq!(
                *emits.borrow(),
                vec![(x.to_string(), payload("file.save", None, x))],
                "focus {x} then {ev:?}"
            );
            n += 1;
        }
    }
    assert_eq!(n, 27);
}

#[test]
fn d261_the_dispatch_log_line_never_carries_value() {
    let secret = Some("/secret/path.md".to_string());
    let resolutions: Vec<(Resolved, Result<(), &'static str>)> = vec![
        (Ok((A.to_string(), Via::Focused)), Ok(())),
        (Ok((A.to_string(), Via::LastFocused)), Ok(())),
        (Ok((A.to_string(), Via::AnyLive)), Ok(())),
        (Err(CancelReason::NoFocusedWindow), Ok(())),
        (Err(CancelReason::NoLiveWindow), Ok(())),
        (Ok((A.to_string(), Via::Focused)), Err("emit failed")),
    ];
    let mut n = 0;
    for action in emitted_actions() {
        for (resolved, emit_result) in &resolutions {
            let (emits, logs) = (Emits::default(), Sink::default());
            let out = dispatch(
                &action,
                secret.clone(),
                resolved.clone(),
                recorder(&emits, *emit_result),
                sink(&logs),
            );
            let logged = logs.borrow();
            assert_eq!(logged.len(), 1, "{action}: one line");
            assert_log_shape(&action, &out, &logged[0], &action);
            assert_log_shape(&action, &out, &entry_json(&action, &out), &action);
            n += 1;
        }
    }
    assert_eq!(n, 19 * 6, "non-vacuity");
}

#[test]
fn d261_dispatch_logs_exactly_one_dispatch_log_entry() {
    let src = code(TARGET_SRC);
    let body = body_of(&src, "dispatch");
    assert_eq!(body.matches("log(").count(), 1, "one log call:\n{body}");
    assert!(
        body.contains("log(dispatch_log_entry("),
        "the line is dispatch_log_entry's:\n{body}"
    );
    for token in ["log_event", "eprintln!", "println!"] {
        assert!(!body.contains(token), "dispatch has `{token}`:\n{body}");
    }
}

// ------------------------------------------------------- route and the glue

#[test]
fn d261_no_menu_action_broadcast_remains_under_src() {
    fn rs_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                rs_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    rs_files(&root, &mut files);
    assert!(files.len() >= 50, "non-vacuity: {} files", files.len());
    let broadcast = concat!(".emit(", "\"menu:action\"");
    for file in &files {
        let text = code(&std::fs::read_to_string(file).unwrap());
        assert!(!text.contains(broadcast), "{} broadcasts", file.display());
    }

    let glue = format!("{}\n{}", code(MENU_SRC), code(TARGET_SRC));
    assert!(
        glue.lines()
            .any(|l| l.contains("emit_to(") && l.contains("\"menu:action\"")),
        "menu:action goes through emit_to"
    );

    let route_body = body_of(&code(TARGET_SRC), "route");
    let at = |t: &str| {
        route_body
            .find(t)
            .unwrap_or_else(|| panic!("route lacks `{t}`:\n{route_body}"))
    };
    assert!(at("classify(") < at("resolve_target("), "{route_body}");
    assert!(at("resolve_target(") < at("dispatch("), "{route_body}");
}

#[test]
fn d261_route_decision_table_logs_one_line_per_call() {
    let states: [(&[Ev], Option<&str>, Option<&str>); 5] = [
        (&[], None, None),
        (&[Ev::Focus(A), Ev::Blur(A)], None, Some(A)),
        (&[Ev::Focus(B), Ev::Blur(B)], None, Some(B)),
        (&[Ev::Focus(A)], Some(A), Some(A)),
        (&[Ev::Focus(B)], Some(B), Some(B)),
    ];
    let mut n = 0;
    for (events, focused, last) in states {
        for (action, value) in action_values() {
            for live in lives() {
                let mf = focus_of(events);
                let (emits, logs) = (Emits::default(), Sink::default());
                let out = route(
                    &action,
                    value.clone(),
                    &mf,
                    &live,
                    recorder(&emits, Ok(())),
                    sink(&logs),
                );
                let ctx = format!("{events:?} {action} {value:?} {live:?}");
                match law(focused, last, expected_class(&action), &live) {
                    Ok((label, via)) => {
                        assert_eq!(
                            out,
                            DispatchOutcome::Success {
                                label: label.clone(),
                                via
                            },
                            "{ctx}"
                        );
                        assert_eq!(
                            *emits.borrow(),
                            vec![(label.clone(), payload(&action, value.as_deref(), &label))],
                            "{ctx}"
                        );
                    }
                    Err(reason) => {
                        assert_eq!(out, DispatchOutcome::Cancel { reason }, "{ctx}");
                        assert!(emits.borrow().is_empty(), "{ctx}");
                    }
                }
                assert_eq!(*logs.borrow(), vec![entry_json(&action, &out)], "{ctx}");
                n += 1;
            }
        }
    }
    assert_eq!(n, 500, "non-vacuity");
}

#[test]
fn d261_emit_menu_action_supplies_managed_focus_live_labels_and_the_logger() {
    let body = body_of(&code(MENU_SRC), "emit_menu_action");
    assert_eq!(body.matches("route(").count(), 1, "one route call:\n{body}");
    for token in [
        "classify(",
        "resolve_target(",
        "dispatch(",
        "MenuFocus::default()",
    ] {
        assert!(!body.contains(token), "glue has `{token}`:\n{body}");
    }
    assert!(body.contains("try_state::<MenuFocus>()"), "{body}");
    assert!(
        !body.contains(".state::<MenuFocus>"),
        "no panicking state():\n{body}"
    );
    assert!(
        body.contains("webview_windows()"),
        "real live labels:\n{body}"
    );
    assert!(
        body.lines()
            .any(|l| l.contains("emit_to(") && l.contains("\"menu:action\"")),
        "{body}"
    );
    let call = &body[body.find("route(").unwrap()..];
    let call = &call[..call.find(");").expect("route call ends")];
    let last_arg = call
        .trim_end()
        .trim_end_matches(',')
        .rsplit(',')
        .next()
        .unwrap();
    assert!(
        last_arg.contains("log_event"),
        "the real logger: {last_arg}"
    );
}

#[test]
fn d261_only_the_three_emitted_theme_actions_are_app_class() {
    for action in ["theme.light", "theme.dark", "theme.system"] {
        assert_eq!(classify(action), ActionClass::App, "{action}");
    }
    for action in ["theme.", "theme.bogus", "theme.dark ", "theme.Light"] {
        assert_eq!(classify(action), ActionClass::Window, "{action:?}");
    }
}

mod d319_tests {
    include!("menu_target_d319_tests.rs");
}
