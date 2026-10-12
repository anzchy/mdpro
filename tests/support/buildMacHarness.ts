/**
 * Shared harness for the scripts/build-mac.sh tests
 * (tests/d182-build-mac-masked-failure.test.ts,
 * tests/d183-build-mac-product-checks.test.ts).
 *
 * The real script is copied into a throwaway project (it locates the project
 * root from its own path) and run with stub `pnpm` / `cargo` / `rustc` on
 * PATH. Nothing real is built. The caller removes the project with cleanup().
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'build-mac.sh');
export const VERSION = '9.8.7';

// Stub pnpm. Behaviour is chosen per test through env vars:
//   STUB_LOG=<file>       → every invocation appends its arguments to <file>
//   STUB_INSTALL_FAIL=1   → `pnpm install` exits 1 (e.g. the D181 guard)
//   STUB_TAURI=fail       → `pnpm tauri build` prints and exits 1
//   STUB_TAURI=nodmg      → exits 0 without writing a DMG
//   STUB_TAURI=dmg        → writes a fresh DMG + .app, output has kept lines
//   STUB_TAURI=dmg-quiet  → writes a fresh DMG + .app, output is only blank
//                           lines and warning[ lines (all filtered out)
//   STUB_TAURI=dmg-noapp  → writes a fresh DMG only; any .app is left as is
//   STUB_TAURI=dmg-two    → writes a fresh .app and two fresh DMGs for the
//                           version (STUB_DMG_A, STUB_DMG_B). The one `find`
//                           lists first (STUB_NEWER=first) or second
//                           (STUB_NEWER=last) gets an mtime a minute ahead;
//                           its file name goes to $STUB_NEWEST.
//   STUB_TAURI=dmg-binonly → writes a fresh DMG and a fresh main binary, but
//                           leaves an existing Info.plist alone
const PNPM_STUB = `#!/bin/sh
[ -n "$STUB_LOG" ] && echo "pnpm $*" >> "$STUB_LOG"
case "$1" in
  --version) echo "10.26.1"; exit 0 ;;
  install)
    if [ "$STUB_INSTALL_FAIL" = "1" ]; then
      echo "D181 guard: prosemirror-tables is unpatched" >&2
      exit 1
    fi
    exit 0 ;;
  test:run) exit 0 ;;
  tauri)
    bundle="$PWD/src-tauri/target/release/bundle"
    write_dmg() {
      mkdir -p "$bundle/dmg"
      echo "fresh" > "$bundle/dmg/mdpro_\${VERSION}_aarch64.dmg"
    }
    write_bin() {
      mkdir -p "$bundle/macos/mdpro.app/Contents/MacOS"
      echo "bin" > "$bundle/macos/mdpro.app/Contents/MacOS/tauri-app"
    }
    write_app() {
      write_bin
      echo "<plist/>" > "$bundle/macos/mdpro.app/Contents/Info.plist"
    }
    write_out() { write_dmg; write_app; }
    case "$STUB_TAURI" in
      fail) echo "error: failed to bundle project"; exit 1 ;;
      nodmg) echo "    Finished release"; exit 0 ;;
      dmg) echo "    Finished release"; write_out; exit 0 ;;
      dmg-quiet) echo ""; echo "warning[unused]: x" >&2; write_out; exit 0 ;;
      dmg-noapp) echo "    Finished release"; write_dmg; exit 0 ;;
      dmg-binonly) echo "    Finished release"; write_dmg; write_bin; exit 0 ;;
      dmg-two)
        echo "    Finished release"
        write_app
        mkdir -p "$bundle/dmg"
        echo "a" > "$bundle/dmg/$STUB_DMG_A"
        echo "b" > "$bundle/dmg/$STUB_DMG_B"
        first=$(find "$bundle/dmg" -name "mdpro_\${VERSION}_*.dmg" | head -1)
        case "$first" in
          */"$STUB_DMG_A") listed_first="$STUB_DMG_A"; listed_last="$STUB_DMG_B" ;;
          *) listed_first="$STUB_DMG_B"; listed_last="$STUB_DMG_A" ;;
        esac
        if [ "$STUB_NEWER" = "first" ]; then newer="$listed_first"; else newer="$listed_last"; fi
        touch -t "$(date -v+1M +%Y%m%d%H%M.%S)" "$bundle/dmg/$newer"
        echo "$newer" > "$STUB_NEWEST"
        exit 0 ;;
    esac
    exit 99 ;;
