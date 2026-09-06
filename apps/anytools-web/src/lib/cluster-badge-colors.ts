import type { ClusterId } from '@anytools/tools/types';

// Typed exhaustively against ClusterId — adding a new cluster without an entry is a compile error.
//
// Light-mode text is -800, not -700. Measured against the composited pill background
// (the 500 tint over a white card), -700 bottomed out at 4.60:1 for green — technically
// AA, but this label renders at 11px in uppercase with letter-spacing, where the AA
// threshold for normal body text is not enough to be comfortable. -800 over the /25
// light-mode tint still leaves the weakest colour (green) at 5.7:1.
//
// Light mode fills at /25 and carries a hue-matched hairline border; dark keeps the
// original /15 with a much fainter border. The asymmetry is the point: a 15% tint of
// a 500 over a WHITE card composites to roughly #FDE2E2, about 1.1:1 against the card
// it sits on, so the chip had no edge and stopped reading as an object at all. The
// same tint over the slate-800 dark card is a clearly visible lighter patch, which is
// why the problem only ever showed in light mode. The border does most of the work;
// the extra fill only stops the interior reading as paper white.
export const CLUSTER_COLOR: Record<ClusterId, string> = {
  encoding:
    'bg-blue-500/25 border-blue-600/50 text-blue-800 dark:bg-blue-500/15 dark:border-blue-300/20 dark:text-blue-300',
  formatters:
    'bg-purple-500/25 border-purple-600/50 text-purple-800 dark:bg-purple-500/15 dark:border-purple-300/20 dark:text-purple-300',
  generators:
    'bg-green-500/25 border-green-600/50 text-green-800 dark:bg-green-500/15 dark:border-green-300/20 dark:text-green-300',
  converters:
    'bg-orange-500/25 border-orange-600/50 text-orange-800 dark:bg-orange-500/15 dark:border-orange-300/20 dark:text-orange-300',
  'text-regex':
    'bg-pink-500/25 border-pink-600/50 text-pink-800 dark:bg-pink-500/15 dark:border-pink-300/20 dark:text-pink-300',
  'time-date':
    'bg-amber-500/25 border-amber-600/50 text-amber-800 dark:bg-amber-500/15 dark:border-amber-300/20 dark:text-amber-300',
  web3: 'bg-indigo-500/25 border-indigo-600/50 text-indigo-800 dark:bg-indigo-500/15 dark:border-indigo-300/20 dark:text-indigo-300',
  marketing:
    'bg-teal-500/25 border-teal-600/50 text-teal-800 dark:bg-teal-500/15 dark:border-teal-300/20 dark:text-teal-300',
  'ecommerce-vn':
    'bg-rose-500/25 border-rose-600/50 text-rose-800 dark:bg-rose-500/15 dark:border-rose-300/20 dark:text-rose-300',
  // General-public clusters (Phase 3+) — match accent tokens in globals.css
  finance:
    'bg-emerald-500/25 border-emerald-600/50 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-300/20 dark:text-emerald-300',
  health:
    'bg-rose-500/25 border-rose-600/50 text-rose-800 dark:bg-rose-500/15 dark:border-rose-300/20 dark:text-rose-300',
  lifestyle:
    'bg-amber-500/25 border-amber-600/50 text-amber-800 dark:bg-amber-500/15 dark:border-amber-300/20 dark:text-amber-300',
  design:
    'bg-violet-500/25 border-violet-600/50 text-violet-800 dark:bg-violet-500/15 dark:border-violet-300/20 dark:text-violet-300',
  pdf: 'bg-red-500/25 border-red-600/50 text-red-800 dark:bg-red-500/15 dark:border-red-300/20 dark:text-red-300',
  image:
    'bg-teal-500/25 border-teal-600/50 text-teal-800 dark:bg-teal-500/15 dark:border-teal-300/20 dark:text-teal-300',
};

/** Badge classes for a cluster chip. Unknown cluster ids fall back to the plain
 * `secondary` badge rather than throwing — tool metadata is the only source of
 * these strings, and a typo there should not blank out a page. */
export function clusterBadgeClass(cluster: string): string {
  return CLUSTER_COLOR[cluster as ClusterId] ?? '';
}
