//! Full ordered descriptor parity against the pre-WI-2 v1 menu tree.
//! The native AppKit result is a separate device check (Amendment 3).

use super::*;
use crate::menu_layout::{menu_layout, Availability, KeyKind, MenuPath, Platform};
use crate::models::KeyboardShortcuts;
use crate::services::applied_shortcuts::{resolve_applied, AppliedSource};

const APP_MAC: &[&str] = &[
    "app.about",
    "|",
    "file.preferences",
    "|",
    "services",
    "|",
    "app.hide",
    "app.hideOthers",
    "app.showAll",
    "|",
    "app.quit",
    "app.stopWaitingQuit",
];
const APP_OFF: &[&str] = &[
    "app.about",
    "|",
    "file.preferences",
    "|",
    "app.quit",
    "app.stopWaitingQuit",
];
const FILE: &[&str] = &[
    "file.new",
    "file.newWindow",
    "file.open",
    "open_recent",
    "|",
    "file.save",
    "file.exportHtml",
    "|",
    "file.close",
];
const EDIT: &[&str] = &[
    "edit.undo",
    "edit.redo",
    "|",
    "edit.cut",
    "edit.copy",
    "edit.paste",
    "|",
    "edit.selectAll",
];
const VIEW: &[&str] = &[
    "view.cycleViewMode",
    "|",
    "view.source",
    "view.wysiwyg",
    "|",
    "view.sidebar",
];
const FORMAT: &[&str] = &["format.highlight", "paragraph.table"];
const THEME: &[&str] = &["theme.light", "theme.dark", "theme.system"];
const WINDOW: &[&str] = &["window.minimize", "window.zoom", "|", "window.closeWindow"];
const HELP: &[&str] = &["help.mdproHelp"];

fn enabled(availability: Availability, mode: ViewMode) -> bool {
    match availability {
        Availability::Both => true,
        Availability::W => mode == ViewMode::Wysiwyg,
        Availability::S => mode == ViewMode::Source,
        Availability::None => false,
    }
}

fn descriptor_tree(platform: Platform, mode: ViewMode) -> Vec<String> {
    let layout = menu_layout().unwrap();
    let applied = AppliedShortcuts {
        keyboard_shortcuts_version: 1,
        source: AppliedSource::Loaded,
        bindings: resolve_applied(&KeyboardShortcuts::default()),
    };
    // build_menu -> specs_for_app -> menu_layout_for on macOS. Off-Mac
    // menu_item_or consumes the same fallback tuple entry tested below.
    let mac_specs = menu_layout_for(layout, &applied, Some(mode));
    let is_mac = platform == Platform::Macos;
    let roots = [
        ("mdpro", if is_mac { APP_MAC } else { APP_OFF }),
        ("File", FILE),
        ("Edit", EDIT),
        ("View", VIEW),
        ("Format", FORMAT),
        ("Theme", THEME),
        ("Window", WINDOW),
        ("Help", HELP),
    ];
    let mut out = Vec::new();
    for (menu, tokens) in roots {
        out.push(format!("[{menu}]"));
        for token in tokens {
            match *token {
                "|" => out.push("—".into()),
                "services" => out.push("Services|native.services|on|-".into()),
                "open_recent" => {
                    out.push("Open Recent|native.recent|on|-".into());
                    out.push("No Recent Files|menu.file.recent.empty|off|-".into());
                }
                id => {
                    let row = layout.rows.iter().find(|row| row.id == id).unwrap();
                    let path = match platform {
                        Platform::Macos => &row.menu.macos,
                        Platform::Windows => &row.menu.windows,
                        Platform::Linux => &row.menu.linux,
                    };
                    let MenuPath::Path(path) = path else {
                        panic!("missing {id} on {platform:?}")
                    };
                    let title = path.last().unwrap().as_str();
                    let native_id = row.menu_id.as_deref().unwrap_or(id);
                    let (on, key) = if is_mac && row.key.macos.kind == KeyKind::Configurable {
                        let (_, title_from_constructor, on, key) =
                            item_parts_or(Some(&mac_specs), native_id, title, false, None).unwrap();
                        assert_eq!(title_from_constructor, title);
                        (on, key.map(str::to_string))
                    } else if is_mac {
                        (
                            enabled(row.availability.macos.v1, mode),
                            row.key
                                .macos
                                .default_at(false)
                                .map(|key| key.replace("Option", "Alt")),
                        )
                    } else {
                        let availability = if platform == Platform::Windows {
                            row.availability.windows.v1
                        } else {
                            row.availability.linux.v1
                        };
                        let on = enabled(availability, mode);
                        let key = if matches!(id, "view.source" | "view.wysiwyg") {
                            None
                        } else {
                            (if platform == Platform::Windows {
                                &row.key.windows
                            } else {
                                &row.key.linux
                            })
                            .default_at(false)
                            .map(|key| key.replace("Cmd", "Ctrl").replace("Option", "Alt"))
                        };
                        let (_, title_from_constructor, on, key) =
                            item_parts_or(None, native_id, title, on, key.as_deref()).unwrap();
                        assert_eq!(title_from_constructor, title);
                        (on, key.map(str::to_string))
                    };
                    out.push(format!(
                        "{title}|{native_id}|{}|{}",
                        if on { "on" } else { "off" },
                        key.as_deref().unwrap_or("-")
                    ));
                }
            }
        }
    }
    out
}

