//! Admission result boundary: an owner may enter startup; every refusal stops it.

use super::macos::AdmissionError;
use super::{Admission, Owner};

pub trait RefusalEffects {
    fn persist_failure(&mut self, message: &str) -> bool;
    fn write_stderr(&mut self, message: &str);
    fn show_native_alert(&mut self, message: &str) -> bool;
}

pub enum EntryDecision {
    Continue(Owner),
    Exit(i32),
}

pub fn settle_admission(
    result: Result<Admission, AdmissionError>,
    gui: bool,
    effects: &mut impl RefusalEffects,
) -> EntryDecision {
    match result {
        Ok(Admission::Owner(owner)) => EntryDecision::Continue(owner),
        Ok(Admission::Forwarded) => EntryDecision::Exit(0),
        Ok(Admission::Refused) | Err(_) => {
            let message = "mdpro could not admit this launch. Check Activity Monitor or run \
                           `pgrep -fl mdpro` to confirm no mdpro process remains. Only then \
                           remove /tmp/com_mdpro_app_si.sock and relaunch. If a process remains \
                           or ownership is uncertain, contact support.";
            let _ = effects.persist_failure(message);
            effects.write_stderr(message);
            if gui {
                let _ = effects.show_native_alert(message);
            }
            EntryDecision::Exit(1)
        }
    }
}
