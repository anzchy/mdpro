import { runIdentity } from "../../scripts/device/identity.mjs";

const [bundle, out, releaseId] = process.argv.slice(2);
await runIdentity(["--bundle", bundle, "--expected-release-id", releaseId, "--out", out], {
  scanProcesses: async () => [],
  logCursor: async () => 0,
  launch: async () => { setInterval(() => {}, 1000); await new Promise(() => {}); },
});
