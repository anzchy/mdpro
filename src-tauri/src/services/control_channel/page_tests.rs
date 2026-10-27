//! ADR-0047 WI-009 WI 4: the page-script plumbing that runs without a
//! webview (plan WI-009 items 6, 13; spike S1.3).
use super::*;

#[test]
fn an_empty_slot_reads_as_none_with_its_drop_count() {
    let raw = json!(r#"{"r":null,"d":0}"#);
    assert_eq!(parse_reader(&raw).expect("parsed"), (None, 0));
}

#[test]
fn a_filled_slot_and_late_drops_are_both_returned() {
    let raw = json!(r#"{"r":{"ok":true,"v":7},"d":2}"#);
    let (slot, dropped) = parse_reader(&raw).expect("parsed");
    assert_eq!(slot, Some(json!({ "ok": true, "v": 7 })));
    assert_eq!(dropped, 2);
}

#[test]
fn a_reader_answer_that_is_not_its_json_is_a_script_error() {
    for raw in [
        json!(null),
        json!(3),
        json!("not json"),
        json!(r#"{"d":"x"}"#),
    ] {
        assert_eq!(
            parse_reader(&raw).unwrap_err().code,
            "script_error",
            "{raw}"
        );
    }
}

#[test]
fn caller_arguments_enter_a_template_only_as_a_json_literal() {
    let hostile = json!({ "value": "\"});alert(1);//" });
    let js = starter(
        &json!("id#1").to_string(),
        &body(&Script::Find),
        &hostile.to_string(),
    );
    assert!(js.contains(&hostile.to_string()));
    // Every quote that could close the string arrives escaped.
    let breakout = "\"});alert(1);";
    for (i, _) in js.match_indices(breakout) {
        assert_eq!(&js[i - 1..i], "\\", "an unescaped breakout at {i}");
    }
}

#[test]
fn a_late_settle_counts_a_drop_instead_of_filling_the_slot() {
    let js = starter(&json!("id#1").to_string(), &body(&Script::Probe), "{}");
    assert!(js.contains("S.__dropped=(S.__dropped||0)+1"));
}

#[test]
fn probe_descriptor_names_v1_sources_and_text_method() {
    let script = body(&Script::Probe);
    assert!(script.contains("probeVersion:1"));
    assert!(script.contains("DOM:textContent"));
    assert!(script.contains("windowLabels"));
    let generated = starter(
        &json!("descriptor").to_string(),
        &script,
        &json!({ "windowLabels": ["main"] }).to_string(),
    );
    let result = run_starter(&generated, "descriptor");
    assert_eq!(result["result"]["v"]["probeVersion"], json!(1));
    assert_eq!(
        result["result"]["v"]["sources"]["windowLabels"],
        json!("Rust")
    );
    assert_eq!(
        result["result"]["v"]["sources"]["activeDocument"],
        json!("DOM:textContent")
    );
}

#[test]
fn hostile_probe_args_are_only_json_data() {
    let hostile = json!({ "kind": "\"</script>` ${globalThis.attacked=true}" });
    let js = starter(
        &json!("id#</script>").to_string(),
        &body(&Script::Probe),
        &hostile.to_string(),
    );
    assert!(js.contains(&hostile.to_string()));
    assert!(js.contains("probeVersion:1"));
    assert!(!body(&Script::Probe).contains("attacked"));
    let result = run_starter(&js, "id#</script>");
    assert_eq!(result["attacked"], json!(false));
    assert_eq!(result["result"]["ok"], json!(true));
    assert_eq!(result["result"]["v"]["probeVersion"], json!(1));
}

#[test]
fn generated_starter_executes_hostile_id_and_args_as_data() {
    use std::process::Command;

    let id = "id#\"</script>` ${globalThis.__attack=true}";
    let args = json!({
        "kind": "\"</script>` ${globalThis.__attack=true}",
        "windowLabels": ["main"]
    });
    let generated = starter(
        &json!(id).to_string(),
        &body(&Script::Probe),
        &args.to_string(),
    );
    let harness = format!(
        "globalThis.window=globalThis;globalThis.__attack=false;globalThis.document={{querySelector:()=>null,querySelectorAll:()=>[]}};{generated};setTimeout(()=>console.log(JSON.stringify({{result:window.__mdproCtl[{}],attacked:globalThis.__attack}})),0);",
        json!(id)
    );
    let output = Command::new("node")
        .arg("-e")
        .arg(harness)
        .output()
        .expect("Node executes the generated page script");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).expect("settled JSON");
    assert_eq!(result["attacked"], json!(false));
    assert_eq!(result["result"]["ok"], json!(true));
    assert_eq!(result["result"]["v"]["probeVersion"], json!(1));
    assert_eq!(result["result"]["v"]["windowLabels"], json!(["main"]));
}

fn run_starter(generated: &str, id: &str) -> Value {
    use std::process::Command;

    let harness = format!(
        "globalThis.window=globalThis;globalThis.attacked=false;globalThis.document={{querySelector:()=>null,querySelectorAll:()=>[]}};{generated};setTimeout(()=>console.log(JSON.stringify({{result:window.__mdproCtl[{}],attacked:globalThis.attacked}})),0);",
        json!(id)
    );
    let output = Command::new("node")
        .arg("-e")
        .arg(harness)
        .output()
        .expect("execute generated probe");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("settled probe JSON")
}
