/**
 * Purpose: Scan the repo for the user-visible surfaces the feature ledger is
 * supposed to account for, so `checkCoverage` can catch a surface nobody wrote
 * a row for. This is the only filesystem-reading half of the parser side; the
 * rules themselves stay pure in `parse.mjs`.
 *
 * Pipeline: repoRoot → read 5 source locations → { name, kind, source }[]
 *
 * Key decisions:
 * - Regexes are written against what is actually in the tree today (the menu
 *   constants are bare `const`, not `pub const`; one `.route(` call wraps onto
 *   the next line), not against what the convention doc says should be there.
 * - A name that can't be scanned is better reported as zero than guessed at —
 *   `collectDeclaredNames` never throws on a missing file, it just contributes
 *   nothing, and `check.mjs` prints the per-kind counts so a silent zero is
 *   visible.
 *
 * @module scripts/ledger/declared
 * @coordinates-with scripts/ledger/check.mjs, scripts/ledger/parse.mjs
 */
import fs from "node:fs";
import path from "node:path";

const readIfPresent = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

const collectMatches = (text, regex) => {
  const out = [];
  for (const match of text.matchAll(regex)) out.push(match[1]);
  return out;
};

/** `fn <name>` bodies attached to a `#[tauri::command]` attribute. */
const TAURI_COMMAND_RE =
  /#\[tauri::command[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;
/** `.route("<path>", …)` — the path literal may sit on the following line. */
const HTTP_ROUTE_RE = /\.route\(\s*"([^"]+)"/g;
/** `const MENU_X: &str = "<value>";` — record the value, which is what ships. */
const MENU_ID_RE = /(?:pub\s+)?const\s+MENU_[A-Z0-9_]+\s*:\s*&str\s*=\s*"([^"]+)"\s*;/g;

/** Top-level keys of the `defaultPluginConfig` object literal, by brace depth. */
function extractPluginIds(source) {
  const start = source.indexOf("defaultPluginConfig");
  if (start === -1) return [];
  const open = source.indexOf("{", start);
  if (open === -1) return [];

  const ids = [];
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    const rest = source.slice(i);
    const key = /^["']([^"']+)["']\s*:/.exec(rest) ?? /^([A-Za-z_$][\w$-]*)\s*:/.exec(rest);
    if (key) {
      ids.push(key[1]);
      i += key[0].length - 1;
    }
  }
  return ids;
}

/**
 * Collect every declared name the ledger must account for.
 * @param {string} repoRoot absolute path to the repository root
 * @returns {{ name: string, kind: string, source: string }[]}
 */
export function collectDeclaredNames(repoRoot) {
  const declared = [];
  const push = (name, kind, source) => declared.push({ name, kind, source });

  const commandsDir = path.join(repoRoot, "src-tauri/src/commands");
  if (fs.existsSync(commandsDir)) {
    for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith(".rs")).sort()) {
      const rel = `src-tauri/src/commands/${file}`;
      const text = fs.readFileSync(path.join(commandsDir, file), "utf8");
      for (const name of collectMatches(text, TAURI_COMMAND_RE)) push(name, "tauri-command", rel);
    }
  }

  const httpRel = "src-tauri/src/services/http_server.rs";
  const http = readIfPresent(path.join(repoRoot, httpRel));
  if (http) {
    for (const route of collectMatches(http, HTTP_ROUTE_RE)) push(route, "http-route", httpRel);
  }

  const menuRel = "src-tauri/src/menu.rs";
  const menu = readIfPresent(path.join(repoRoot, menuRel));
  if (menu) {
    for (const id of collectMatches(menu, MENU_ID_RE)) push(id, "menu-id", menuRel);
  }

  const pluginRel = "src/plugins/core/pluginConfig.ts";
  const plugins = readIfPresent(path.join(repoRoot, pluginRel));
  if (plugins) {
    for (const id of extractPluginIds(plugins)) push(id, "plugin-id", pluginRel);
  }

  const storesDir = path.join(repoRoot, "src/stores");
  if (fs.existsSync(storesDir)) {
    const files = fs
      .readdirSync(storesDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
      .sort();
    for (const file of files) push(file.replace(/\.ts$/, ""), "store", `src/stores/${file}`);
  }

  return declared;
}

/** `{ kind: count }`, for the per-kind line `check.mjs` prints. */
export function countByKind(declared) {
  const counts = {};
  for (const entry of declared) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return counts;
}
