//! Full ordered descriptor parity against the M1b v2 menu tree.
//! The native AppKit result is a separate device check (Amendment 3).

use super::super::menu_construction_plan::{construction_plan, root_names, sequence, MenuNode};
use super::*;
use crate::menu_layout::{menu_layout, Availability, KeyKind, MenuPath, Platform};

#[test]
fn m4_amendment11_root_order_is_platform_specific() {
    assert_eq!(
        root_names(Platform::Macos),
        [
            "mdpro",
            "File",
            "Edit",
            "Paragraph",
            "Format",
            "View",
            "Themes",
            "Window",
            "Help"
        ]
    );
    for platform in [Platform::Windows, Platform::Linux] {
        assert_eq!(
            root_names(platform),
            ["mdpro", "File", "Edit", "View", "Format", "Theme", "Window", "Help"]
        );
    }
}

#[test]
fn m4_amendment11_plan_carries_nested_membership_and_separators() {
    let layout = menu_layout().unwrap();
    for platform in [Platform::Macos, Platform::Windows, Platform::Linux] {
        let plan = construction_plan(layout, platform);
        assert_eq!(
            plan.iter()
                .map(|root| root.title.as_str())
                .collect::<Vec<_>>(),
            root_names(platform)
        );
        let edit = plan.iter().find(|root| root.title == "Edit").unwrap();
        assert!(edit.children.contains(&MenuNode::Separator));
        if platform == Platform::Macos {
            assert!(edit.children.iter().any(|node| matches!(node, MenuNode::Submenu { title, children } if title == "Selection" && children.iter().any(|child| matches!(child, MenuNode::Item(id) if id == "edit.selectLine")))));
            assert!(edit.children.iter().any(|node| matches!(node, MenuNode::Submenu { title, children } if title == "Find" && children.iter().any(|child| matches!(child, MenuNode::Item(id) if id == "edit.find")))));
            let paragraph = plan.iter().find(|root| root.title == "Paragraph").unwrap();
            assert!(paragraph
                .children
                .contains(&MenuNode::Item("paragraph.table".into())));
            assert!(!plan
                .iter()
                .find(|root| root.title == "Format")
                .unwrap()
                .children
                .contains(&MenuNode::Item("paragraph.table".into())));
        } else {
            assert!(!edit
                .children
                .iter()
                .any(|node| matches!(node, MenuNode::Submenu { .. })));
            assert!(plan
                .iter()
                .find(|root| root.title == "Format")
                .unwrap()
                .children
                .contains(&MenuNode::Item("paragraph.table".into())));
        }
    }
}

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
    "file.saveAs",
    "file.exportHtml",
    "|",
    "file.close",
];
const FILE_MAC: &[&str] = &[
    "file.new",
    "file.newWindow",
    "|",
    "file.open",
    "open_recent",
    "|",
    "file.close",
    "|",
    "file.save",
    "file.saveAs",
    "|",
    "file.exportHtml",
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
const EDIT_MAC: &[&str] = &[
    "edit.undo",
    "edit.redo",
    "|",
    "edit.cut",
    "edit.copy",
    "edit.paste",
    "edit.copyAsMarkdown",
    "edit.pasteAsPlainText",
    "edit.selectAll",
    "|",
    "selection",
    "edit.selectLine",
    "edit.selectWord",
    "edit.deleteWord",
    "|",
    "find",
    "edit.find",
    "edit.replace",
    "edit.findNext",
    "edit.findPrevious",
];
const VIEW: &[&str] = &[
    "view.cycleViewMode",
    "|",
    "view.source",
    "view.wysiwyg",
    "|",
    "view.sidebar",
    "view.switchDocuments",
    "view.toggleFullscreen",
];
const VIEW_MAC: &[&str] = &[
    "view.source",
    "view.wysiwyg",
    "view.cycleViewMode",
    "|",
    "view.sidebar",
    "view.switchDocuments",
];
const FORMAT: &[&str] = &["format.highlight", "paragraph.table"];
const PARAGRAPH_MAC: &[&str] = &[
    "paragraph.heading1",
    "paragraph.heading2",
    "paragraph.heading3",
    "paragraph.heading4",
    "paragraph.heading5",
    "paragraph.heading6",
    "paragraph.paragraph",
    "|",
    "paragraph.increaseHeading",
    "paragraph.decreaseHeading",
    "|",
    "paragraph.table",
    "paragraph.codeFences",
    "paragraph.mathBlock",
    "paragraph.quote",
    "|",
    "paragraph.orderedList",
    "paragraph.unorderedList",
    "|",
    "paragraph.indent",
    "paragraph.outdent",
];
const FORMAT_MAC: &[&str] = &[
    "format.strong",
    "format.emphasis",
    "format.underline",
    "format.code",
    "format.strike",
    "format.highlight",
    "|",
    "format.hyperlink",
    "format.image",
    "|",
    "format.clearFormat",
];
const THEME: &[&str] = &["theme.light", "theme.dark", "theme.system"];
const WINDOW: &[&str] = &["window.minimize", "window.zoom", "|", "window.closeWindow"];
const HELP: &[&str] = &["help.mdproHelp"];
const WINDOW_MAC: &[&str] = &["window.minimize", "window.zoom", "|", "bring_all"];
const HELP_MAC: &[&str] = &["help.keyboardShortcuts"];

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
    let applied = super::tests::defaults();
    // build_menu -> specs_for_app -> menu_layout_for on macOS. Off-Mac
    // menu_item_or consumes the same fallback tuple entry tested below.
    let mac_specs = menu_layout_for(layout, &applied, Some(mode));
    let is_mac = platform == Platform::Macos;
    let mut roots = vec![
        ("mdpro", if is_mac { APP_MAC } else { APP_OFF }),
        ("File", if is_mac { FILE_MAC } else { FILE }),
        ("Edit", if is_mac { EDIT_MAC } else { EDIT }),
    ];
    if is_mac {
        roots.push(("Paragraph", PARAGRAPH_MAC));
    }
    if is_mac {
        roots.push(("Format", FORMAT_MAC));
        roots.push(("View", VIEW_MAC));
    } else {
        roots.push(("View", VIEW));
        roots.push(("Format", FORMAT));
    }
    roots.extend([
        (if is_mac { "Themes" } else { "Theme" }, THEME),
        ("Window", if is_mac { WINDOW_MAC } else { WINDOW }),
        ("Help", if is_mac { HELP_MAC } else { HELP }),
    ]);
    let mut out = Vec::new();
    for (menu, tokens) in roots {
        out.push(format!("[{menu}]"));
        for token in tokens {
            match *token {
                "|" => out.push("—".into()),
                "selection" => out.push("Selection ▸".into()),
                "find" => out.push("Find ▸".into()),
                "services" => out.push("Services|native.services|on|-".into()),
                "open_recent" => {
                    out.push("Open Recent|native.recent|on|-".into());
                    out.push("No Recent Files|menu.file.recent.empty|off|-".into());
                }
                "bring_all" => out.push("Bring All to Front|native.bring_all|on|-".into()),
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
                            enabled(row.availability.macos.v2, mode),
                            row.key
                                .macos
                                .default_at(true)
                                .map(|key| key.replace("Option", "Alt")),
                        )
                    } else {
                        let availability = if platform == Platform::Windows {
                            row.availability.windows.v2
                        } else {
                            row.availability.linux.v2
                        };
                        let on = enabled(availability, mode);
                        let key = if matches!(
                            id,
                            "view.source"
                                | "view.wysiwyg"
                                | "view.switchDocuments"
                                | "view.toggleFullscreen"
                        ) {
                            None
                        } else {
                            (if platform == Platform::Windows {
                                &row.key.windows
                            } else {
                                &row.key.linux
                            })
                            .default_at(true)
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
Settings...|menu.file.preferences|on|Cmd+,
—
Services|native.services|on|-
—
Hide mdpro|menu.app.hide|on|-
Hide Others|app.hideOthers|on|Cmd+Alt+H
Show All|app.showAll|on|-
—
Quit mdpro|menu.app.quit|on|Cmd+Q
Stop Waiting and Quit…|menu.app.stop_waiting_quit|on|-
[File]
New|menu.file.new|on|Cmd+N
New Window|menu.file.new_window|on|Cmd+Shift+N
—
Open...|menu.file.open|on|Cmd+O
Open Recent|native.recent|on|-
No Recent Files|menu.file.recent.empty|off|-
—
Close|menu.file.close|on|Cmd+W
—
Save|menu.file.save|on|Cmd+S
Save As...|menu.file.save_as|on|Cmd+Shift+S
—
Export HTML...|menu.file.export_html|on|Cmd+Shift+E
[Edit]
Undo|edit.undo|on|Cmd+Z
Redo|edit.redo|on|Cmd+Shift+Z
—
Cut|edit.cut|on|Cmd+X
Copy|edit.copy|on|Cmd+C
Paste|edit.paste|on|Cmd+V
Copy as Markdown|menu.edit.copy_as_markdown|off|-
Paste as Plain Text|menu.edit.paste_as_plain_text|off|-
Select All|edit.selectAll|on|Cmd+A
—
Selection ▸
Select Line|menu.edit.select_line|on|Cmd+L
Select Word|menu.edit.select_word|on|Cmd+D
Delete Word|menu.edit.delete_word|off|-
—
Find ▸
Find...|menu.edit.find|off|-
Replace...|menu.edit.replace|off|-
Find Next|menu.edit.find_next|off|-
Find Previous|menu.edit.find_previous|off|-
[Paragraph]
Heading 1|menu.paragraph.heading1|on|Cmd+1
Heading 2|menu.paragraph.heading2|on|Cmd+2
Heading 3|menu.paragraph.heading3|on|Cmd+3
Heading 4|menu.paragraph.heading4|on|Cmd+4
Heading 5|menu.paragraph.heading5|on|Cmd+5
Heading 6|menu.paragraph.heading6|on|Cmd+6
Paragraph|menu.paragraph.paragraph|on|Cmd+Shift+0
—
Increase Heading|menu.paragraph.increase_heading|on|Cmd+Alt+]
Decrease Heading|menu.paragraph.decrease_heading|on|Cmd+Alt+[
—
Table...|menu.format.insert_table|on|Cmd+Shift+T
Code Fences|menu.paragraph.code_fences|on|Cmd+Alt+C
Math Block|menu.paragraph.math_block|off|-
Quote|menu.paragraph.quote|on|Cmd+Shift+B
—
Ordered List|menu.paragraph.ordered_list|on|Cmd+Alt+O
Unordered List|menu.paragraph.unordered_list|on|Cmd+Alt+U
—
Indent|menu.paragraph.indent|on|Cmd+]
Outdent|menu.paragraph.outdent|on|Cmd+[
[Format]
Bold|menu.format.strong|on|Cmd+B
Italic|menu.format.emphasis|on|Cmd+I
Underline|menu.format.underline|on|Cmd+U
Code|menu.format.code|on|Cmd+Shift+`
Strikethrough|menu.format.strike|on|Cmd+Shift+X
Highlight Selection|menu.format.highlight|on|Cmd+Shift+M
—
Link...|menu.format.hyperlink|on|Cmd+K
Image...|menu.format.image|on|Cmd+Shift+I
—
Clear Format|menu.format.clear_format|on|Cmd+\\
[View]
Source|menu.view.source|on|Ctrl+2
WYSIWYG|menu.view.wysiwyg|on|Ctrl+4
Cycle View Mode|menu.view.cycle|on|Cmd+/
—
Toggle Sidebar|menu.view.toggle_sidebar|on|Cmd+Shift+L
Switch Documents|menu.view.switch_documents|on|-
[Themes]
Light|menu.theme.light|on|-
Dark|menu.theme.dark|on|-
System|menu.theme.system|on|-
[Window]
Minimize|window.minimize|on|Cmd+M
Zoom|window.zoom|on|-
—
Bring All to Front|native.bring_all|on|-
[Help]
Keyboard Shortcuts…|menu.help.keyboard_shortcuts|on|-";

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
Save As...|menu.file.save_as|on|Ctrl+Shift+S
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
Switch Documents|menu.view.switch_documents|on|-
Toggle Fullscreen|menu.view.toggle_fullscreen|on|-
[Format]
Highlight Selection|menu.format.highlight|on|Ctrl+Shift+M
Insert Table|menu.format.insert_table|on|Ctrl+Shift+T
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

const MAC_S_BASELINE: &str = "[mdpro]
About mdpro|app.about|on|-
—
Settings...|menu.file.preferences|on|Cmd+,
—
Services|native.services|on|-
—
Hide mdpro|menu.app.hide|on|-
Hide Others|app.hideOthers|on|Cmd+Alt+H
Show All|app.showAll|on|-
—
Quit mdpro|menu.app.quit|on|Cmd+Q
Stop Waiting and Quit…|menu.app.stop_waiting_quit|on|-
[File]
New|menu.file.new|on|Cmd+N
New Window|menu.file.new_window|on|Cmd+Shift+N
—
Open...|menu.file.open|on|Cmd+O
Open Recent|native.recent|on|-
No Recent Files|menu.file.recent.empty|off|-
—
Close|menu.file.close|on|Cmd+W
—
Save|menu.file.save|on|Cmd+S
Save As...|menu.file.save_as|on|Cmd+Shift+S
—
Export HTML...|menu.file.export_html|on|Cmd+Shift+E
[Edit]
Undo|edit.undo|on|Cmd+Z
Redo|edit.redo|on|Cmd+Shift+Z
—
Cut|edit.cut|on|Cmd+X
Copy|edit.copy|on|Cmd+C
Paste|edit.paste|on|Cmd+V
Copy as Markdown|menu.edit.copy_as_markdown|off|-
Paste as Plain Text|menu.edit.paste_as_plain_text|off|-
Select All|edit.selectAll|on|Cmd+A
—
Selection ▸
Select Line|menu.edit.select_line|on|Cmd+L
Select Word|menu.edit.select_word|on|Cmd+D
Delete Word|menu.edit.delete_word|on|-
—
Find ▸
Find...|menu.edit.find|on|Cmd+F
Replace...|menu.edit.replace|on|Cmd+H
Find Next|menu.edit.find_next|on|Cmd+G
Find Previous|menu.edit.find_previous|on|Cmd+Shift+G
[Paragraph]
Heading 1|menu.paragraph.heading1|on|Cmd+1
Heading 2|menu.paragraph.heading2|on|Cmd+2
Heading 3|menu.paragraph.heading3|on|Cmd+3
Heading 4|menu.paragraph.heading4|on|Cmd+4
Heading 5|menu.paragraph.heading5|on|Cmd+5
Heading 6|menu.paragraph.heading6|on|Cmd+6
Paragraph|menu.paragraph.paragraph|on|Cmd+Shift+0
—
Increase Heading|menu.paragraph.increase_heading|on|Cmd+Alt+]
Decrease Heading|menu.paragraph.decrease_heading|on|Cmd+Alt+[
—
Table...|menu.format.insert_table|off|-
Code Fences|menu.paragraph.code_fences|on|Cmd+Alt+C
Math Block|menu.paragraph.math_block|on|Cmd+Alt+Shift+M
Quote|menu.paragraph.quote|on|Cmd+Shift+B
—
Ordered List|menu.paragraph.ordered_list|on|Cmd+Alt+O
Unordered List|menu.paragraph.unordered_list|on|Cmd+Alt+U
—
Indent|menu.paragraph.indent|on|Cmd+]
Outdent|menu.paragraph.outdent|on|Cmd+[
[Format]
Bold|menu.format.strong|on|Cmd+B
Italic|menu.format.emphasis|on|Cmd+I
Underline|menu.format.underline|on|Cmd+U
Code|menu.format.code|on|Cmd+Shift+`
Strikethrough|menu.format.strike|on|Cmd+Shift+X
Highlight Selection|menu.format.highlight|on|Cmd+Shift+M
—
Link...|menu.format.hyperlink|on|Cmd+K
Image...|menu.format.image|on|Cmd+Shift+I
—
Clear Format|menu.format.clear_format|off|-
[View]
Source|menu.view.source|on|Ctrl+2
WYSIWYG|menu.view.wysiwyg|on|Ctrl+4
Cycle View Mode|menu.view.cycle|on|Cmd+/
—
Toggle Sidebar|menu.view.toggle_sidebar|on|Cmd+Shift+L
Switch Documents|menu.view.switch_documents|on|-
[Themes]
Light|menu.theme.light|on|-
Dark|menu.theme.dark|on|-
System|menu.theme.system|on|-
[Window]
Minimize|window.minimize|on|Cmd+M
Zoom|window.zoom|on|-
—
Bring All to Front|native.bring_all|on|-
[Help]
Keyboard Shortcuts…|menu.help.keyboard_shortcuts|on|-";

#[test]
fn m4_wi1_wi2_full_ordered_descriptor_tree_matches_the_pre_wi2_baseline_on_all_targets() {
    for (platform, expected) in [
        (Platform::Macos, MAC_W_BASELINE),
        (Platform::Windows, OFF_W_BASELINE),
        (Platform::Linux, OFF_W_BASELINE),
    ] {
        let actual = descriptor_tree(platform, ViewMode::Wysiwyg);
        let expected = expected.to_string();
        assert_eq!(actual.join("\n"), expected, "{platform:?} WYSIWYG");
        let source = descriptor_tree(platform, ViewMode::Source).join("\n");
        let expected_source = if platform == Platform::Macos {
            MAC_S_BASELINE.to_string()
        } else {
            expected.replace(
                "Insert Table|menu.format.insert_table|on|",
                "Insert Table|menu.format.insert_table|off|",
            )
        };
        assert_eq!(source, expected_source, "{platform:?} Source");
    }
}

#[test]
fn m4_wi4_native_append_order_agrees_with_the_mac_descriptor_roots() {
    let source = include_str!("menu.rs");
    let calls = [
        "menu.append(&app_menu)",
        "menu.append(&file_menu)",
        "menu.append(&edit_menu)",
        "menu.append(paragraph_menu)",
        "menu.append(&format_menu)",
        "menu.append(&view_menu)",
        "menu.append(&theme_menu)",
        "menu.append(&window_menu)",
        "menu.append(&help_menu)",
    ];
    let positions: Vec<_> = calls
        .iter()
        .map(|call| source.find(call).expect(call))
        .collect();
    assert!(
        positions.windows(2).all(|pair| pair[0] < pair[1]),
        "native append order differs from §5.1"
    );
    let roots: Vec<_> = descriptor_tree(Platform::Macos, ViewMode::Wysiwyg)
        .into_iter()
        .filter(|line| line.starts_with('['))
        .collect();
    assert_eq!(
        roots,
        [
            "[mdpro]",
            "[File]",
            "[Edit]",
            "[Paragraph]",
            "[Format]",
            "[View]",
            "[Themes]",
            "[Window]",
            "[Help]"
        ]
    );
}

#[test]
fn m4_amendment11_production_plan_matches_complete_ordered_tree() {
    fn expected_nodes(tokens: &[&str]) -> Vec<MenuNode> {
        let mut nodes = Vec::new();
        let mut index = 0;
        while index < tokens.len() {
            match tokens[index] {
                "|" => nodes.push(MenuNode::Separator),
                "selection" | "find" => {
                    let (title, count) = if tokens[index] == "selection" {
                        ("Selection", 3)
                    } else {
                        ("Find", 4)
                    };
                    nodes.push(MenuNode::Submenu {
                        title: title.into(),
                        children: tokens[index + 1..index + 1 + count]
                            .iter()
                            .map(|id| MenuNode::Item((*id).into()))
                            .collect(),
                    });
                    index += count;
                }
                id => nodes.push(MenuNode::Item(id.into())),
            }
            index += 1;
        }
        nodes
    }
    for platform in [Platform::Macos, Platform::Windows, Platform::Linux] {
        let plan = construction_plan(menu_layout().unwrap(), platform);
        let mac = platform == Platform::Macos;
        let expected: Vec<(&str, &[&str])> = vec![
            ("mdpro", if mac { APP_MAC } else { APP_OFF }),
            ("File", if mac { FILE_MAC } else { FILE }),
            ("Edit", if mac { EDIT_MAC } else { EDIT }),
        ]
        .into_iter()
        .chain(if mac {
            vec![
                ("Paragraph", PARAGRAPH_MAC),
                ("Format", FORMAT_MAC),
                ("View", VIEW_MAC),
            ]
        } else {
            vec![("View", VIEW), ("Format", FORMAT)]
        })
        .chain(vec![
            (if mac { "Themes" } else { "Theme" }, THEME),
            ("Window", if mac { WINDOW_MAC } else { WINDOW }),
            ("Help", if mac { HELP_MAC } else { HELP }),
        ])
        .collect();
        assert_eq!(plan.len(), expected.len());
        for (root, (title, tokens)) in plan.iter().zip(expected) {
            assert_eq!(root.title, title);
            assert_eq!(
                root.children,
                expected_nodes(tokens),
                "{platform:?} {title}"
            );
        }
    }
}

#[test]
fn m4_amendment12_selection_close_boundary_mutation_is_detected() {
    let layout = menu_layout().unwrap();
    let correct = construction_plan(layout, Platform::Macos)
        .into_iter()
        .find(|root| root.title == "Edit")
        .unwrap();
    let tokens = [
        "edit.undo",
        "edit.redo",
        "|",
        "edit.cut",
        "edit.copy",
        "edit.paste",
        "edit.copyAsMarkdown",
        "edit.pasteAsPlainText",
        "edit.selectAll",
        "|",
        ">Selection",
        "edit.selectLine",
        "<",
        "edit.selectWord",
        "edit.deleteWord",
        "|",
        ">Find",
        "edit.find",
        "edit.replace",
        "edit.findNext",
        "edit.findPrevious",
        "<",
    ];
    let mutated = sequence(layout, Platform::Macos, "Edit", &tokens);
    assert_ne!(mutated, correct.children);
    assert!(mutated.contains(&MenuNode::Item("edit.selectWord".into())));
    assert!(!correct
        .children
        .contains(&MenuNode::Item("edit.selectWord".into())));
}
