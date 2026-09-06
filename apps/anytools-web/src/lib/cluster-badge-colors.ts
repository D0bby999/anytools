import type { ClusterId } from '@anytools/tools/types';

// Typed exhaustively against ClusterId — adding a new cluster without an entry is a compile error.
//
// No border: the text carries legibility, not the container edge. Light-mode text is
// -800 over a /25 fill, which composites to 5.7-7.2:1 against the tint across every
// hue here (weakest is orange, 5.7:1) — comfortably past AA even at 11px uppercase
// with letter-spacing. The fill itself only needs to be perceptibly tinted, not
// high-contrast against the page: a border was tried and dropped as redundant once
// fill moved from /15 to /25 — the earlier /15 fill composited to roughly #FDE2E2
// over white, indistinguishable from paper without a border; /25 reads as a visible
// hue on its own.
export const CLUSTER_COLOR: Record<ClusterId, string> = {
  encoding: 'bg-blue-500/25 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  formatters: 'bg-purple-500/25 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300',
  generators: 'bg-green-500/25 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  converters: 'bg-orange-500/25 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
  'text-regex': 'bg-pink-500/25 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300',
  'time-date': 'bg-amber-500/25 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  web3: 'bg-indigo-500/25 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
  marketing: 'bg-teal-500/25 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300',
  'ecommerce-vn': 'bg-rose-500/25 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  // General-public clusters (Phase 3+) — match accent tokens in globals.css
  finance: 'bg-emerald-500/25 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  health: 'bg-rose-500/25 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  lifestyle: 'bg-amber-500/25 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  design: 'bg-violet-500/25 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  pdf: 'bg-red-500/25 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  image: 'bg-teal-500/25 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300',
};

/** Badge classes for a cluster chip. Unknown cluster ids fall back to the plain
 * `secondary` badge rather than throwing — tool metadata is the only source of
 * these strings, and a typo there should not blank out a page. */
export function clusterBadgeClass(cluster: string): string {
  return CLUSTER_COLOR[cluster as ClusterId] ?? '';
}
