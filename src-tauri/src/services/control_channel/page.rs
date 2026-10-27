//! Purpose: runs the control channel's page scripts (ADR-0047 WI-009, from
//! candidate B's spike) through `WebviewWindow::eval_with_callback` and
//! returns the awaited result.
//!
//! Pipeline: a constant template (or, with eval on, the caller's script) is
//! wrapped with the request's arguments as a JSON literal → it starts and
//! stores its settled value in `window.__mdproCtl[id]` → the server polls that
//! slot until it fills or the timeout passes.
//!
//! Key decisions:
//! - `eval_with_callback` does not await a Promise, hence the slot and the poll
//!   (S1.5: a Promise is awaited).
//! - Caller data reaches a fixed template only as `serde_json` output, a JSON
//!   literal, never as source (S1.3).
//! - On timeout the id is tombstoned, so a late settle is dropped, not stored
//!   for a later reader (S1.5: a late result is discarded). The page counts
//!   each drop, and the next read hands the count back to be logged (item 6).

use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{Runtime, WebviewWindow};

use super::proto::Failure;

const POLL_EVERY: Duration = Duration::from_millis(15);
const EVAL_CALL_WAIT: Duration = Duration::from_secs(2);

/// Finds one element: `{using: "css"|"xpath", value, index?}`; a negative index counts from the end.
const PICK: &str = r##"function pick(a){var n=[];if(a.using==="xpath"){var s=document.evaluate(a.value,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);for(var i=0;i<s.snapshotLength;i++)n.push(s.snapshotItem(i));}else{n=Array.prototype.slice.call(document.querySelectorAll(a.value));}var k=a.index||0;if(k<0)k=n.length+k;return {all:n,el:n[k]||null};}"##;

const FIND: &str = r##"function(a){var p=pick(a),el=p.el;if(!el)return {found:false,count:p.all.length};var r=el.getBoundingClientRect();return {found:true,count:p.all.length,rect:{x:r.x,y:r.y,w:r.width,h:r.height},text:(el.innerText!==undefined?el.innerText:el.textContent),tag:el.tagName.toLowerCase(),attrs:{"class":el.getAttribute("class"),id:el.id||null,ariaLabel:el.getAttribute("aria-label"),role:el.getAttribute("role")},selected:!!(el.checked||el.selected),displayed:!!(r.width||r.height)};}"##;

const COUNT: &str = r##"function(a){return pick(a).all.length;}"##;

/// Document-start buffer. Each webview owns one instance; the plugin injects
/// this before any frontend module in every window.
pub const INIT_SCRIPT: &str = r##"(function(){
if(window.__mdproConsole)return;
var b=window.__mdproConsole={entries:[],overflow:0,capacity:100,sequence:0};
function capture(source,args){var text=Array.prototype.map.call(args,function(v){try{return String(v);}catch(_){return '[unprintable]';}}).join(' ');
b.entries.push({sequence:++b.sequence,source:source,text:text});
if(b.entries.length>b.capacity){b.entries.shift();b.overflow++;}}
['error','warn'].forEach(function(level){var original=console[level];console[level]=function(){capture('console.'+level,arguments);return original.apply(console,arguments);};});
window.addEventListener('error',function(e){capture('error',[e.message||'']);});
window.addEventListener('unhandledrejection',function(e){capture('unhandledrejection',[e.reason]);});
})()"##;

