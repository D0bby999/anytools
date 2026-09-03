#!/usr/bin/env node
/**
 * Release gate: fetch every route `route-inventory.mjs` enumerates against a running
 * container and assert 200/404 as expected. Used against the local self-host image
 * before tagging v1.0.0, and again against the pushed GHCR image (both architectures)
 * before making the GitHub Release — see phase-04-release-v1-gate.md "Architecture".
 *
 * Usage:
 *   node scripts/release-gate.mjs --base=http://localhost:3130 [--concurrency=8]
 *
 * Exit code: 0 if every expect200 route returned 200 AND every expect404 route
 * returned 404 (or, for the one POST route, the wrong-method response Next's
 * router returns is still treated as a real block — see the inline note below).
 * Non-zero otherwise. Prints a summary table either way.
 */
import { buildRouteInventory } from './lib/route-inventory.mjs';

function parseArgs(argv) {
  const out = { base: 'http://localhost:3000', concurrency: 8 };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'base') out.base = value;
    if (key === 'concurrency') out.concurrency = Number(value);
  }
  if (!out.base || !Number.isFinite(out.concurrency) || out.concurrency < 1) {
    throw new Error(`invalid args: --base=${out.base} --concurrency=${out.concurrency}`);
  }
  return out;
}

async function fetchOne(base, entry) {
  const url = new URL(entry.path, base).toString();
  try {
    const res = await fetch(url, { method: entry.method, redirect: 'manual' });
    return { ...entry, status: res.status };
  } catch (err) {
    return { ...entry, status: 0, error: String(err?.message ?? err) };
  }
}

/** Simple fixed-size worker pool — no new dependency for ~8-way concurrency. */
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

function printFailures(label, rows) {
  if (rows.length === 0) return;
  console.log(`-- ${label} --`);
  for (const r of rows) {
    const detail = r.error ? `  (${r.error})` : '';
    console.log(`  ${String(r.status).padStart(3)}  ${r.method.padEnd(4)}  ${r.path}${detail}`);
  }
  console.log('');
}

async function main() {
  const { base, concurrency } = parseArgs(process.argv.slice(2));
  const inventory = buildRouteInventory();

  const results200 = await runPool(inventory.expect200, concurrency, (e) => fetchOne(base, e));
  const results404 = await runPool(inventory.expect404, concurrency, (e) => fetchOne(base, e));

  const fails200 = results200.filter((r) => r.status !== 200);
  const fails404 = results404.filter((r) => r.status !== 404);

  console.log('=== Release gate summary ===');
  console.log(`base:            ${base}`);
  console.log(`concurrency:     ${concurrency}`);
  console.log(`expect200 total: ${results200.length}   fail: ${fails200.length}`);
  console.log(`expect404 total: ${results404.length}   fail: ${fails404.length}`);
  console.log('');
  printFailures('expect200 failures (wanted 200)', fails200);
  printFailures('expect404 failures (wanted 404, should be blocked)', fails404);

  const gate200 = fails200.length > 0 ? 1 : 0;
  const gate404 = fails404.length > 0 ? 1 : 0;
  console.log(`gate_200=${gate200}`);
  console.log(`gate_404=${gate404}`);

  if (gate200 || gate404) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
