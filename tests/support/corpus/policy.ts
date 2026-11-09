/** Static corpus policy reads real import syntax, including aliased type exports and dynamic imports. */
import { posix } from 'node:path';
import ts from 'typescript';
export interface CorpusSource { path: string; source: string }
export interface CorpusPolicyOptions { aliases?: Readonly<Record<string, string>> }
function imports(source: string): string[] {
  const results: string[] = [];
  const tree = ts.createSourceFile('corpus.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) results.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) results.push(node.arguments[0].text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) results.push(node.argument.literal.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) results.push(node.moduleReference.expression.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...new Set(results)];
}
function resolveImport(file: string, specifier: string, aliases: Readonly<Record<string, string>>): string {
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(file), specifier));
  const alias = Object.keys(aliases).sort((a, b) => b.length - a.length).find(prefix => specifier.startsWith(prefix));
  return posix.normalize(alias ? aliases[alias] + specifier.slice(alias.length) : specifier);
}
export function corpusImportViolations(files: CorpusSource[], options: CorpusPolicyOptions = {}): string[] {
  const aliases = { '@/': 'src/', ...options.aliases };
  const byPath = new Map(files.map(file => [posix.normalize(file.path), file]));
  const messages = new Set<string>();
  const visited = new Set<string>();
  const resolveFile = (path: string) => [path, path + '.ts', path + '.tsx', path + '/index.ts', path + '/index.tsx'].find(candidate => byPath.has(candidate));
  function visit(path: string, neutral: boolean) {
    const key = `${neutral}:${path}`;
    if (visited.has(key)) return;
    visited.add(key);
    const file = byPath.get(path);
    if (!file) return;
    for (const specifier of imports(file.source)) {
      const resolved = resolveImport(path, specifier, aliases);
      if (/(?:d188EmptyParagraphRig|d194LinkDefinitionRig|scriptedMilkdownRig|editorMenuRig)/i.test(resolved)) messages.add(`${path}: reduced rig import ${specifier}`);
      else if (/(?:^|\/)src\/services\/editor(?:\/|$)/.test(resolved)) messages.add(`${path}: editor port import ${specifier}`);
      else if (neutral && /^(?:@milkdown\/|@tiptap\/|prosemirror-|@codemirror\/|src\/)/.test(resolved)) messages.add(`${path}: engine-neutral interface import ${specifier}`);
      const child = resolveFile(resolved);
      if (child) visit(child, neutral);
    }
  }
  for (const file of files) visit(posix.normalize(file.path), false);
  visit('tests/support/corpus/types.ts', true);
  return [...messages].sort();
}
/** Verify rule-10 locations; platform/origin requirements apply to mounting .tsx runners, not pure behavior tests. */
export function corpusPlacementViolations(files: CorpusSource[]): string[] {
  const errors: string[] = [];
  const byPath = new Map(files.map(file => [file.path, file]));
  function reachesSource(path: string, visited = new Set<string>()): boolean {
    if (visited.has(path)) return false;
    visited.add(path);
    const file = byPath.get(path);
    if (!file) return false;
    return imports(file.source).some(specifier => {
      const resolved = resolveImport(path, specifier, { '@/': 'src/' });
      if (resolved.startsWith('src/')) return true;
      const child = [resolved, resolved + '.ts', resolved + '.tsx', resolved + '/index.ts'].find(candidate => byPath.has(candidate));
      return child !== undefined && reachesSource(child, visited);
    });
  }
  for (const file of files) {
    const path = file.path;
    const runnerLike = /corpus-[a-n]-.*\.test\.tsx$/.test(path);
    if (runnerLike || (/corpus-.*\.test\.tsx$/.test(path) && !path.startsWith('tests/tooling/'))) {
      if (!/^tests\/corpus-[a-n]-[a-z0-9-]+\.(?:any|mac|win)(?:\.slow)?\.test\.tsx$/.test(path)) errors.push(path + ': runner must use root/category/platform naming');
      const tree = ts.createSourceFile(path, file.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let platformPosition = Infinity;
      let importPosition = Infinity;
      function visit(node: ts.Node) {
        if (ts.isImportDeclaration(node) || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) importPosition = Math.min(importPosition, node.getStart(tree));
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(tree) === 'Object' && node.expression.name.text === 'defineProperty' && node.arguments[0]?.getText(tree) === 'navigator' && node.arguments[1] && ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text === 'platform') platformPosition = Math.min(platformPosition, node.getStart(tree));
        ts.forEachChild(node, visit);
      }
      visit(tree);
      if (platformPosition === Infinity || platformPosition > importPosition || /\b(?:skipIf|runIf)\s*\(/.test(file.source)) errors.push(path + ': platform must be injected before imports without skips');
      if (path.startsWith('tests/corpus-j-') || /\bactivateLink\b/.test(file.source)) {
        const option = file.source.match(/\/\*\*[\s\S]*?@vitest-environment-options\s+(\{[^}]*\})[\s\S]*?\*\//);
        let origin: unknown;
        try { origin = option ? JSON.parse(option[1]).url : undefined; } catch { origin = undefined; }
        if (origin !== 'tauri://localhost/') errors.push(path + ': activation requires production origin');
      }
    } else if (path.startsWith('tests/tooling/corpus-') && /\.test\.ts$/.test(path)) {
      if (reachesSource(path)) errors.push(path + ': tooling test reaches src and belongs at tests root');
    } else if (!/^tests\/corpus-[a-z0-9-]+(?:\.slow)?\.test\.ts$/.test(path) && !path.startsWith('tests/support/corpus/') && !path.startsWith('scripts/corpus/') && !path.startsWith('tests/fixtures/markdown-corpus/')) errors.push(path + ': invalid corpus placement');
  }
  return errors.sort();
}
