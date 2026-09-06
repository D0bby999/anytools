import type { ClusterId } from '@anytools/tools/types';

// Chip system ported from gamenight's admin console (ui/web/app/components/admin/ui.tsx),
// whose `badge` cva pairs a near-white "soft" fill with a visible border in the same hue and
// dark, saturated text — Ant Design's status-tag formula. That console uses 5 semantic tones;
// this one needs 16 cluster IDENTITIES, so the token names differ but the ratio is copied
// exactly: a fill too pale to read as color on its own (bg-50, ~1.04-1.12:1 against a white
// card — by design, it is not the thing carrying legibility) made visible by a border one step
// darker (border-200), with text-700 doing the actual reading work at 4.79-7.07:1 against the
// fill (weakest hue is green, still clear of AA's 4.5:1). This replaced an earlier version that
// went straight to a saturated bg-{hue}-500/25 fill with no border, which the owner asked to
// simplify to "text carries it, border doesn't need to be bold" — this is that request folded
// into gamenight's actual system rather than a same-file trim: the border comes back, but at
// gamenight's weight (a thin 200-step ring), not the earlier 600/50 attempt's heavier one.
//
// Typography also follows gamenight's `text-xs font-medium leading-5` (a compact data tag)
// rather than the pill-badge default `text-xs font-semibold` this project's shared Badge
// component ships with — the cluster name renders in sentence case now, not uppercase with
// tracking, matching how gamenight renders its own status words ("done", "pending") plainly.
// `cn()` here goes through `tailwind-merge` (packages/ui/src/lib/cn.ts), so every utility below
// — including `rounded`, `px-1.5`, `py-px` — cleanly overrides the shared Badge's pill defaults
// when passed as `className` after `badgeVariants()`; no need to bypass the shared component.
const CHIP_BASE =
  'rounded border px-1.5 py-px text-xs font-medium normal-case tracking-normal leading-5';

export const CLUSTER_COLOR: Record<ClusterId, string> = {
  encoding: `${CHIP_BASE} bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-500/15 dark:border-blue-500/20 dark:text-blue-300`,
  formatters: `${CHIP_BASE} bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-500/15 dark:border-purple-500/20 dark:text-purple-300`,
  generators: `${CHIP_BASE} bg-green-50 border-green-200 text-green-700 dark:bg-green-500/15 dark:border-green-500/20 dark:text-green-300`,
  converters: `${CHIP_BASE} bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-500/15 dark:border-orange-500/20 dark:text-orange-300`,
  'text-regex': `${CHIP_BASE} bg-pink-50 border-pink-200 text-pink-700 dark:bg-pink-500/15 dark:border-pink-500/20 dark:text-pink-300`,
  'time-date': `${CHIP_BASE} bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/15 dark:border-amber-500/20 dark:text-amber-300`,
  web3: `${CHIP_BASE} bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/15 dark:border-indigo-500/20 dark:text-indigo-300`,
  marketing: `${CHIP_BASE} bg-teal-50 border-teal-200 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/20 dark:text-teal-300`,
  'ecommerce-vn': `${CHIP_BASE} bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:border-rose-500/20 dark:text-rose-300`,
  // General-public clusters (Phase 3+) — match accent tokens in globals.css
  finance: `${CHIP_BASE} bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/15 dark:border-emerald-500/20 dark:text-emerald-300`,
  health: `${CHIP_BASE} bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/15 dark:border-rose-500/20 dark:text-rose-300`,
  lifestyle: `${CHIP_BASE} bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/15 dark:border-amber-500/20 dark:text-amber-300`,
  design: `${CHIP_BASE} bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-500/15 dark:border-violet-500/20 dark:text-violet-300`,
  pdf: `${CHIP_BASE} bg-red-50 border-red-200 text-red-700 dark:bg-red-500/15 dark:border-red-500/20 dark:text-red-300`,
  image: `${CHIP_BASE} bg-teal-50 border-teal-200 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/20 dark:text-teal-300`,
};

/** Chip classes for a cluster badge. Unknown cluster ids fall back to the plain
 * `secondary` badge rather than throwing — tool metadata is the only source of
 * these strings, and a typo there should not blank out a page. */
export function clusterBadgeClass(cluster: string): string {
  return CLUSTER_COLOR[cluster as ClusterId] ?? '';
}
