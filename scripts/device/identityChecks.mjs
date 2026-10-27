/**
 * Purpose: decide whether a device launch belongs to the requested bundle and build.
 * The driver supplies fresh log records and a final process snapshot; this module does no I/O.
 */
import path from "node:path";

function insideBundle(bundlePath, exe) {
  if (typeof exe !== "string" || !path.isAbsolute(exe)) return false;
  const relative = path.relative(path.join(bundlePath, "Contents", "MacOS"), exe);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** @param {{bundlePath:string,bundleExists:boolean,expectedReleaseId:string,processes:Array<{pid:number,exe:string}>,records:Array<{event:string,status:string,context?:{pid?:number,releaseId?:string}}>}} facts */
export function evaluateIdentity(facts) {
  const bundlePass = facts.bundleExists === true;
  const process = facts.processes?.length === 1 ? facts.processes[0] : null;
  const processPass = bundlePass && process !== null && insideBundle(facts.bundlePath, process.exe);
  const records = Array.isArray(facts.records) ? facts.records : [];
  const readyIndex = records.findIndex((record) => record.event === "app.ready");
  const ready = readyIndex < 0 ? null : records[readyIndex];
  const releasePass = processPass && ready?.status === "success" && ready.context?.pid === process.pid
    && ready.context?.releaseId === facts.expectedReleaseId;
  const windowPass = processPass && ready?.context?.pid === process.pid && records.slice(0, readyIndex).some((record) =>
    record.event === "window.open" && record.status === "success" && record.context?.pid === process.pid);
  const checks = [
    ["bundle", bundlePass ? "PASS" : "FAIL"],
    ["process", processPass ? "PASS" : "FAIL"],
    ["releaseId", releasePass ? "PASS" : "FAIL"],
    ["window", !processPass ? "SKIPPED" : windowPass ? "PASS" : "FAIL"],
  ];
  return {
    lines: checks.map(([name, status]) => `[${status}] ${name}`),
    exit: checks.every(([, status]) => status === "PASS") ? 0 : 1,
  };
}
