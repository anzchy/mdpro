// @vitest-environment node
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

async function waitFor(file: string) {
  const limit = Date.now() + 8000;
  while (Date.now() < limit) {
    if (await access(file).then(() => true, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`);
}

it("publishes a fake-worker progress transition only after its temporary file is complete", async () => {
  const fixture = await supervisorFixture("lost-progress", { env: { TEST_ATOMIC_PAUSE_WRITE: "2" } });
  const run = fixture.start();
  const progressPath = path.join(fixture.dir, "runs", fixture.runId, "ui-out.json.progress.json");
  await waitFor(path.join(fixture.dir, "atomic-temp-ready"));
  try {
    const before = JSON.parse(await readFile(progressPath, "utf8"));
    expect(before.phaseComplete).toBe(false);
  } finally {
    await writeFile(path.join(fixture.dir, "atomic-release"), "release");
  }
  await waitFor(path.join(fixture.dir, "atomic-published"));
  const after = JSON.parse(await readFile(progressPath, "utf8"));
  expect(after.phaseComplete).toBe(true);
  expect(after.runId).toBe(fixture.runId);
  await run.result;
}, 20000);
