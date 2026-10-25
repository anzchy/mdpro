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

fn map_items(
    native: &NSMenu,
    tauri_items: Vec<ExpectedItem>,
    out: &mut NativeTree,
    parent: Option<usize>,
) -> Option<()> {
    let expected_count = tauri_items.len();
    if (native.numberOfItems() as usize) < expected_count {
        return None;
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
    if let Some(parent) = parent {
        out.parent_menu.insert(menu, parent);
    }
    for (index, item) in tauri_items.into_iter().enumerate() {
        let native_item = native.itemAtIndex(index as isize)?;
        let action: Option<Sel> = unsafe { msg_send![&*native_item, action] };
        if is_custom_action(action) != item.custom
            || (item.children.is_some() && native_item.submenu().is_none())
            || (item.custom && native_item.submenu().is_some())
            || item
                .title
                .as_ref()
                .is_some_and(|title| native_item.title().to_string() != *title)
        {
            return None;
        }
        if ambiguous && item.children.is_some() {
            return None;
        }
        if !ambiguous {
            out.items
                .insert(Retained::as_ptr(&native_item) as usize, item.id);
        }
        if let Some(children) = item.children {
            let native_submenu = native_item.submenu()?;
            map_items(&native_submenu, children, out, Some(menu))?;
        }
    }
    for index in expected_count..native.numberOfItems() as usize {
        let item = native.itemAtIndex(index as isize)?;
        let action: Option<Sel> = unsafe { msg_send![&*item, action] };
        if is_custom_action(action)
            || item
                .submenu()
                .is_some_and(|submenu| has_custom_action(&submenu))
        {
            return None;
        }
    }
    Some(())
}

fn installed_items(app: &AppHandle<Wry>) -> Option<NativeTree> {
    let marker = MainThreadMarker::new()?;
    let native = NSApplication::sharedApplication(marker).mainMenu()?;
    let mut items = NativeTree::default();
    map_items(
        &native,
        expected_items(app.menu()?.items().ok()?)?,
        &mut items,
        None,
    )?;
    Some(items)
}
