// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { powershell, quote, windows } from "./windows-driver-d346-harness";

describe("D346 bootstrap observations and named pre-input setup failure", () => {
  it("conserves each actual assembly-loop identity through Check-Probe twice (enumerate, B1)", async () => {
    const source = await readFile(path.join(windows, "native-bootstrap-probe.ps1"), "utf8");
    const body = source.slice(source.indexOf("function Check-Probe("), source.indexOf("function Read-BootstrapVector("));
    const start = source.indexOf('foreach ($name in @("UIAutomationClient"');
    const loop = source.slice(start, source.indexOf("\ntry {", start));
    const result = JSON.parse(await powershell(String.raw`
class AssemblyBoundary {
  [string]$FullName
  AssemblyBoundary([string]$n){$this.FullName=$n}
  [object]GetName(){return [pscustomobject]@{Name=$this.FullName}}
}
function Resolve-Framework([string]$assemblyName) {
  $script:observed+=,$assemblyName
  if($assemblyName.Contains(':')){throw 'invalid assembly identity'}
  return [AssemblyBoundary]::new($assemblyName)
}
$script:windows51=$true; $script:failures=0; $script:observed=@()
${body}
$output=@(1..2|ForEach-Object { ${loop.replace("[Reflection.Assembly]::LoadWithPartialName($name)", "(Resolve-Framework $name)")} })
@{observed=@($script:observed);output=$output;failures=$script:failures}|ConvertTo-Json -Compress
`));
    const names = ["UIAutomationClient", "UIAutomationTypes", "System.Windows.Forms", "System.Drawing"];
    expect(result.observed).toEqual([...names, ...names]);
    expect(result.output).toEqual([...names, ...names].map((n) => `OK assembly:${n} ${n}`));
    expect(result.failures).toBe(0);
  });

  it("accepts producer four-argument vectors and keeps three-argument inspection (enumerate A6, ruling2)", async () => {
    const source = await readFile(path.join(windows, "native-bootstrap-probe.ps1"), "utf8");
    const supervisor = await readFile(path.join(windows, "native-supervisor.ps1"), "utf8");
    const result = JSON.parse(await powershell(String.raw`
$source=${quote(source)}
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$null)
foreach($f in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($f.Extent.Text))}
$producer=${quote(supervisor)}
$producerAst=[Management.Automation.Language.Parser]::ParseInput($producer,[ref]$null,[ref]$null)
$assignment=$producerAst.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$arguments'},$true)[0].Extent.Text
$call=$producerAst.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-SchedulerPhase' -and $n.Extent.Text.Contains('scheduler-start')},$true)[0].Extent.Text
function Invoke-SchedulerPhase {param($Name,$Request,$Limit) $script:request=$Request}
$output=@()
foreach($root in @('C:\Audit Space','C:\审计 空间')){
 $PSScriptRoot=$root; $RunId='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; $runDir="$root\runs\$RunId"
 $DeadlineMs=2000000000000L; $PhaseMs=5000; $CleanupMs=5000; $workEnd=$DeadlineMs-5000
 $inputJob=[pscustomobject]@{Name="Global\mdpro-driver-$RunId"}; $env:ComSpec='C:\Windows\system32\cmd.exe'; $bootstrap="$root\native-job.exe"; $taskName="mdpro-audit-ui-$RunId"
 # Detached AST text has no source-file PSScriptRoot. Supply that filesystem boundary explicitly.
 $boundAssignment=$assignment.Replace('$PSScriptRoot', "'"+$root.Replace("'", "''")+"'")
 . ([scriptblock]::Create($boundAssignment)); . ([scriptblock]::Create($call))
 foreach($legacy in @($false,$true)){
  $text=$request.arguments
  if($legacy){$text=$inputJob.Name+' "'+$env:ComSpec+'" '+$arguments}
  try{$v=Read-BootstrapVector $text; $output+=,@{root=$root;legacy=$legacy;job=$v.job;exe=$v.exe;dir=$v.dir;error=$null}}
  catch{$output+=,@{root=$root;legacy=$legacy;error=$_.Exception.Message}}
 }
 foreach($bad in @(($text+' "'+$runDir.Replace($RunId,('b'*32))+'"'), ($text+' "C:\other\runs\'+$RunId+'"'))){
  try{$null=Read-BootstrapVector $bad; $output+=,@{bad=$true;accepted=$true}}
  catch{$output+=,@{bad=$true;accepted=$false}}
 }
}
ConvertTo-Json -InputObject $output -Compress -Depth 6
`));
    const valid = result.filter((r: { bad?: boolean }) => !r.bad);
    expect(valid).toHaveLength(4);
    for (const v of valid) {
      expect(v.error).toBeNull();
      expect(v.job).toBe("Global\\mdpro-driver-" + "a".repeat(32));
      expect(v.exe).toBe("C:\\Windows\\system32\\cmd.exe");
      if (!v.legacy) expect(v.dir).toBe(v.root + "\\runs\\" + "a".repeat(32));
    }
    expect(result.filter((r: { bad?: boolean }) => r.bad).map((r: { accepted: boolean }) => r.accepted)).toEqual([false,false,false,false]);
    expect(await readFile(path.join(windows, "native-bootstrap-probe.ps1"), "utf8")).toBe(source);
  });
});
