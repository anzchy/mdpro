#!/usr/bin/env node
/** Purpose: Select frontend Vitest shard blobs and same-process JSON reports, validate profiles, and compare started test identities with the merged report (#639, #657, ADR-0130 Decision 1). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profileFor } from "./compare-report.mjs";

/** The shared prefix of one runner's blob artifacts; ci.yml's upload name and download pattern spell the same string. */
const shardPrefix = (os) => `frontend-blob-${os}-shard-`;

export const artifactName = (os, shard, attempt) => `${shardPrefix(os)}${shard}-attempt-${attempt}`;

const positive = (field, value) => {
  if (!/^[1-9]\d*$/.test(value ?? "")) throw Error(`${field} must be a positive integer, got ${JSON.stringify(value)}`);
  return Number(value);
};

/** One runner profile as compare-report.mjs reads it; a newline or a `$(` never reaches `$GITHUB_OUTPUT` or a shell. */
function checkProfile(profile, label) {
  try {
    profileFor(typeof profile === "string" ? profile : "");
  } catch {
    throw Error(`${label} must be a runner profile that compare-report.mjs accepts, got ${JSON.stringify(profile)}`);
  }
}

/** The `.ci-shard.json` a shard writes from its matrix values, run attempt, runner profile and `git rev-parse HEAD`. */
export function describeShard({ os, shard, count, attempt, profile, sha }) {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(os ?? "")) throw Error(`os must be a runner label, got ${JSON.stringify(os)}`);
  const meta = { os, shard: positive("shard", shard), count: positive("count", count), attempt: positive("attempt", attempt), profile, sha };
  if (meta.shard > meta.count) throw Error(`shard ${meta.shard} is above count ${meta.count}`);
  checkProfile(profile, "profile");
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw Error(`sha must be 40 lowercase hex digits, got ${JSON.stringify(sha)}`);
  return meta;
}

export function selectShards(downloads, count, os) {
  const prefix = shardPrefix(os);
  const newest = new Map();
  for (const name of fs.readdirSync(downloads)) {
    const match = name.startsWith(prefix) ? /^([1-9]\d*)-attempt-([1-9]\d*)$/.exec(name.slice(prefix.length)) : null;
    const shard = Number(match?.[1]), attempt = Number(match?.[2]);
    if (!match || shard > count) throw Error(`unexpected folder in the downloads: ${name}`);
    if (!newest.has(shard) || newest.get(shard).attempt < attempt) newest.set(shard, { shard, attempt, dir: path.join(downloads, name) });
  }
  const selected = [];
  for (let shard = 1; shard <= count; shard++) {
    const pick = newest.get(shard);
    if (!pick) throw Error(`shard ${shard} of ${count} (${os}): blob artifact missing`);
    selected.push({ ...pick, meta: readMeta(pick.dir) });
  }
  return selected;
}

function readMeta(dir) {
  const name = path.basename(dir);
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".ci-shard.json"), "utf8"));
  } catch (error) {
    throw Error(`${name}: unreadable .ci-shard.json (${error instanceof Error ? error.message : String(error)})`);
  }
}

function checkMeta({ shard, attempt, dir, meta }, count, os, sha) {
  const expected = { os, shard, count, attempt, sha };
  for (const [field, value] of Object.entries(expected)) {
    if (meta?.[field] !== value) throw Error(`${path.basename(dir)}: .ci-shard.json ${field} is ${JSON.stringify(meta?.[field])}, expected ${JSON.stringify(value)}`);
  }
  checkProfile(meta.profile, `${path.basename(dir)}: .ci-shard.json profile`);
}

export function collect(downloads, dest, count, os, sha) {
  const selected = selectShards(downloads, count, os);
  for (const item of selected) checkMeta(item, count, os, sha);
  const profiles = [...new Set(selected.map(({ meta }) => meta.profile))];
  if (profiles.length !== 1) throw Error(`shards disagree on the runner profile: ${profiles.join(" vs ")}`);
  const blobs = selected.map(({ shard, dir }) => {
    const name = `blob-${shard}-${count}.json`;
    const source = path.join(dir, ".vitest-reports", name);
    if (!fs.existsSync(source)) throw Error(`${path.basename(dir)}: no .vitest-reports/${name}`);
    if (fs.statSync(source).size === 0) throw Error(`${path.basename(dir)}: .vitest-reports/${name} is empty`);
    const report = path.join(dir, ".ci-vitest-results.json");
    if (!fs.existsSync(report) || fs.statSync(report).size === 0) throw Error(`${path.basename(dir)}: .ci-vitest-results.json missing or empty`);
    return { source, name };
  });
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw Error(`${dest} is not empty; refusing to mix blobs`);
  fs.mkdirSync(dest, { recursive: true });
  for (const { source, name } of blobs) fs.copyFileSync(source, path.join(dest, name));
  return selected[0].meta.profile;
}

const relativeTo = (root) => (file) => path.relative(root, file).replaceAll("\\", "/");

