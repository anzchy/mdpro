/**
 * Purpose: The closed map from Tauri bundle outputs to release-asset names
 * (D76-WI-2), shared by `collect-assets.mjs` (build job) and `assetSet.mjs`
 * (verify job). Pure: no fs.
 *
 * Pipeline:
 *   PLATFORM_SPECS[platform].files → per file: bundle subdir, candidate class,
 *                                    exact source name (or any one), final name
 *   expectedAssets(platform, v)    → final names, each signed file followed by its `.sig`
 *
 * Key decisions:
 * - D-3: the updater platforms are REQUIRED_PLATFORMS (in `latest.json`, must be
 *   present); Windows/Linux are OPTIONAL_PLATFORMS (installers only, all of a
 *   platform's files or none, D127-WI-4). Dropping Windows/Linux is emptying
 *   OPTIONAL_PLATFORMS.
 * - The macOS updater archive is renamed from Tauri's `mdpro.app.tar.gz` to the
 *   v0.2.6 names (`mdpro_aarch64.app.tar.gz`, `mdpro_x64.app.tar.gz`), so
 *   `latest.json` URLs keep the shape existing 0.2.x clients followed.
 * - Names that carry a version take it from the argument, never from a glob,
 *   so a stale bundle from another version cannot stand in (plan C6).
 * - Every bundle path is under `src-tauri/target/<triple>/release/bundle/`
 *   (`pnpm tauri build --target <triple>`). If the rehearsal (WI-8 R1) shows a
 *   different layout, BUNDLE_SUBPATH and the `dir` fields are the one fix.
 *
 * @module scripts/release/assetNames
 * @coordinates-with scripts/release/collect-assets.mjs (copies to these names)
 * @coordinates-with scripts/release/assetSet.mjs (verifies the set)
 */

/** Product name Tauri prefixes every bundle with (tauri.conf.json `productName`). */
export const PRODUCT = "mdpro";

/** Updater platforms: required, and the exact key set of `latest.json` (D-3). */
export const REQUIRED_PLATFORMS = Object.freeze(["darwin-aarch64", "darwin-x86_64"]);

/** Installer-only platforms: never in `latest.json`; all of a platform's files or none (D-3, D127-WI-4). */
export const OPTIONAL_PLATFORMS = Object.freeze(["windows-x86_64", "linux-x86_64"]);

/** Relative to the repo root; `<triple>` is replaced. */
export const BUNDLE_SUBPATH = Object.freeze(["src-tauri", "target", "<triple>", "release", "bundle"]);

/**
 * @typedef {object} FileSpec
 * @property {string} dir            bundle subdirectory
 * @property {RegExp} candidates     every file in `dir` matching this is a candidate
 * @property {(v: string) => string | null} source  exact source name, or null for "the one candidate"
 * @property {(v: string) => string} final          release-asset name
 * @property {boolean} signed        a non-empty `<source>.sig` must sit next to it
 * @property {boolean} updater       the updater archive (its URL goes in latest.json)
 */

/** @param {string} arch @returns {FileSpec[]} */
const macFiles = (arch) => [
  {
    dir: "macos",
    candidates: /\.app\.tar\.gz$/,
    source: () => null,
    final: () => `${PRODUCT}_${arch}.app.tar.gz`,
    signed: true,
    updater: true,
  },
  {
    dir: "dmg",
    candidates: /\.dmg$/,
    source: (v) => `${PRODUCT}_${v}_${arch}.dmg`,
    final: (v) => `${PRODUCT}_${v}_${arch}.dmg`,
    signed: false,
    updater: false,
  },
];

/** @param {string} dir @param {RegExp} candidates @param {(v: string) => string} name @returns {FileSpec} */
const installer = (dir, candidates, name) => ({ dir, candidates, source: name, final: name, signed: true, updater: false });

/** @type {Readonly<Record<string, {triple: string, files: FileSpec[]}>>} */
export const PLATFORM_SPECS = Object.freeze({
  "darwin-aarch64": { triple: "aarch64-apple-darwin", files: macFiles("aarch64") },
  "darwin-x86_64": { triple: "x86_64-apple-darwin", files: macFiles("x64") },
  "windows-x86_64": {
    triple: "x86_64-pc-windows-msvc",
    files: [installer("nsis", /-setup\.exe$/, (v) => `${PRODUCT}_${v}_x64-setup.exe`)],
  },
  "linux-x86_64": {
    triple: "x86_64-unknown-linux-gnu",
    files: [
      installer("deb", /\.deb$/, (v) => `${PRODUCT}_${v}_amd64.deb`),
      installer("rpm", /\.rpm$/, (v) => `${PRODUCT}-${v}-1.x86_64.rpm`),
      installer("appimage", /\.AppImage$/, (v) => `${PRODUCT}_${v}_amd64.AppImage`),
    ],
  },
});

/** @param {string} platform */
export const isRequired = (platform) => REQUIRED_PLATFORMS.includes(platform);

/** @param {string} platform */
export const isKnownPlatform = (platform) => isRequired(platform) || OPTIONAL_PLATFORMS.includes(platform);

/**
 * @param {string} platform
 * @returns {{triple: string, files: FileSpec[]}}
 */
export function platformSpec(platform) {
  if (!isKnownPlatform(platform)) throw new TypeError(`unknown platform ${JSON.stringify(platform)}`);
  return PLATFORM_SPECS[platform];
}

/**
 * Final asset names for one platform, each signed file followed by its `.sig`.
 * @param {string} platform
 * @param {string} version X.Y.Z
 * @returns {string[]}
 */
export function expectedAssets(platform, version) {
  const names = [];
  for (const f of platformSpec(platform).files) {
    const name = f.final(version);
    names.push(name);
    if (f.signed) names.push(`${name}.sig`);
  }
  return names;
}
