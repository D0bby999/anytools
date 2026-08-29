'use client';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

type ToolModule = { default: { Component: ComponentType } };
const pick = <T extends ToolModule>(m: T) => ({ default: m.default.Component });

const LOADERS: Record<string, ComponentType> = {
  'base64-encode': dynamic(() => import('@anytools/tools/base64-encode').then(pick)),
  'url-encode': dynamic(() => import('@anytools/tools/url-encode').then(pick)),
  'jwt-decoder': dynamic(() => import('@anytools/tools/jwt-decoder').then(pick)),
  'uuid-generator': dynamic(() => import('@anytools/tools/uuid-generator').then(pick)),
  'hash-generator': dynamic(() => import('@anytools/tools/hash-generator').then(pick)),
  'password-generator': dynamic(() => import('@anytools/tools/password-generator').then(pick)),
  'timestamp-converter': dynamic(() => import('@anytools/tools/timestamp-converter').then(pick)),
  'json-formatter': dynamic(() => import('@anytools/tools/json-formatter').then(pick)),
  'sql-formatter': dynamic(() => import('@anytools/tools/sql-formatter').then(pick)),
  'regex-tester': dynamic(() => import('@anytools/tools/regex-tester').then(pick)),
  'text-case-converter': dynamic(() => import('@anytools/tools/text-case-converter').then(pick)),
  slugify: dynamic(() => import('@anytools/tools/slugify').then(pick)),
  'html-entity': dynamic(() => import('@anytools/tools/html-entity').then(pick)),
  'mock-data-generator': dynamic(() => import('@anytools/tools/mock-data-generator').then(pick)),
  'json-yaml-toml': dynamic(() => import('@anytools/tools/json-yaml-toml').then(pick)),
  'csv-json': dynamic(() => import('@anytools/tools/csv-json').then(pick)),
  'md-html': dynamic(() => import('@anytools/tools/md-html').then(pick)),
  'diff-checker': dynamic(() => import('@anytools/tools/diff-checker').then(pick)),
  'curl-converter': dynamic(() => import('@anytools/tools/curl-converter').then(pick)),
  'cron-parser': dynamic(() => import('@anytools/tools/cron-parser').then(pick)),
  'timezone-converter': dynamic(() => import('@anytools/tools/timezone-converter').then(pick)),
  'xml-formatter': dynamic(() => import('@anytools/tools/xml-formatter').then(pick)),
  'yaml-formatter': dynamic(() => import('@anytools/tools/yaml-formatter').then(pick)),
  'wallet-checker': dynamic(() => import('@anytools/tools/wallet-checker').then(pick)),
  'eth-wei-converter': dynamic(() => import('@anytools/tools/eth-wei-converter').then(pick)),
  'qr-code-generator': dynamic(() => import('@anytools/tools/qr-code-generator').then(pick)),
  'lorem-ipsum-generator': dynamic(() =>
    import('@anytools/tools/lorem-ipsum-generator').then(pick),
  ),
  'html-beautifier': dynamic(() => import('@anytools/tools/html-beautifier').then(pick)),
  'css-beautifier': dynamic(() => import('@anytools/tools/css-beautifier').then(pick)),
  'js-beautifier': dynamic(() => import('@anytools/tools/js-beautifier').then(pick)),
  'hex-encode': dynamic(() => import('@anytools/tools/hex-encode').then(pick)),
  'binary-encode': dynamic(() => import('@anytools/tools/binary-encode').then(pick)),
  'unicode-escape': dynamic(() => import('@anytools/tools/unicode-escape').then(pick)),
  'image-format-converter': dynamic(() =>
    import('@anytools/tools/image-format-converter').then(pick),
  ),
  // Phase 3 — Tier-1 general-public MVP
  'bmi-calculator': dynamic(() => import('@anytools/tools/bmi-calculator').then(pick)),
  'tip-calculator': dynamic(() => import('@anytools/tools/tip-calculator').then(pick)),
  'age-calculator': dynamic(() => import('@anytools/tools/age-calculator').then(pick)),
  'percentage-calculator': dynamic(() =>
    import('@anytools/tools/percentage-calculator').then(pick),
  ),
  'gpa-calculator': dynamic(() => import('@anytools/tools/gpa-calculator').then(pick)),
  'compound-interest': dynamic(() => import('@anytools/tools/compound-interest').then(pick)),
  'color-converter': dynamic(() => import('@anytools/tools/color-converter').then(pick)),
  'unit-converter': dynamic(() => import('@anytools/tools/unit-converter').then(pick)),
  // Phase 5 — Tier-2 expansion
  'bmr-calculator': dynamic(() => import('@anytools/tools/bmr-calculator').then(pick)),
  'calorie-calculator': dynamic(() => import('@anytools/tools/calorie-calculator').then(pick)),
  'body-fat-calculator': dynamic(() => import('@anytools/tools/body-fat-calculator').then(pick)),
  'pace-calculator': dynamic(() => import('@anytools/tools/pace-calculator').then(pick)),
  'date-diff': dynamic(() => import('@anytools/tools/date-diff').then(pick)),
  'discount-calculator': dynamic(() => import('@anytools/tools/discount-calculator').then(pick)),
  'sleep-calculator': dynamic(() => import('@anytools/tools/sleep-calculator').then(pick)),
  'word-counter': dynamic(() => import('@anytools/tools/word-counter').then(pick)),
  'reading-time': dynamic(() => import('@anytools/tools/reading-time').then(pick)),
  'random-picker': dynamic(() => import('@anytools/tools/random-picker').then(pick)),
  'mortgage-calculator': dynamic(() => import('@anytools/tools/mortgage-calculator').then(pick)),
  'loan-calculator': dynamic(() => import('@anytools/tools/loan-calculator').then(pick)),
  'scientific-calculator': dynamic(() =>
    import('@anytools/tools/scientific-calculator').then(pick),
  ),
  'statistics-calculator': dynamic(() =>
    import('@anytools/tools/statistics-calculator').then(pick),
  ),
  'color-palette': dynamic(() => import('@anytools/tools/color-palette').then(pick)),
  'currency-converter': dynamic(() => import('@anytools/tools/currency-converter').then(pick)),
  // Phase 6 — Tier-3 stretch
  'sales-tax-calculator': dynamic(() => import('@anytools/tools/sales-tax-calculator').then(pick)),
  'retirement-calculator': dynamic(() =>
    import('@anytools/tools/retirement-calculator').then(pick),
  ),
  'grade-calculator': dynamic(() => import('@anytools/tools/grade-calculator').then(pick)),
  'pregnancy-due-date': dynamic(() => import('@anytools/tools/pregnancy-due-date').then(pick)),
  'time-card-calculator': dynamic(() => import('@anytools/tools/time-card-calculator').then(pick)),
  'triangle-calculator': dynamic(() => import('@anytools/tools/triangle-calculator').then(pick)),
  'shoe-size-converter': dynamic(() => import('@anytools/tools/shoe-size-converter').then(pick)),
  'readability-analyzer': dynamic(() => import('@anytools/tools/readability-analyzer').then(pick)),
  'tip-to-hourly-wage': dynamic(() => import('@anytools/tools/tip-to-hourly-wage').then(pick)),
  'pomodoro-timer': dynamic(() => import('@anytools/tools/pomodoro-timer').then(pick)),
  // Dev quick-wins (260829)
  'wcag-contrast-checker': dynamic(() =>
    import('@anytools/tools/wcag-contrast-checker').then(pick),
  ),
  'ip-subnet-calculator': dynamic(() => import('@anytools/tools/ip-subnet-calculator').then(pick)),
  'crontab-generator': dynamic(() => import('@anytools/tools/crontab-generator').then(pick)),
  'json-diff': dynamic(() => import('@anytools/tools/json-diff').then(pick)),
  'chmod-calculator': dynamic(() => import('@anytools/tools/chmod-calculator').then(pick)),
  'bcrypt-generator': dynamic(() => import('@anytools/tools/bcrypt-generator').then(pick)),
  'totp-generator': dynamic(() => import('@anytools/tools/totp-generator').then(pick)),
  'http-status-codes': dynamic(() => import('@anytools/tools/http-status-codes').then(pick)),
};

export function DynamicToolRenderer({ slug }: { slug: string }) {
  const Component = LOADERS[slug];
  if (!Component) return null;
  return <Component />;
}
