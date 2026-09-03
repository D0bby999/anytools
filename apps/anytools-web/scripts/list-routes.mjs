#!/usr/bin/env node
/**
 * Print the self-host route inventory (see scripts/lib/route-inventory.mjs for how
 * it's built and why it does not read /sitemap.xml).
 *
 * Usage:
 *   node scripts/list-routes.mjs                  → full JSON (routes + counts)
 *   node scripts/list-routes.mjs --format=text     → one path per line (expect200 only,
 *                                                     for quick `wc -l` / `grep -c` checks)
 *   node scripts/list-routes.mjs --format=text --which=404   → the 10 blocked paths
 */
import { buildRouteInventory } from './lib/route-inventory.mjs';

function parseArgs(argv) {
  const out = { format: 'json', which: '200' };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'format') out.format = value;
    if (key === 'which') out.which = value;
  }
  return out;
}

function main() {
  const { format, which } = parseArgs(process.argv.slice(2));
  const inventory = buildRouteInventory();

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    return;
  }

  if (format === 'text') {
    const rows = which === '404' ? inventory.expect404 : inventory.expect200;
    for (const r of rows) {
      // Text mode is consumed by `wc -l`/`grep -c` shell one-liners — GET is the
      // overwhelmingly common case, so only prefix the method when it isn't GET.
      process.stdout.write(r.method === 'GET' ? `${r.path}\n` : `${r.method} ${r.path}\n`);
    }
    return;
  }

  console.error(`Unknown --format=${format} (use "json" or "text")`);
  process.exitCode = 1;
}

main();
