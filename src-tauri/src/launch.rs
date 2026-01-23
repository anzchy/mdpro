use std::sync::Mutex;
use std::path::PathBuf;

use crate::services::logger;

#[derive(Default)]
pub struct LaunchState {
    paths: Mutex<Vec<String>>,
}

impl LaunchState {
    pub fn set_paths(&self, paths: Vec<String>) {
        if let Ok(mut data) = self.paths.lock() {
            logger::log_line(&format!(
                "launch_state.set_paths: count={} paths={:?}",
                paths.len(),
                paths
            ));
            *data = paths;
        }
    }

    pub fn take_paths(&self) -> Vec<String> {
        if let Ok(mut data) = self.paths.lock() {
            let paths = data.clone();
            data.clear();
            logger::log_line(&format!(
                "launch_state.take_paths: count={} paths={:?}",
                paths.len(),
                paths
            ));
            return paths;
        }
        Vec::new()
    }
}

pub fn filter_launch_paths<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| {
            let path = PathBuf::from(arg);
            path.exists()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
                    .unwrap_or(false)
        })
        .collect()
}
