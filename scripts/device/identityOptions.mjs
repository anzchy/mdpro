/** Parse a device launch command without allowing a malformed identity to start the app. */
import path from "node:path";

const RELEASE_ID = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?@[0-9a-f]{40}$/;

/** @param {string[]} args @param {{resolveDefault:()=>Promise<string>}} deps */
export async function parseIdentityOptions(args, deps) {
  const values = {};
  const flags = { "--bundle": "bundlePath", "--file": "filePath", "--out": "outPath", "--expected-release-id": "expectedReleaseId" };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--check-only") {
      if (values.checkOnly) throw new Error("duplicate --check-only");
      values.checkOnly = true;
      continue;
    }
    const key = flags[flag];
    if (!key || values[key] !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`unknown, duplicate, or incomplete argument: ${flag}`);
    }
    values[key] = args[++index];
  }
  if (!values.bundlePath || !path.isAbsolute(values.bundlePath) || !values.bundlePath.endsWith(".app")) {
    throw new Error("--bundle must be an absolute .app path");
  }
  for (const key of ["filePath", "outPath"]) {
    if (values[key] !== undefined && !path.isAbsolute(values[key])) throw new Error(`${key} must be absolute`);
  }
  if (values.checkOnly && values.filePath) throw new Error("--file cannot be used with --check-only");
  values.expectedReleaseId ??= await deps.resolveDefault();
  if (!RELEASE_ID.test(values.expectedReleaseId)) throw new Error("expected release id is malformed");
  return { bundlePath: values.bundlePath, filePath: values.filePath, outPath: values.outPath,
    expectedReleaseId: values.expectedReleaseId, checkOnly: values.checkOnly ?? false };
}
