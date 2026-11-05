// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const supervisor = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows/native-supervisor.ps1");

it("GH637-S14 retains held progress across empty, whitespace and null reads but rejects another run", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mdpro-empty-progress-"));
  const script = String.raw`
. $env:TEST_SUPERVISOR
$RunId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$outPath = Join-Path $env:TEST_DIR 'ui-out.json'
$script:lastProgress = [pscustomobject]@{ runId = $RunId; phase = 'held'; completedSteps = 1; heldInput = 'uncertain' }
function Observe {
  try {
    $value = Read-WorkerProgress
    return @{ runId = $value.runId; phase = $value.phase; heldInput = $value.heldInput }
  } catch { return @{ error = $_.Exception.Message } }
}
$progressPath = "$outPath.progress.json"
$seen = @()
foreach ($content in @('', '  ', 'null')) {
  [IO.File]::WriteAllText($progressPath, $content)
  $seen += Observe
}
[IO.File]::WriteAllText($progressPath, '{"runId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","phase":"foreign"}')
$foreign = Observe
@{ seen = $seen; foreign = $foreign } | ConvertTo-Json -Compress -Depth 5
`;
  const { stdout } = await execFileAsync("pwsh", ["-NoProfile", "-Command", script], {
    env: { ...process.env, TEST_SUPERVISOR: supervisor, TEST_DIR: dir },
  });
  const result = JSON.parse(stdout.trim());
  expect(result.seen).toEqual(Array(3).fill({
    runId: "a".repeat(32), phase: "held", heldInput: "uncertain",
  }));
  expect(result.foreign).toEqual({ error: "NATIVE_PROGRESS_RUN_MISMATCH" });
});
