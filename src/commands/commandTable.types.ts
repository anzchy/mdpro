/**
 * Purpose: the shape of the command table (plan
 * docs/plans/20261015-plan-menu-reorganisation.md § 5.5, ADR-0114 K6): one row
 * per command, with its menu path, key, ownership contexts, availability and
 * dispatch route per platform. Types only.
 *
 * @coordinates-with src/commands/commandTable.ts — assembles the rows
 * @coordinates-with src/types/preferences.ts — `KeyboardShortcuts` field names
 */
import type { KeyboardShortcuts } from "../types/preferences";

/** A stable command id, `<group>.<camelName>`, e.g. `paragraph.quote`. */
export type CommandId = string;

export type Platform = "macos" | "windows" | "linux";

/**
 * How a menu click reaches the command (§ 5.5):
 * - `frontend`: a `menu:action` the frontend dispatcher runs;
 * - `native`: a predefined item, no frontend log line;
 * - `rust-quit`: Exit and the escape item, handled and logged in Rust;
 * - `rust-hide`: macOS Hide mdpro through `AppHandle::hide()` (D13, C2);
 * - `unavailable`: never dispatched.
 */
export type Route = "frontend" | "native" | "rust-quit" | "rust-hide" | "unavailable";

/** The editor modes a command works in. */
export type Availability = "both" | "W" | "S" | "none";

/** The focus contexts a binding acts in (K4, C17). */
export type OwnershipContext =
  | "editorW"
  | "editorS"
  | "tableW"
  | "tableS"
  | "modal"
  | "recorder"
  | "nativeFocus";

/**
 * A value per defaults version. v1 is today's table; v2 is § 5.3.2 as M1b
 * leaves it (ADR-0114 Decision 9) and is inert until M1b.
 */
export interface Versioned<T> {
  readonly v1: T;
  readonly v2: T;
}

/**
 * A key per platform, in stored-string syntax (`Cmd` = primary modifier).
 * A configurable default may be a sentinel (`<unassigned>`, `<system>`).
 * A fixed key is `null` where the item has no key in that version.
 * Secondaries are fixed extra keys that run the same command and never
 * appear on a native item (F6, F3, Shift+F3).
 */
export type KeySpec =
  | {
      readonly kind: "configurable";
      readonly defaults: Versioned<string>;
      readonly secondaries: Versioned<readonly string[]>;
    }
  | {
      readonly kind: "fixed";
      readonly defaults: Versioned<string | null>;
      readonly secondaries: Versioned<readonly string[]>;
    };

/** A menu path as it is today, e.g. `["File", "Save"]`, or `"none"`. */
export type MenuPath = readonly string[] | "none";

export type PerPlatform<T> = Readonly<Record<Platform, T>>;

export interface CommandRow {
  readonly id: CommandId;
  /** The stored preference this row's configurable key lives in. */
  readonly prefField?: keyof KeyboardShortcuts;
  /** Today's `MENU_*` id, when the row has a custom menu item. */
  readonly menuId?: string;
  readonly menu: PerPlatform<MenuPath>;
  readonly key: PerPlatform<KeySpec>;
  readonly contexts: readonly OwnershipContext[];
  readonly availability: PerPlatform<Versioned<Availability>>;
  /** Today's route. */
  readonly route: PerPlatform<Route>;
  /**
   * Settings text for behaviour the platform provides itself, shown off-Mac
   * only (Windows and Linux): e.g. WebView2's find bar (D19). On macOS the
   * row keeps its availability text.
   */
  readonly nativeBehaviour?: string;
}
