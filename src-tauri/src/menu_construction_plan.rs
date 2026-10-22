//! Purpose: the pure ordered native-menu construction plan shared by builders
//! and descriptor tests. Item properties still come from the command layout.

use crate::menu_layout::{MenuLayout, MenuPath, Platform};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum MenuNode {
    Item(String),
    Separator,
    Submenu {
        title: String,
        children: Vec<MenuNode>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MenuRoot {
    pub title: String,
    pub children: Vec<MenuNode>,
}

/// The root order selected by the production native builder.
pub(super) fn root_names(platform: Platform) -> Vec<&'static str> {
    match platform {
        Platform::Macos => vec![
            "mdpro",
            "File",
            "Edit",
            "Paragraph",
            "Format",
            "View",
            "Themes",
            "Window",
            "Help",
        ],
        Platform::Windows | Platform::Linux => vec![
            "mdpro", "File", "Edit", "View", "Format", "Theme", "Window", "Help",
        ],
    }
}

/// Translate the ordered menu design into layout-backed item membership.
pub(super) fn construction_plan(layout: &MenuLayout, platform: Platform) -> Vec<MenuRoot> {
    root_names(platform)
        .into_iter()
        .map(|title| MenuRoot {
            title: title.into(),
            children: sequence(layout, platform, title, tokens(title, platform)),
        })
        .collect()
}

pub(super) fn sequence(
    layout: &MenuLayout,
    platform: Platform,
    root: &str,
    tokens: &[&str],
) -> Vec<MenuNode> {
    let mut out = Vec::new();
    let mut nested: Option<(String, Vec<MenuNode>)> = None;
    for token in tokens {
        if let Some(title) = token.strip_prefix('>') {
            nested = Some((title.to_string(), Vec::new()));
            continue;
        }
        if *token == "<" {
            if let Some((title, children)) = nested.take() {
                out.push(MenuNode::Submenu { title, children });
            }
            continue;
        }
        let node = if *token == "|" {
            Some(MenuNode::Separator)
        } else if matches!(*token, "services" | "open_recent" | "bring_all") {
            Some(MenuNode::Item((*token).into()))
        } else {
            layout
                .rows
                .iter()
                .find(|row| row.id == *token)
                .and_then(|row| {
                    let path = match platform {
                        Platform::Macos => &row.menu.macos,
                        Platform::Windows => &row.menu.windows,
                        Platform::Linux => &row.menu.linux,
                    };
                    match path {
                        MenuPath::Path(parts)
                            if parts.first().map(String::as_str) == Some(root) =>
                        {
                            Some(MenuNode::Item((*token).into()))
                        }
                        _ => None,
                    }
                })
        };
        if let Some(node) = node {
            if let Some((_, children)) = &mut nested {
                children.push(node);
            } else {
                out.push(node);
            }
        }
    }
    out
}

fn tokens(root: &str, platform: Platform) -> &'static [&'static str] {
    let mac = platform == Platform::Macos;
    match (root, mac) {
        ("mdpro", true) => &[
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
        ],
        ("mdpro", false) => &[
            "app.about",
            "|",
            "file.preferences",
            "|",
            "app.quit",
            "app.stopWaitingQuit",
        ],
        ("File", true) => &[
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
        ],
        ("File", false) => &[
            "file.new",
            "file.newWindow",
            "file.open",
            "open_recent",
            "|",
            "file.save",
            "file.exportHtml",
            "|",
            "file.close",
        ],
        ("Edit", true) => &[
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
            "edit.selectWord",
            "edit.deleteWord",
            "<",
            "|",
            ">Find",
            "edit.find",
            "edit.replace",
            "edit.findNext",
            "edit.findPrevious",
            "<",
        ],
        ("Edit", false) => &[
            "edit.undo",
            "edit.redo",
            "|",
            "edit.cut",
            "edit.copy",
            "edit.paste",
            "|",
            "edit.selectAll",
        ],
        ("Paragraph", true) => &[
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
        ],
        ("Format", true) => &[
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
        ],
        ("Format", false) => &["format.highlight", "paragraph.table"],
        ("View", true) => &[
            "view.source",
            "view.wysiwyg",
            "view.cycleViewMode",
            "|",
            "view.sidebar",
            "view.switchDocuments",
        ],
        ("View", false) => &[
            "view.cycleViewMode",
            "|",
            "view.source",
            "view.wysiwyg",
            "|",
            "view.sidebar",
        ],
        ("Themes", true) | ("Theme", false) => &["theme.light", "theme.dark", "theme.system"],
        ("Window", true) => &[
            "window.minimize",
            "window.zoom",
            "|",
            "window.closeWindow",
            "bring_all",
        ],
        ("Window", false) => &["window.minimize", "window.zoom", "|", "window.closeWindow"],
        ("Help", true) => &["help.keyboardShortcuts"],
        ("Help", false) => &["help.mdproHelp"],
        _ => &[],
    }
}
