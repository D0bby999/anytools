import type { ClusterId } from '@anytools/tools/types';

/**
 * Curated "popular" tool list shown when user has no localStorage history.
 * Mixes Tier-1 general-public picks (BMI, Tip, Color) with proven dev favorites
 * (JSON, UUID, Regex) so the soft-pivot brand reads well to both audiences.
 *
 * Keep ~8 slugs — fills 2 grid rows on desktop, 4 on mobile.
 */
export const POPULAR_FALLBACK: Array<{ cluster: ClusterId; slug: string }> = [
  { cluster: 'health', slug: 'bmi-calculator' },
  { cluster: 'finance', slug: 'tip-calculator' },
  { cluster: 'formatters', slug: 'json-formatter' },
  { cluster: 'design', slug: 'color-converter' },
  { cluster: 'lifestyle', slug: 'unit-converter' },
  { cluster: 'generators', slug: 'qr-code-generator' },
  { cluster: 'generators', slug: 'password-generator' },
  { cluster: 'encoding', slug: 'base64-encode' },
];
