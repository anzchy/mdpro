use tauri::State;

use crate::launch::LaunchState;

#[tauri::command]
pub fn get_launch_paths(state: State<LaunchState>) -> Vec<String> {
    state.take_paths()
}
