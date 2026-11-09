/** Contained, symlink-free file inventories shared by the read-only checker and the single merge. */
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, relative, resolve, sep } from 'node:path';
/** macOS exposes tmpdir through /var; canonicalize that system boundary before inspecting caller components. */
export function safeLocation(path: string): string {
  const absolute = resolve(path), temporary = resolve(tmpdir());
  const boundary = absolute === temporary || absolute.startsWith(temporary + sep) ? temporary : parse(absolute).root;
  let current = realpathSync(boundary);
  for (const component of relative(boundary, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${path}: ancestor symlink is forbidden`);
  }
  return current;
}
export function readTree(root: string): Record<string, Buffer> {
  const absolute = safeLocation(root), files: Record<string, Buffer> = {};
  function walk(directory: string, prefix: string): void {
    if (lstatSync(directory).isSymbolicLink()) throw new Error(`${prefix || root}: symlink is forbidden`);
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), relative = prefix + name, stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`${relative}: symlink is forbidden`);
      if (stat.isDirectory()) walk(path, relative + '/');
      else if (stat.isFile()) files[relative] = readFileSync(path);
      else throw new Error(`${relative}: non-file fixture is forbidden`);
    }
  }
  walk(absolute, ''); return files;
}
