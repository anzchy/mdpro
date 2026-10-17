/**
 * Purpose: compact constructors for command-table rows, so each `rows/*.ts`
 * file states only what differs per command. Linux always takes the
 * Windows / Linux ("off-Mac") value (plan D6).
 *
 * Derived, not written per row:
 * - a configurable row's route is `unavailable` when its v1 availability is
 *   `none`, otherwise `frontend` (today's route: a menu item or a hook key);
 * - a configurable row's contexts follow its v1 availability unless given;
 * - fixed and native rows act in every ownership context;
 * - every v1 secondaries list is empty (no fixed second key exists today).
 *
 * @coordinates-with src/commands/commandHelpers.ts — availabilityContexts
 */
import type { KeyboardShortcuts } from "../types/preferences";
import { availabilityContexts } from "./commandHelpers";
import type {
  Availability,
  CommandId,
  CommandRow,
  MenuPath,
  OwnershipContext,
  PerPlatform,
  Route,
} from "./commandTable.types";

/** A value that differs between macOS and the off-Mac platforms. */
export interface MacOff<T> {
  readonly mac: T;
  readonly off: T;
}

export const macOff = <T>(mac: T, off: T): MacOff<T> => ({ mac, off });

function isMacOff<T>(v: T | MacOff<T>): v is MacOff<T> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "mac" in v && "off" in v;
}

function perPlatform<T>(v: T | MacOff<T>): PerPlatform<T> {
  if (isMacOff(v)) return { macos: v.mac, windows: v.off, linux: v.off };
  return { macos: v, windows: v, linux: v };
}

export const ALL_CONTEXTS: readonly OwnershipContext[] = [
  "editorW",
  "editorS",
  "tableW",
  "tableS",
  "modal",
  "recorder",
  "nativeFocus",
];

export const TABLE_CONTEXTS: readonly OwnershipContext[] = ["tableW", "tableS"];

const NO_SECONDARIES: readonly string[] = [];

export interface ConfigurableSpec {
  readonly id: CommandId;
  readonly field: keyof KeyboardShortcuts;
  readonly menuId?: string;
  readonly menu?: MenuPath | MacOff<MenuPath>;
  /** Today's default (`DEFAULT_KEYBOARD_SHORTCUTS`), platform-neutral. */
  readonly v1: string;
  /** § 5.3.2's default. */
  readonly v2: string | MacOff<string>;
  /** Fixed second keys in v2, the same on every platform. */
  readonly v2Secondaries?: readonly string[];
  /** [v1, v2], the same on every platform. */
  readonly availability: readonly [Availability, Availability];
  /** Required when v1 availability is `none` (the eventual build's contexts). */
  readonly contexts?: readonly OwnershipContext[];
  readonly nativeBehaviour?: string;
}

export function configurable(spec: ConfigurableSpec): CommandRow {
  const [a1, a2] = spec.availability;
  const v2 = perPlatform(spec.v2);
  const key = (p: keyof PerPlatform<unknown>) =>
    ({
      kind: "configurable",
      defaults: { v1: spec.v1, v2: v2[p] },
      secondaries: { v1: NO_SECONDARIES, v2: spec.v2Secondaries ?? NO_SECONDARIES },
    }) as const;
  const route: Route = a1 === "none" ? "unavailable" : "frontend";
  return {
    id: spec.id,
    prefField: spec.field,
    ...(spec.menuId === undefined ? {} : { menuId: spec.menuId }),
    menu: perPlatform(spec.menu ?? "none"),
    key: { macos: key("macos"), windows: key("windows"), linux: key("linux") },
    contexts: spec.contexts ?? availabilityContexts(a1),
    availability: perPlatform({ v1: a1, v2: a2 }),
    route: perPlatform(route),
    ...(spec.nativeBehaviour === undefined ? {} : { nativeBehaviour: spec.nativeBehaviour }),
  };
}

/** A fixed key: [v1, v2]; `null` where the item has no key in that version. */
export type FixedKey = readonly [string | null, string | null];

export const NO_KEY: FixedKey = [null, null];

export interface FixedSpec {
  readonly id: CommandId;
  readonly menuId?: string;
  readonly menu: MenuPath | MacOff<MenuPath>;
  readonly key: FixedKey | MacOff<FixedKey>;
  readonly route: Route | MacOff<Route>;
  /** The same in v1 and v2. Defaults to `both`. */
  readonly availability?: Availability | MacOff<Availability>;
}

export function fixed(spec: FixedSpec): CommandRow {
  const keys = perPlatform<FixedKey>(spec.key);
  const avail = perPlatform<Availability>(spec.availability ?? "both");
  const key = (p: keyof PerPlatform<unknown>) =>
    ({
      kind: "fixed",
      defaults: { v1: keys[p][0], v2: keys[p][1] },
      secondaries: { v1: NO_SECONDARIES, v2: NO_SECONDARIES },
    }) as const;
  const versioned = (p: keyof PerPlatform<unknown>) => ({ v1: avail[p], v2: avail[p] });
  return {
    id: spec.id,
    ...(spec.menuId === undefined ? {} : { menuId: spec.menuId }),
    menu: perPlatform(spec.menu),
    key: { macos: key("macos"), windows: key("windows"), linux: key("linux") },
    contexts: ALL_CONTEXTS,
    availability: { macos: versioned("macos"), windows: versioned("windows"), linux: versioned("linux") },
    route: perPlatform(spec.route),
  };
}
