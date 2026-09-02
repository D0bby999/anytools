import { toolMetas } from '@anytools/tools/meta';
import type { ClusterId } from '@anytools/tools/types';

/**
 * Central cluster metadata for landing pages + nav rendering.
 * Single source of truth for cluster-level visual + content fields.
 * Tagline + intro text live in i18n (clusterLanding.{id}.*).
 */
export type ClusterConfig = {
  // Tailwind ring/border accent class — matches CSS var in globals.css
  ringClass: string;
  // Tailwind bg class for hero gradient — soft tint
  bgClass: string;
  // Whether to surface this cluster on the cluster-overview / nav dropdown
  // (existing 7 dev clusters always on; new general-public default on once Phase 3 ships)
  surfaceOnNav: boolean;
};

export const CLUSTER_CONFIG: Record<ClusterId, ClusterConfig> = {
  encoding: {
    ringClass: 'ring-blue-500/30',
    bgClass: 'bg-blue-500/5',
    surfaceOnNav: true,
  },
  formatters: {
    ringClass: 'ring-purple-500/30',
    bgClass: 'bg-purple-500/5',
    surfaceOnNav: true,
  },
  generators: {
    ringClass: 'ring-green-500/30',
    bgClass: 'bg-green-500/5',
    surfaceOnNav: true,
  },
  converters: {
    ringClass: 'ring-orange-500/30',
    bgClass: 'bg-orange-500/5',
    surfaceOnNav: true,
  },
  'text-regex': {
    ringClass: 'ring-pink-500/30',
    bgClass: 'bg-pink-500/5',
    surfaceOnNav: true,
  },
  'time-date': {
    ringClass: 'ring-amber-500/30',
    bgClass: 'bg-amber-500/5',
    surfaceOnNav: true,
  },
  web3: {
    ringClass: 'ring-indigo-500/30',
    bgClass: 'bg-indigo-500/5',
    surfaceOnNav: true,
  },
  marketing: {
    ringClass: 'ring-teal-500/30',
    bgClass: 'bg-teal-500/5',
    surfaceOnNav: true,
  },
  'ecommerce-vn': {
    ringClass: 'ring-rose-500/30',
    bgClass: 'bg-rose-500/5',
    surfaceOnNav: true,
  },
  // General-public clusters (Phase 3+)
  finance: {
    ringClass: 'ring-emerald-500/30',
    bgClass: 'bg-emerald-500/5',
    surfaceOnNav: true,
  },
  health: {
    ringClass: 'ring-rose-500/30',
    bgClass: 'bg-rose-500/5',
    surfaceOnNav: true,
  },
  lifestyle: {
    ringClass: 'ring-amber-500/30',
    bgClass: 'bg-amber-500/5',
    surfaceOnNav: true,
  },
  design: {
    ringClass: 'ring-violet-500/30',
    bgClass: 'bg-violet-500/5',
    surfaceOnNav: true,
  },
  pdf: {
    ringClass: 'ring-red-500/30',
    bgClass: 'bg-red-500/5',
    surfaceOnNav: true,
  },
  image: {
    ringClass: 'ring-teal-500/30',
    bgClass: 'bg-teal-500/5',
    surfaceOnNav: true,
  },
};

export const ALL_CLUSTERS: ClusterId[] = Object.keys(CLUSTER_CONFIG) as ClusterId[];

export function isClusterId(s: string): s is ClusterId {
  return Object.prototype.hasOwnProperty.call(CLUSTER_CONFIG, s);
}

/**
 * Clusters that actually have at least one published tool.
 *
 * Derived from the tool registry rather than listed by hand: a cluster with no
 * tools renders a landing page with nothing to click, which reads as thin content
 * to search and ad review alike. Deriving it means an empty cluster can never be
 * crawled by accident, and a cluster rejoins the sitemap the moment its first
 * tool ships — no list to remember to update.
 */
export const POPULATED_CLUSTERS: ClusterId[] = ALL_CLUSTERS.filter((cluster) =>
  toolMetas.some((m) => m.cluster === cluster && m.published !== false),
);

export function isPopulatedCluster(s: string): s is ClusterId {
  return (POPULATED_CLUSTERS as string[]).includes(s);
}
