// Native menu correspondence used by the AppKit notification adapter. Muda
// creates one native item for each ordered Tauri child. AppKit may append
// noncustom children after installation, but cannot supply a Muda id.

#[derive(Clone)]
struct ExpectedItem {
    id: String,
    title: Option<String>,
    custom: bool,
    children: Option<Vec<ExpectedItem>>,
}

pub(super) fn is_custom_action(action: Option<Sel>) -> bool {
    action == Some(sel!(customAction:))
}

fn expected_items(items: Vec<MenuItemKind<Wry>>) -> Option<Vec<ExpectedItem>> {
    items
        .into_iter()
        .map(|item| {
            let id = item.id().as_ref().to_string();
            let (title, custom, children) = match item {
                MenuItemKind::MenuItem(item) => (Some(item.text().ok()?), true, None),
                MenuItemKind::Check(item) => (Some(item.text().ok()?), true, None),
                MenuItemKind::Icon(item) => (Some(item.text().ok()?), true, None),
                MenuItemKind::Submenu(item) => (
                    Some(item.text().ok()?),
                    false,
                    Some(expected_items(item.items().ok()?)?),
                ),
                MenuItemKind::Predefined(_) => (None, false, None),
            };
            Some(ExpectedItem {
                id,
                title,
                custom,
                children,
            })
        })
        .collect()
}

fn has_custom_action(menu: &NSMenu) -> bool {
    (0..menu.numberOfItems()).any(|index| {
        menu.itemAtIndex(index).is_some_and(|item| {
            let action: Option<Sel> = unsafe { msg_send![&*item, action] };
            is_custom_action(action)
                || item
                    .submenu()
                    .is_some_and(|submenu| has_custom_action(&submenu))
        })
    })
}

/// The unchecked form the F2 mapping tests use; same tree, same failures.
#[cfg(test)]
fn map_items(
    native: &NSMenu,
    tauri_items: Vec<ExpectedItem>,
    out: &mut NativeTree,
    parent: Option<usize>,
) -> Option<()> {
    map_items_checked(native, tauri_items, out, parent, 0).ok()
}

/// Where and why the installed menu could not be mapped; content-free.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct MapMiss {
    pub kind: &'static str,
    pub depth: usize,
    pub index: usize,
}

fn top_miss(kind: &'static str) -> MapMiss {
    MapMiss {
        kind,
        depth: 0,
        index: 0,
    }
}

/// `map_items`, naming the first check that failed: `count`, `item_missing`,
/// `custom`, `submenu`, `title`, `ambiguous_submenu` or `surplus_custom`, at
/// submenu `depth` (0 = the root) and item `index` in that menu; for `count`,
/// `index` is the number of items Tauri expected.
fn map_items_checked(
    native: &NSMenu,
    tauri_items: Vec<ExpectedItem>,
    out: &mut NativeTree,
    parent: Option<usize>,
    depth: usize,
) -> Result<(), MapMiss> {
    let miss = |kind, index| MapMiss { kind, depth, index };
    let expected_count = tauri_items.len();
    if (native.numberOfItems() as usize) < expected_count {
        return Err(miss("count", expected_count));
    }

    // Two recent files can both display README.md. Their native title and
    // selector cannot prove which positional Muda id survived a reorder, so
    // validate that submenu's shape but map none of its children. Other
    // submenus (including unique Save and Highlight) remain usable.
    let mut custom_titles = std::collections::HashSet::new();
    let ambiguous = tauri_items
        .iter()
        .filter(|item| item.custom)
        .any(|item| !custom_titles.insert(item.title.as_deref()));
    let menu = native as *const NSMenu as usize;
    out.menus.insert(menu);
    out.keep_alive
        .push(NativeRef(Retained::into_super(native.retain())));
    if let Some(parent) = parent {
        out.parent_menu.insert(menu, parent);
    }
    for (index, item) in tauri_items.into_iter().enumerate() {
        let native_item = native
            .itemAtIndex(index as isize)
            .ok_or(miss("item_missing", index))?;
        let action: Option<Sel> = unsafe { msg_send![&*native_item, action] };
        if is_custom_action(action) != item.custom {
            return Err(miss("custom", index));
        }
        if (item.children.is_some() && native_item.submenu().is_none())
            || (item.custom && native_item.submenu().is_some())
        {
            return Err(miss("submenu", index));
        }
        if item
            .title
            .as_ref()
            .is_some_and(|title| native_item.title().to_string() != *title)
        {
            return Err(miss("title", index));
        }
        if ambiguous && item.children.is_some() {
            return Err(miss("ambiguous_submenu", index));
        }
        if !ambiguous {
            out.items
                .insert(Retained::as_ptr(&native_item) as usize, item.id);
            out.keep_alive
                .push(NativeRef(Retained::into_super(native_item.clone())));
        }
        if let Some(children) = item.children {
            let native_submenu = native_item.submenu().ok_or(miss("submenu", index))?;
            map_items_checked(&native_submenu, children, out, Some(menu), depth + 1)?;
        }
    }
    for index in expected_count..native.numberOfItems() as usize {
        let item = native
            .itemAtIndex(index as isize)
            .ok_or(miss("item_missing", index))?;
        let action: Option<Sel> = unsafe { msg_send![&*item, action] };
        if is_custom_action(action)
            || item
                .submenu()
                .is_some_and(|submenu| has_custom_action(&submenu))
        {
            return Err(miss("surplus_custom", index));
        }
    }
    Ok(())
}

/// The installed tree, or the first reason it cannot be read or mapped.
fn installed_items(app: &AppHandle<Wry>) -> Result<NativeTree, MapMiss> {
    let marker = MainThreadMarker::new().ok_or(top_miss("no_main_thread"))?;
    let native = NSApplication::sharedApplication(marker)
        .mainMenu()
        .ok_or(top_miss("no_main_menu"))?;
    let menu = app.menu().ok_or(top_miss("no_app_menu"))?;
    let expected = menu
        .items()
        .ok()
        .and_then(expected_items)
        .ok_or(top_miss("items_unreadable"))?;
    let mut items = NativeTree::default();
    map_items_checked(&native, expected, &mut items, None, 0)?;
    Ok(items)
}

/// The Begin observer's body, testable without an `AppHandle`.
pub(super) fn on_begin(
    focus: &MenuFocus,
    note: Option<&NSNotification>,
    tree: Result<NativeTree, MapMiss>,
) {
    match tree {
        Ok(tree) => focus.native_begin_notification(note, &tree),
        Err(miss) => focus.native_tree_unavailable_with(false, miss.kind, miss.depth, miss.index),
    }
}

/// The WillSend observer's body, testable without an `AppHandle`.
pub(super) fn on_will_send(
    focus: &MenuFocus,
    note: Option<&NSNotification>,
    tree: Result<NativeTree, MapMiss>,
) {
    match tree {
        Ok(tree) => focus.native_will_send_notification(note, &tree),
        Err(miss) => focus.native_tree_unavailable_with(true, miss.kind, miss.depth, miss.index),
    }
}