esac
exit 0
`;

const OK_STUB = `#!/bin/sh
[ -n "$STUB_LOG" ] && echo "$(basename "$0") $*" >> "$STUB_LOG"
case "$1" in
  --version) echo "tool 1.0.0" ;;
esac
exit 0
`;

export const AN_HOUR_AGO = () => new Date(Date.now() - 3600_000);

export interface BuildMacProject {
  root: string;
  stubBin: string;
  bundle: string;
  writeStub(name: string, body: string): void;
  /** Writes `content` to `rel` under the project root, creating parent dirs. */
  writeProjectFile(rel: string, content: string): void;
  /** An old DMG for the version and an old, complete mdpro.app. Returns the DMG path. */
  placeStaleBuild(): string;
  /** Runs the copied script with --skip-tests. `path` overrides the default PATH. */
  run(env: Record<string, string>, path?: string): { status: number | null; out: string };
  /** A PATH that holds the stubs plus `node`, symlinked, and the system dirs. */
  defaultPath(): string;
  cleanup(): void;
}

export function createBuildMacProject(prefix = 'build-mac-'): BuildMacProject {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const stubBin = join(root, 'stub-bin');
  const bundle = join(root, 'src-tauri', 'target', 'release', 'bundle');

  const writeStub = (name: string, body: string) => {
    const p = join(stubBin, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  };
  const writeProjectFile = (rel: string, content: string) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  const setOld = (p: string) => {
    const t = AN_HOUR_AGO();
    utimesSync(p, t, t);
  };
  const placeStaleBuild = () => {
    mkdirSync(join(bundle, 'dmg'), { recursive: true });
    const macos = join(bundle, 'macos', 'mdpro.app', 'Contents', 'MacOS');
    mkdirSync(macos, { recursive: true });
    const dmg = join(bundle, 'dmg', `mdpro_${VERSION}_aarch64.dmg`);
    writeFileSync(dmg, 'old');
    setOld(dmg);
    const bin = join(macos, 'tauri-app');
    writeFileSync(bin, 'old bin');
    setOld(bin);
    const plist = join(bundle, 'macos', 'mdpro.app', 'Contents', 'Info.plist');
    writeFileSync(plist, '<plist/>');
    setOld(plist);
    setOld(macos);
    setOld(join(bundle, 'macos', 'mdpro.app', 'Contents'));
    setOld(join(bundle, 'macos', 'mdpro.app'));
    return dmg;
  };
  const defaultPath = () => [stubBin, '/usr/bin', '/bin'].join(':');
  const run = (env: Record<string, string>, path?: string) => {
    const res = spawnSync(join(root, 'scripts', 'build-mac.sh'), ['--skip-tests'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: path ?? defaultPath(), HOME: root, TMPDIR: root, ...env },
      timeout: 30_000,
    });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  };

  mkdirSync(stubBin);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(SCRIPT, join(root, 'scripts', 'build-mac.sh'));
  chmodSync(join(root, 'scripts', 'build-mac.sh'), 0o755);
  writeProjectFile('package.json', JSON.stringify({ version: VERSION }));
  writeProjectFile(
    'src-tauri/tauri.conf.json',
    JSON.stringify({ productName: 'mdpro', version: VERSION }),
  );
  writeProjectFile(
    'src-tauri/Cargo.toml',
    `[package]\nname = "tauri-app"\nversion = "${VERSION}"\nedition = "2021"\n`,
  );
  writeStub('pnpm', PNPM_STUB);
  writeStub('cargo', OK_STUB);
  writeStub('rustc', OK_STUB);
  // node by symlink rather than its install dir on PATH, so PATH holds no
  // other tool from that dir (e.g. a rustc next to node).
  symlinkSync(process.execPath, join(stubBin, 'node'));

  return {
    root,
    stubBin,
    bundle,
    writeStub,
    writeProjectFile,
    placeStaleBuild,
    run,
    defaultPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
