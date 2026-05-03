/**
 * @module TableContextMenu/ActionList
 * Purpose: Renders the table-context-menu actions grouped into Insert /
 * Move / Alignment / Destructive sections with a separator + group
 * label between each (matches the WI-1.3 design spec).
 *
 * @coordinates-with src/plugins/milkdown/table/actionDescriptors.ts
 * @coordinates-with src/components/Editor/TableContextMenu/index.tsx
 */

import {
  TABLE_ACTION_GROUPS,
  type TableAction,
  type TableActionGroup,
  type TableActionId,
} from "../../../plugins/milkdown/table/actionDescriptors";

interface ActionListProps {
  actions: TableAction[];
  onPick: (id: TableActionId) => void;
}

const GROUP_LABELS: Record<TableActionGroup, string> = {
  insert: "Insert",
  move: "Move",
  alignment: "Alignment",
  format: "Format",
  destructive: "Destructive",
};

export function ActionList({ actions, onPick }: ActionListProps) {
  return (
    <>
      {TABLE_ACTION_GROUPS.map((group, groupIdx) => {
        const inGroup = actions.filter((a) => a.group === group);
        if (inGroup.length === 0) return null;
        const isFirst = groupIdx === 0;
        return (
          <div
            key={group}
            role="group"
            aria-label={GROUP_LABELS[group]}
            className={`table-context-menu-group table-context-menu-group--${group}`}
          >
            {!isFirst ? <hr className="table-context-menu-separator" /> : null}
            <div className="table-context-menu-group-label">
              {GROUP_LABELS[group]}
            </div>
            {inGroup.map((action) => {
              // Alignment items are mutually-exclusive choices — use
              // role=menuitemradio + aria-checked for screen readers
              // (audit fix Low). Other groups stay as plain menuitem.
              const isAlignment = group === "alignment";
              return (
              <button
                key={action.id}
                type="button"
                role={isAlignment ? "menuitemradio" : "menuitem"}
                aria-disabled={action.isDisabled || undefined}
                aria-checked={isAlignment ? action.isActive : undefined}
                disabled={action.isDisabled}
                className={`table-context-menu-item${
                  action.isActive ? " is-active" : ""
                }${action.isDisabled ? " is-disabled" : ""}`}
                onClick={() => {
                  if (!action.isDisabled) onPick(action.id);
                }}
              >
                <span className="table-context-menu-item-label">
                  {action.label}
                </span>
                {action.hint ? (
                  <span className="table-context-menu-item-hint" aria-hidden="true">
                    {action.hint}
                  </span>
                ) : null}
              </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
