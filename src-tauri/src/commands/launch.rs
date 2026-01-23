use tauri::State;

use crate::launch::LaunchState;
use crate::services::logger;

#[tauri::command]
pub fn get_launch_paths(state: State<LaunchState>) -> Vec<String> {
    let paths = state.take_paths();
    logger::log_line(&format!("command get_launch_paths: {:?}", paths));
    paths
}
