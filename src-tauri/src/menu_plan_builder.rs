//! Purpose: render the platform construction plan into native Tauri menu items.
//! The plan owns placement; command specs own custom labels, states and keys.
//! Off-Mac roots reuse their existing native items with plan-owned membership.
//!
//! @coordinates-with src-tauri/src/menu_construction_plan.rs
//! @coordinates-with src-tauri/src/menu_from_layout.rs

use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

use super::menu_about::about_metadata_for;
use super::menu_construction_plan::{MenuNode, MenuRoot};
use super::menu_from_layout::{self, MenuItemSpec};
use super::menu_recent::{build_recent_submenu, ThemeMode};
use super::MENU_APP_STOP_WAITING_QUIT;
use crate::menu_layout::MenuLayout;

/// The exact checked state used when constructing a macOS theme item.
pub(super) fn theme_item_checked(command_id: &str, mode: ThemeMode) -> bool {
    matches!(
        (command_id, mode),
        ("theme.light", ThemeMode::Light)
            | ("theme.dark", ThemeMode::Dark)
            | ("theme.system", ThemeMode::System)
    )
}

pub(super) fn build_macos_root(
    app: &AppHandle<Wry>,
    root: &MenuRoot,
    specs: &[MenuItemSpec],
    recent_files: &[String],
    active_view_mode: Option<&str>,
    theme_mode: ThemeMode,
) -> tauri::Result<Submenu<Wry>> {
    let title = if root.title == "mdpro" {
        app.package_info().name.as_str()
    } else {
        root.title.as_str()
    };
    let submenu = Submenu::new(app, title, true)?;
    append_nodes(
        app,
        &submenu,
        &root.children,
        specs,
        recent_files,
        active_view_mode,
        theme_mode,
    )?;
    Ok(submenu)
}

fn append_nodes(
    app: &AppHandle<Wry>,
    parent: &Submenu<Wry>,
    nodes: &[MenuNode],
    specs: &[MenuItemSpec],
    recent_files: &[String],
    active_view_mode: Option<&str>,
    theme_mode: ThemeMode,
) -> tauri::Result<()> {
    for node in nodes {
        match node {
            MenuNode::Separator => parent.append(&PredefinedMenuItem::separator(app)?)?,
            MenuNode::Submenu { title, children } => {
                let submenu = Submenu::new(app, title, true)?;
                append_nodes(
                    app,
                    &submenu,
                    children,
                    specs,
                    recent_files,
                    active_view_mode,
                    theme_mode,
                )?;
                parent.append(&submenu)?;
            }
            MenuNode::Item(id) => append_item(
                app,
                parent,
                id,
                specs,
                recent_files,
                active_view_mode,
                theme_mode,
            )?,
        }
    }
    Ok(())
}

