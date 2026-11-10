#!/usr/bin/env node
/**
 * Purpose: MIG-003d (#756) — the delegator's local, read-only CI metrics (stub; cycles fill it in).
 */
import { pathToFileURL } from "node:url";

export function percentile() {
  return null;
}

export function computeMetrics() {
  return {};
}

export function parseArgs() {
  return { ok: true };
}

export function resolveOutDir() {
  return { ok: true };
}

export function makeGhRequest() {
  return () => null;
}

export async function collect() {
  return {};
}

export function renderSummary() {
  return "";
}

export async function main() {
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
