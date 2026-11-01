import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const windows = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows");
export const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export async function powershell(script: string) {
  const { stdout } = await execute("pwsh", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
let compiled: Promise<Buffer> | undefined;
async function binary() {
  if (!compiled) compiled = (async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "d344-compiler-"));
    const target = path.join(dir, "native-job.exe");
    // Separate setup process: no NativeJobScope type is loaded in a tested session yet.
    await powershell(`$ErrorActionPreference='Stop'; Add-Type -Path ${quote(path.join(windows, "native-job.cs"))} -OutputAssembly ${quote(target)}`);
    return readFile(target);
  })();
  return compiled;
}
export async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "d344-"));
  const dir = path.join(base, "native 中文 space");
  await mkdir(dir);
  for (const file of ["native-job.cs", "native-job.ps1", "native-validation.ps1"]) await copyFile(path.join(windows, file), path.join(dir, file));
  await writeFile(path.join(dir, "native-job.exe"), await binary());
  await manifest(dir);
  try { await copyFile(path.join(windows, "native-setup-probe.ps1"), path.join(dir, "native-setup-probe.ps1")); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  return dir;
}
export async function manifest(dir: string) {
  const source = hash(await readFile(path.join(dir, "native-job.cs")));
  const binary = hash(await readFile(path.join(dir, "native-job.exe")));
  await writeFile(path.join(dir, "native-job-build.json"), JSON.stringify({ source, binary }));
}
export async function files(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    const file = path.join(dir, name);
    result[name] = hash(await readFile(file));
  }
  return result;
}
export const loadExpression = String.raw`
$failure=$null; $output=@()
try { $output=@(. (Join-Path $root 'native-job.ps1')) } catch { $failure=$_.Exception.Message }
$type='NativeJobScope' -as [type]
@{ error=$failure; count=$output.Count; loaded=($null -ne $type);
   location=$(if($type){$type.Assembly.Location}else{$null});
   members=@(if($type){$type.GetMethods() | ForEach-Object {$_.Name} | Sort-Object -Unique}) }
`;
export async function load(dir: string) {
  return JSON.parse(await powershell(`$ErrorActionPreference='Stop'; $root=${quote(dir)}; ${loadExpression} | ConvertTo-Json -Compress`));
}
export async function tamper(dir: string, kind: string) {
  if (kind === "missing-binary") await rm(path.join(dir, "native-job.exe"));
  else if (kind === "missing-manifest") await rm(path.join(dir, "native-job-build.json"));
  else if (kind === "missing-both") { await rm(path.join(dir, "native-job.exe")); await rm(path.join(dir, "native-job-build.json")); }
  else if (kind === "source") await writeFile(path.join(dir, "native-job.cs"), "changed source");
  else if (kind === "binary" || kind === "corrupt") { await writeFile(path.join(dir, "native-job.exe"), "not an assembly"); if (kind === "corrupt") await manifest(dir); }
  else {
    const file = path.join(dir, "native-job-build.json");
    const value = JSON.parse(await readFile(file, "utf8"));
    value.binary = "0".repeat(64);
    await writeFile(file, JSON.stringify(value));
  }
}
export async function probe(dir: string) {
  // Absence is observable test data, not a missing-module runner failure.
  return (await powershell(`$ErrorActionPreference='Stop'; $p=${quote(path.join(dir, "native-setup-probe.ps1"))}; if(Test-Path -LiteralPath $p){ & $p }else{'FAIL probe-missing'}`)).split(/\r?\n/);
}

type Command = { name: string | null; text: string; invocation: string; elements: string[] };
type Ast = { commands: Command[]; assignments: { left: string; right: string }[]; methods: string[]; redirects: string[]; errors: string[] };
export async function ast(source: string): Promise<Ast> {
  const encoded = Buffer.from(source).toString("base64");
  return JSON.parse(await powershell(String.raw`
$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$tokens=$null; $errors=$null
$a=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
@{ commands=@($a.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]},$true) | ForEach-Object {
  @{name=$_.GetCommandName(); text=$_.Extent.Text; invocation=$_.InvocationOperator.ToString(); elements=@($_.CommandElements | ForEach-Object {$_.Extent.Text})}
}); assignments=@($a.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst]},$true) | ForEach-Object {@{left=$_.Left.Extent.Text;right=$_.Right.Extent.Text}});
methods=@($a.FindAll({param($n) $n -is [Management.Automation.Language.InvokeMemberExpressionAst]},$true) | ForEach-Object {$_.Extent.Text});
redirects=@($a.FindAll({param($n) $n -is [Management.Automation.Language.RedirectionAst]},$true) | ForEach-Object {$_.Extent.Text});
errors=@($errors | ForEach-Object {$_.Message}) } | ConvertTo-Json -Compress -Depth 8
`));
}
export function unsupportedExe(a: Ast) {
  const vars = new Map(a.assignments.map((v) => [v.left.toLowerCase(), v.right]));
  return a.commands.filter((c) => {
    if (c.name?.toLowerCase() !== "add-type") return false;
    const index = c.elements.findIndex((s) => s.toLowerCase() === "-path");
    if (index < 0) return false;
    const raw = c.elements[index + 1] ?? "";
    const value = vars.get(raw.toLowerCase()) ?? raw;
    return /\.exe(?:[\s'"`)]|$)/i.test(value);
  }).map((c) => c.text);
}
export function readonlyViolations(a: Ast) {
  const violations = [...a.errors, ...a.redirects];
  const allowed = new Set(["join-path", "test-path", "get-content", "convertfrom-json", "get-filehash", "read-nativesteps", "write-output"]);
  for (const c of a.commands) {
    const name = c.name?.toLowerCase();
    if (c.invocation === "Dot") {
      if (!/^"\$PSScriptRoot[\\/]native-(job|validation)\.ps1"$/.test(c.elements[0] ?? "")) violations.push(c.text);
    } else if (c.invocation !== "Unknown") violations.push(c.text);
    else if (name === "new-object") {
      if (c.elements.length !== 3 || !/^text\.utf8encoding$/i.test(c.elements[1] ?? "") || c.elements[2] !== "($false, $true)") violations.push(c.text);
    } else if (!name || !allowed.has(name)) violations.push(c.text);
  }
  for (const method of a.methods) {
    if (!/^(\[System\.Reflection\.Assembly\]::LoadFrom\(\$nativeBinary\)|\[Reflection\.Assembly\]::LoadFrom\(\$nativeBinary\)|\[Convert\]::(?:FromBase64String|ToBase64String)\(|\[long\]::TryParse\(|\[Text\.Encoding\]::UTF8\.(?:GetBytes|GetString)\(|\(New-Object Text\.UTF8Encoding\(\$false, \$true\)\)\.GetString\(|\$raw\.TrimStart\()/i.test(method)) violations.push(method);
  }
  for (const assignment of a.assignments) if (/^\$(?:env|global|script):/i.test(assignment.left)) violations.push(assignment.left);
  return violations;
}