fn append_item(
    app: &AppHandle<Wry>,
    parent: &Submenu<Wry>,
    id: &str,
    specs: &[MenuItemSpec],
    recent_files: &[String],
    active_view_mode: Option<&str>,
    theme_mode: ThemeMode,
) -> tauri::Result<()> {
    match id {
        "app.about" => parent.append(&PredefinedMenuItem::about(
            app,
            None,
            about_metadata_for(
                "macos",
                &app.package_info().name,
                &app.package_info().version.to_string(),
            ),
        )?)?,
        "services" => parent.append(&PredefinedMenuItem::services(app, None)?)?,
        "app.hide" => parent.append(&MenuItem::with_id(
            app,
            super::MENU_APP_HIDE,
            "Hide mdpro",
            true,
            None::<&str>,
        )?)?,
        "app.hideOthers" => parent.append(&PredefinedMenuItem::hide_others(app, None)?)?,
        "app.showAll" => parent.append(&PredefinedMenuItem::show_all(app, None)?)?,
        "app.quit" => parent.append(&PredefinedMenuItem::quit(app, None)?)?,
        "app.stopWaitingQuit" => parent.append(&MenuItem::with_id(
            app,
            MENU_APP_STOP_WAITING_QUIT,
            "Stop Waiting and Quit…",
            true,
            None::<&str>,
        )?)?,
        "open_recent" => parent.append(&build_recent_submenu(app, recent_files)?)?,
        "edit.undo" => parent.append(&PredefinedMenuItem::undo(app, None)?)?,
        "edit.redo" => parent.append(&PredefinedMenuItem::redo(app, None)?)?,
        "edit.cut" => parent.append(&PredefinedMenuItem::cut(app, None)?)?,
        "edit.copy" => parent.append(&PredefinedMenuItem::copy(app, None)?)?,
        "edit.paste" => parent.append(&PredefinedMenuItem::paste(app, None)?)?,
        "edit.selectAll" => parent.append(&PredefinedMenuItem::select_all(app, None)?)?,
        "window.minimize" => parent.append(&PredefinedMenuItem::minimize(app, None)?)?,
        "window.zoom" => parent.append(&PredefinedMenuItem::maximize(app, None)?)?,
        "window.closeWindow" => parent.append(&PredefinedMenuItem::close_window(app, None)?)?,
        "bring_all" => parent.append(&PredefinedMenuItem::bring_all_to_front(app, None)?)?,
        "view.source" | "view.wysiwyg" => {
            let spec = spec_for_command(specs, id)?;
            parent.append(&menu_from_layout::check_item(
                app,
                specs,
                spec.menu_id.as_deref().unwrap_or(""),
                active_view_mode
                    == Some(if id == "view.source" {
                        "source"
                    } else {
                        "wysiwyg"
                    }),
            )?)?;
        }
        "theme.light" | "theme.dark" | "theme.system" => {
            let spec = spec_for_command(specs, id)?;
            let checked = theme_item_checked(id, theme_mode);
            parent.append(&menu_from_layout::check_item(
                app,
                specs,
                spec.menu_id.as_deref().unwrap_or(""),
                checked,
            )?)?;
        }
        _ => {
            let spec = spec_for_command(specs, id)?;
            let menu_id = spec.menu_id.as_deref().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("menu id absent for {id}"),
                )
            })?;
            parent.append(&menu_from_layout::menu_item_or(
                app,
                Some(specs),
                menu_id,
                "",
                false,
                None,
            )?)?;
        }
    }
    Ok(())
}

fn spec_for_command<'a>(
    specs: &'a [MenuItemSpec],
    command_id: &str,
) -> tauri::Result<&'a MenuItemSpec> {
    specs
        .iter()
        .find(|spec| spec.command_id == command_id)
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("menu command absent: {command_id}"),
            )
            .into()
        })
}

/// Preserve the existing off-Mac item objects and rebuild their ordered
/// membership and separators from the same pure platform plan as macOS.
pub(super) fn rebuild_offmac_root(
    app: &AppHandle<Wry>,
    existing: &Submenu<Wry>,
    root: &MenuRoot,
    layout: &MenuLayout,
) -> tauri::Result<Submenu<Wry>> {
    let rebuilt = Submenu::new(app, existing.text()?, true)?;
    let mut items = Vec::new();
    for kind in existing.items()? {
        if matches!(&kind, MenuItemKind::Predefined(item) if item.text().unwrap_or_default().is_empty())
        {
            continue;
        }
        items.push(kind);
    }
    let mut remaining = items.into_iter();
    for node in &root.children {
        match node {
            MenuNode::Separator => rebuilt.append(&PredefinedMenuItem::separator(app)?)?,
            MenuNode::Item(command_id) => {
                let kind = remaining.next().ok_or_else(|| plan_mismatch(&root.title))?;
                if command_id == "open_recent" && !matches!(kind, MenuItemKind::Submenu(_)) {
                    return Err(plan_mismatch(&root.title).into());
                }
                if let Some(expected_id) = layout
                    .rows
                    .iter()
                    .find(|row| row.id == *command_id)
                    .and_then(|row| row.menu_id.as_deref())
                {
                    if kind.id().as_ref() != expected_id {
                        return Err(plan_mismatch(&root.title).into());
                    }
                }
                append_kind(&rebuilt, &kind)?;
            }
            MenuNode::Submenu { .. } => return Err(plan_mismatch(&root.title).into()),
        }
    }
    if remaining.next().is_some() {
        return Err(plan_mismatch(&root.title).into());
    }
    Ok(rebuilt)
}

fn append_kind(parent: &Submenu<Wry>, kind: &MenuItemKind<Wry>) -> tauri::Result<()> {
    match kind {
        MenuItemKind::MenuItem(item) => parent.append(item),
        MenuItemKind::Submenu(item) => parent.append(item),
        MenuItemKind::Predefined(item) => parent.append(item),
        MenuItemKind::Check(item) => parent.append(item),
        MenuItemKind::Icon(item) => parent.append(item),
    }
}

fn plan_mismatch(root: &str) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        format!("native menu does not match construction plan: {root}"),
    )
}