/// Fixed v1 template. Element and selected-range text use textContent for
/// stable whitespace; the range traversal never clones live DOM nodes.
/// Attributes, tag names and buffered console strings name their actual source.
const PROBE: &str = r##"function(a){function t(e){return e?e.textContent:null;}function selected(){var s=window.getSelection();if(!s)return null;var text='';for(var i=0;i<s.rangeCount;i++){var r=s.getRangeAt(i),root=r.commonAncestorContainer,w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),n=root.nodeType===3?root:w.nextNode();while(n){if(r.intersectsNode(n)){var v=n.textContent||'',start=n===r.startContainer?r.startOffset:0,end=n===r.endContainer?r.endOffset:v.length;text+=v.slice(start,end);}n=w.nextNode();}}return text;}
function tabs(){return Array.prototype.map.call(document.querySelectorAll(".bottom-tab"),function(b){return {name:t(b.querySelector(".bottom-tab__name")),active:b.classList.contains("bottom-tab--active"),dirty:!!b.querySelector(".bottom-tab__modified")};});}
var shell=document.querySelector('.app-shell');var ready=!!(shell&&shell.getAttribute('aria-busy')==='false');
var active=ready?document.querySelector('[role="tab"][aria-selected="true"]'):null;
var prompts=Array.prototype.map.call(document.querySelectorAll('[role="dialog"]'),function(d){var id=d.getAttribute('aria-labelledby');return {type:d.classList.contains('mcp-confirm-dialog')?'mcp-confirm':'confirm',name:d.getAttribute('aria-label')||t(id&&document.getElementById(id))||null};});
var b=window.__mdproConsole;var o={probeVersion:1,windowLabels:Array.isArray(a.windowLabels)?a.windowLabels:[],ready:ready,activeDocument:active?t(active.querySelector('.bottom-tab__name')):null,dirty:active?!!active.querySelector('.bottom-tab__modified'):null,mode:ready?shell.getAttribute('data-view-mode'):null,prompts:prompts,console:{entries:b?b.entries.slice():[],overflow:b?b.overflow:0,capacity:b?b.capacity:100},sources:{probeVersion:'Rust:probe template',windowLabels:'Rust',ready:'DOM:aria-busy',activeDocument:'DOM:textContent',dirty:'DOM',mode:'DOM',prompts:'DOM:dialog elements','prompts.type':'DOM:classList','prompts.name':'DOM:aria-label or textContent',console:'Rust:injected page buffer','console.entries':'Rust:injected page buffer','console.entries.sequence':'Rust:injected page buffer','console.entries.source':'Rust:injected page buffer','console.entries.text':'Rust:injected page buffer','console.overflow':'Rust:injected page buffer','console.capacity':'Rust:injected page buffer',tabs:'DOM:bottom-tab elements','tabs.name':'DOM:textContent','tabs.active':'DOM:classList','tabs.dirty':'DOM:dirty marker'},tabs:tabs()};
if(a.kind==="cm"){var l=document.querySelectorAll(".cm-content > .cm-line");o.lastLine=l.length?t(l[l.length-1]):null;o.lines=l.length;o.selectionLayers=document.querySelectorAll(".cm-selectionBackground").length;o.selectedText=selected();Object.assign(o.sources,{lastLine:'DOM:textContent',lines:'DOM:cm-line elements',selectionLayers:'DOM:cm-selectionBackground elements',selectedText:'DOM:textContent (Selection ranges; replaces Selection.toString)'});}
if(a.kind==="pm"){var pm=document.querySelector("#milkdown-container .ProseMirror");var last=pm?pm.lastElementChild:null;o.lastBlock=t(last);o.lastTag=last?last.tagName.toLowerCase():null;o.lastStrong=last?Array.prototype.map.call(last.querySelectorAll("strong"),t):[];o.selectedText=selected();Object.assign(o.sources,{lastBlock:'DOM:textContent',lastTag:'DOM:tagName',lastStrong:'DOM:textContent',selectedText:'DOM:textContent (Selection ranges; replaces Selection.toString)'});}
if(a.kind==="dialog"){o.dialog=Array.prototype.map.call(document.querySelectorAll(".dialog-card[role=dialog]"),function(c){return c.getAttribute("aria-label");});var cb=document.querySelector("#md-auto-pair");o.checkbox=cb?cb.checked:null;o.settings=document.querySelectorAll(".settings-dialog").length;Object.assign(o.sources,{dialog:'DOM:aria-label',checkbox:'DOM:checked',settings:'DOM:settings-dialog elements'});}
if(a.kind==="focus"){var ae=document.activeElement;o.active=ae?(ae.tagName+"."+(ae.className||"")):null;o.inDialog=!!(ae&&ae.closest&&ae.closest(".dialog-card"));o.hasFocus=document.hasFocus();Object.assign(o.sources,{active:'DOM:activeElement tagName and className',inDialog:'DOM:activeElement closest',hasFocus:'DOM:document.hasFocus'});}
return o;}"##;

/// What a page command runs.
pub enum Script<'a> {
    Find,
    Count,
    Probe,
    /// Caller-supplied, only when eval is enabled at launch.
    Eval(&'a str),
}

pub(super) fn body(script: &Script<'_>) -> String {
    match script {
        Script::Find => format!("(function(){{{PICK} return {FIND};}})()"),
        Script::Count => format!("(function(){{{PICK} return {COUNT};}})()"),
        Script::Probe => format!("(function(){{return {PROBE};}})()"),
        Script::Eval(src) => format!("(async function(args){{\n{src}\n}})"),
    }
}