const MAC_W_BASELINE: &str = "[mdpro]
About mdpro|app.about|on|-
—
Preferences...|menu.file.preferences|on|Cmd+,
—
Services|native.services|on|-
—
Hide mdpro|app.hide|on|Cmd+H
Hide Others|app.hideOthers|on|Cmd+Alt+H
Show All|app.showAll|on|-
—
Quit mdpro|menu.app.quit|on|Cmd+Q
Stop Waiting and Quit…|menu.app.stop_waiting_quit|on|-
[File]
New|menu.file.new|on|Cmd+N
New Window|menu.file.new_window|on|Cmd+Shift+N
Open...|menu.file.open|on|Cmd+O
Open Recent|native.recent|on|-
No Recent Files|menu.file.recent.empty|off|-
—
Save|menu.file.save|on|Cmd+S
Export HTML...|menu.file.export_html|on|Cmd+Shift+E
—
Close|menu.file.close|on|Cmd+W
[Edit]
Undo|edit.undo|on|Cmd+Z
Redo|edit.redo|on|Cmd+Shift+Z
—
Cut|edit.cut|on|Cmd+X
Copy|edit.copy|on|Cmd+C
Paste|edit.paste|on|Cmd+V
—
Select All|edit.selectAll|on|Cmd+A
[View]
Cycle View Mode|menu.view.cycle|on|Cmd+/
—
Source|menu.view.source|on|Ctrl+2
WYSIWYG|menu.view.wysiwyg|on|Ctrl+4
—
Toggle Sidebar|menu.view.toggle_sidebar|on|Cmd+Shift+L
[Format]
Highlight Selection|menu.format.highlight|on|Cmd+Shift+H
Insert Table|menu.format.insert_table|on|Cmd+Alt+T
[Theme]
Light|menu.theme.light|on|-
Dark|menu.theme.dark|on|-
System|menu.theme.system|on|-
[Window]
Minimize|window.minimize|on|Cmd+M
Zoom|window.zoom|on|-
—
Close Window|window.closeWindow|on|Cmd+W
[Help]
mdpro Help|menu.help.placeholder|off|-";

const OFF_W_BASELINE: &str = "[mdpro]
About mdpro|app.about|on|-
—
Preferences...|menu.file.preferences|on|Ctrl+,
—
Exit|menu.app.quit|on|-
Stop Waiting and Quit…|menu.app.stop_waiting_quit|on|-
[File]
New|menu.file.new|on|Ctrl+N
New Window|menu.file.new_window|on|Ctrl+Shift+N
Open...|menu.file.open|on|Ctrl+O
Open Recent|native.recent|on|-
No Recent Files|menu.file.recent.empty|off|-
—
Save|menu.file.save|on|Ctrl+S
Export HTML...|menu.file.export_html|on|Ctrl+Shift+E
—
Close|menu.file.close|on|Ctrl+W
[Edit]
Undo|edit.undo|on|Ctrl+Z
Redo|edit.redo|on|Ctrl+Y
—
Cut|edit.cut|on|Ctrl+X
Copy|edit.copy|on|Ctrl+C
Paste|edit.paste|on|Ctrl+V
—
Select All|edit.selectAll|on|Ctrl+A
[View]
Cycle View Mode|menu.view.cycle|on|Ctrl+/
—
Source|menu.view.source|on|-
WYSIWYG|menu.view.wysiwyg|on|-
—
Toggle Sidebar|menu.view.toggle_sidebar|on|Ctrl+Shift+L
[Format]
Highlight Selection|menu.format.highlight|on|Ctrl+Shift+H
Insert Table|menu.format.insert_table|on|Ctrl+Alt+T
[Theme]
Light|menu.theme.light|on|-
Dark|menu.theme.dark|on|-
System|menu.theme.system|on|-
[Window]
Minimize|window.minimize|on|Ctrl+M
Maximize|window.zoom|on|-
—
Close Window|window.closeWindow|on|Alt+F4
[Help]
mdpro Help|menu.help.placeholder|off|-";

#[test]
fn m4_wi1_wi2_full_ordered_descriptor_tree_matches_the_pre_wi2_baseline_on_all_targets() {
    for (platform, expected) in [
        (Platform::Macos, MAC_W_BASELINE),
        (Platform::Windows, OFF_W_BASELINE),
        (Platform::Linux, OFF_W_BASELINE),
    ] {
        let actual = descriptor_tree(platform, ViewMode::Wysiwyg);
        assert_eq!(actual.join("\n"), expected, "{platform:?} WYSIWYG");
        let source = descriptor_tree(platform, ViewMode::Source).join("\n");
        let expected_source = expected.replace(
            "Insert Table|menu.format.insert_table|on|",
            "Insert Table|menu.format.insert_table|off|",
        );
        let expected_source = if platform == Platform::Macos {
            expected_source.replace(
                "Insert Table|menu.format.insert_table|off|Cmd+Alt+T",
                "Insert Table|menu.format.insert_table|off|-",
            )
        } else {
            expected_source
        };
        assert_eq!(source, expected_source, "{platform:?} Source");
    }
}