export function checkMerged(downloads, count, os, merged, listed, root) {
  const relative = relativeTo(root);
  const mergedFiles = merged.testResults.map((result) => relative(result.name));
  const ran = new Map();
  let tests = 0;
  for (const { shard, dir } of selectShards(downloads, count, os)) {
    const results = JSON.parse(fs.readFileSync(path.join(dir, ".ci-vitest-results.json"), "utf8"));
    tests += results.numTotalTests;
    for (const result of results.testResults) {
      const file = relative(result.name);
      if (ran.has(file)) throw Error(`${file} ran in shards ${ran.get(file)} and ${shard}`);
      ran.set(file, shard);
    }
  }
  const unran = listed.map((item) => relative(item.file)).filter((file) => !ran.has(file));
  if (unran.length) throw Error(`listed test files that no shard ran: ${unran.join(", ")}`);
  const listedFiles = new Set(listed.map((item) => relative(item.file)));
  const unlisted = [...ran.keys()].filter((file) => !listedFiles.has(file));
  if (unlisted.length) throw Error(`shard test files not in the test file list: ${unlisted.join(", ")}`);
  const inMerged = new Set(mergedFiles);
  const lost = [...ran.keys()].filter((file) => !inMerged.has(file));
  const foreign = mergedFiles.filter((file) => !ran.has(file));
  if (lost.length || foreign.length) throw Error(`merged report differs from the shards: missing ${lost.join(", ") || "none"}; extra ${foreign.join(", ") || "none"}`);
  if (merged.numTotalTests !== tests) throw Error(`merged report has ${merged.numTotalTests} tests; the shards ran ${tests}`);
  return { files: mergedFiles.length, tests };
}

/** Prove each shard's collection and run identities from one process, then conserve started identities across the merge. */
export function checkShardReports(downloads, count, os, merged, root) {
  if (!Array.isArray(merged?.testResults) || !merged.testResults.every((result) => typeof result?.name === "string" && Array.isArray(result.assertionResults))) {
    throw Error("malformed merged report: expected testResults[{name, assertionResults}]");
  }
  const relative = relativeTo(root);
  const identity = (file, name) => JSON.stringify([relative(file), name]);
  const label = (key) => {
    const [file, name] = JSON.parse(key);
    return `${file}: ${name}`;
  };
  const collected = new Map();
  const shardStarted = new Map();
  const selected = selectShards(downloads, count, os);
  for (const { shard, dir } of selected) {
    const file = path.join(dir, ".ci-vitest-results.json");
    let report;
    try {
      report = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw Error(`${path.basename(dir)}: unreadable .ci-vitest-results.json (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!Array.isArray(report?.testResults) || !report.testResults.every((result) => typeof result?.name === "string" && Array.isArray(result.assertionResults))) {
      throw Error(`${path.basename(dir)}: malformed .ci-vitest-results.json: expected testResults[{name, assertionResults}]`);
    }
    for (const result of report.testResults) for (const assertion of result.assertionResults) {
      if (!Array.isArray(assertion?.ancestorTitles) || !assertion.ancestorTitles.every((part) => typeof part === "string") || typeof assertion.title !== "string") {
        throw Error(`${path.basename(dir)}: malformed assertion in ${relative(result.name)}`);
      }
      const key = identity(result.name, [...assertion.ancestorTitles, assertion.title].join(" > "));
      const previous = collected.get(key);
      if (previous && previous.shard !== shard) throw Error(`${label(key)} collected in shards ${previous.shard} and ${shard}`);
      collected.set(key, { shard, count: (previous?.count ?? 0) + 1 });
      if (typeof assertion.duration === "number") {
        shardStarted.set(key, (shardStarted.get(key) ?? 0) + 1);
      } else if (!["pending", "skipped", "todo"].includes(assertion.status)) {
        throw Error(`${label(key)}: collected but did not start and is not statically skipped or todo`);
      }
    }
  }
  const started = new Map();
  for (const result of merged.testResults) {
    for (const assertion of result.assertionResults) {
      if (typeof assertion?.duration !== "number") continue;
      if (!Array.isArray(assertion.ancestorTitles) || !assertion.ancestorTitles.every((part) => typeof part === "string") || typeof assertion.title !== "string") {
        throw Error(`malformed started assertion in ${relative(result.name)}`);
      }
      const key = identity(result.name, [...assertion.ancestorTitles, assertion.title].join(" > "));
      started.set(key, (started.get(key) ?? 0) + 1);
    }
  }
  const differences = [...new Set([...shardStarted.keys(), ...started.keys()])]
    .filter((key) => (shardStarted.get(key) ?? 0) !== (started.get(key) ?? 0))
    .map((key) => `${label(key)}: ${shardStarted.get(key) ?? 0} shard, ${started.get(key) ?? 0} merged`);
  if (differences.length) throw Error(`merged started identities differ from shard reports: ${differences.join("; ")}`);
  return { files: new Set([...started.keys()].map((key) => JSON.parse(key)[0])).size, tests: [...started.values()].reduce((sum, n) => sum + n, 0) };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const commands = {
  describe: ([os, shard, count, attempt, profile, sha]) => `${JSON.stringify(describeShard({ os, shard, count, attempt, profile, sha }))}\n`,
  collect: ([downloads, dest, count, os, sha]) => `${collect(downloads, dest, positive("count", count), os, sha)}\n`,
  check: ([downloads, count, os, mergedPath, listPath, root]) => {
    const shards = positive("count", count);
    const result = checkMerged(downloads, shards, os, readJson(mergedPath), readJson(listPath), root);
    return `shard reports PASS (${result.files} files, ${result.tests} tests in ${shards} shards)\n`;
  },
  union: ([downloads, count, os, mergedPath, root]) => {
    const shards = positive("count", count);
    const result = checkShardReports(downloads, shards, os, readJson(mergedPath), root);
    return `shard test reports PASS (${result.files} files, ${result.tests} tests in ${shards} shards)\n`;
  },
};

// realpath on both sides: run through a symlinked path, a plain comparison would skip the CLI and exit 0 silently.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (!Object.hasOwn(commands, command)) throw Error(`expected one of ${Object.keys(commands).join(", ")}`);
    process.stdout.write(commands[command](args));
  } catch (error) {
    process.stderr.write(`shard-reports ${command ?? ""} FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