pub(super) fn starter(id_json: &str, f: &str, args_json: &str) -> String {
    format!(
        r#"(function(){{var S=window.__mdproCtl=window.__mdproCtl||{{}};S.__dead=S.__dead||{{}};var id={id_json};
function put(r){{if(S.__dead[id]){{delete S.__dead[id];S.__dropped=(S.__dropped||0)+1;return;}}S[id]=r;}}
try{{Promise.resolve(({f})({args_json})).then(function(v){{put({{ok:true,v:v===undefined?null:v}});}},function(e){{put({{ok:false,e:String(e&&e.message||e)}});}});}}catch(e){{put({{ok:false,e:String(e&&e.message||e)}});}}
return true;}})()"#
    )
}

fn reader(id_json: &str) -> String {
    format!(
        "(function(){{var S=window.__mdproCtl||{{}};var r=S[{id_json}];var d=S.__dropped||0;S.__dropped=0;if(r===undefined)r=null;else delete S[{id_json}];return JSON.stringify({{r:r,d:d}});}})()"
    )
}

fn tombstone(id_json: &str) -> String {
    format!(
        "(function(){{var S=window.__mdproCtl=window.__mdproCtl||{{}};S.__dead=S.__dead||{{}};if(S[{id_json}]!==undefined){{delete S[{id_json}];}}else{{S.__dead[{id_json}]=1;}}return true;}})()"
    )
}

/// One `eval_with_callback`, waiting briefly for its JSON-encoded completion value.
fn eval_once<R: Runtime>(win: &WebviewWindow<R>, js: String) -> Result<Value, Failure> {
    let (tx, rx) = mpsc::channel::<String>();
    win.eval_with_callback(js, move |s| {
        let _ = tx.send(s);
    })
    .map_err(|e| Failure::new("script_error", format!("eval failed: {e}")))?;
    let raw = rx
        .recv_timeout(EVAL_CALL_WAIT)
        .map_err(|_| Failure::new("script_error", "the webview did not answer"))?;
    serde_json::from_str(&raw)
        .map_err(|e| Failure::new("script_error", format!("unreadable result: {e}")))
}

/// The reader's answer, `JSON.stringify({r, d})`: the settled slot, if any,
/// and how many timed-out results the page discarded since the last read.
pub fn parse_reader(raw: &Value) -> Result<(Option<Value>, u64), Failure> {
    let unreadable = || Failure::new("script_error", "unreadable slot");
    let text = raw.as_str().ok_or_else(unreadable)?;
    let v: Value = serde_json::from_str(text).map_err(|_| unreadable())?;
    let dropped = v.get("d").and_then(Value::as_u64).ok_or_else(unreadable)?;
    let slot = match v.get("r") {
        None | Some(Value::Null) => None,
        Some(r) => Some(r.clone()),
    };
    Ok((slot, dropped))
}

/// Runs `script` with `args` in `win` and returns its settled value.
/// `dropped` hears how many earlier, timed-out results the page discarded.
pub fn run<R: Runtime>(
    win: &WebviewWindow<R>,
    req_id: &str,
    script: Script<'_>,
    args: &Value,
    timeout: Duration,
    dropped: &dyn Fn(u64),
) -> Result<Value, Failure> {
    let slot = format!("{req_id}#{}", rand::random::<u32>());
    let id_json = json!(slot).to_string();
    eval_once(win, starter(&id_json, &body(&script), &args.to_string()))?;
    let deadline = Instant::now() + timeout;
    loop {
        let (filled, late) = parse_reader(&eval_once(win, reader(&id_json))?)?;
        if late > 0 {
            dropped(late);
        }
        if let Some(r) = filled {
            return if r["ok"] == json!(true) {
                Ok(r["v"].clone())
            } else {
                Err(Failure::new(
                    "script_error",
                    r["e"].as_str().unwrap_or("error").to_string(),
                ))
            };
        }
        if Instant::now() >= deadline {
            let _ = eval_once(win, tombstone(&id_json));
            return Err(Failure::timeout());
        }
        std::thread::sleep(POLL_EVERY);
    }
}

#[cfg(test)]
#[path = "page_tests.rs"]
mod page_tests;
