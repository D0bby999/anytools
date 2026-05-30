import type { ClusterId } from '@anytools/tools/types';
import type { LucideIcon } from 'lucide-react';
import {
  Binary,
  Braces,
  Calculator,
  Code2,
  Globe,
  HeartPulse,
  Hexagon,
  Key,
  Palette,
  Regex,
  ShoppingBag,
  Sparkles,
  Wallet,
} from 'lucide-react';

/**
 * Per-cluster Lucide icon mapping. Used in nav, catalog chips, and tool cards.
 * 4 new general-public clusters added below the original 9 dev clusters.
 */
export const CLUSTER_ICON: Record<ClusterId, LucideIcon> = {
  encoding: Key,
  formatters: Braces,
  generators: Hexagon,
  converters: Binary,
  'text-regex': Regex,
  'time-date': Globe,
  web3: Wallet,
  marketing: Code2,
  'ecommerce-vn': ShoppingBag,
  // General-public clusters (Phase 3+)
  finance: Calculator,
  health: HeartPulse,
  lifestyle: Sparkles,
  design: Palette,
};
