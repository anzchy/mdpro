//! Purpose: per-window page generations for the control channel (ADR-0047
//! WI-009 WI 4, plan items 7 and 20). Each page load gives its window a new
//! generation; a request records the generation it began on and fails if the
//! page reloaded or the window closed before it ended.
//!
//! Key decisions:
//! - One counter for every window, so a label that is closed and reopened
//!   never sees an old generation again.
//! - A window with no finished load is not ready: a page command there is a
//!   driver failure (`page_not_ready`), not the script's own error. The spike
//!   reported it as `script_error`.
//! - Fed by the plugin's page-load and window-destroyed hooks (`mod.rs`).

use std::collections::HashMap;
use std::sync::Mutex;

use super::proto::Failure;

#[derive(Clone, Copy)]
struct Page {
    generation: u64,
    ready: bool,
}

#[derive(Default)]
pub struct Generations {
    inner: Mutex<(u64, HashMap<String, Page>)>,
}

impl Generations {
    fn with<T>(&self, f: impl FnOnce(&mut u64, &mut HashMap<String, Page>) -> T) -> T {
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        let (next, pages) = &mut *guard;
        f(next, pages)
    }

    /// A load began in `label`: a new generation, not ready yet.
    pub fn started(&self, label: &str) {
        self.with(|next, pages| {
            *next += 1;
            pages.insert(
                label.to_string(),
                Page {
                    generation: *next,
                    ready: false,
                },
            );
        });
    }

    /// The load in `label` finished. A finish with no start is a new load.
    pub fn finished(&self, label: &str) {
        let known = self.with(|_, pages| match pages.get_mut(label) {
            Some(p) => {
                p.ready = true;
                true
            }
            None => false,
        });
        if !known {
            self.started(label);
            self.finished(label);
        }
    }

    pub fn closed(&self, label: &str) {
        self.with(|_, pages| pages.remove(label));
    }

    /// The generation a request on `label` begins on, if its page is ready.
    pub fn begin(&self, label: &str) -> Result<u64, Failure> {
        match self.with(|_, pages| pages.get(label).copied()) {
            Some(p) if p.ready => Ok(p.generation),
            _ => Err(Failure::driver(
                "page_not_ready",
                format!("the page in {label} has not finished loading"),
            )),
        }
    }

    /// Fails if `label` reloaded or closed since `begin` gave `generation`.
    pub fn end(&self, label: &str, generation: u64) -> Result<(), Failure> {
        match self.with(|_, pages| pages.get(label).copied()) {
            None => Err(Failure::driver(
                "window_closed",
                format!("{label} closed during the request"),
            )),
            Some(p) if p.generation != generation => Err(Failure::driver(
                "window_reloaded",
                format!("{label} reloaded during the request"),
            )),
            Some(_) => Ok(()),
        }
    }
}

#[cfg(test)]
#[path = "generation_tests.rs"]
mod generation_tests;
