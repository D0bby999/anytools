import type { ComponentType } from 'react';

export type LocalizedText = Record<string, string>;

export type ClusterId =
  | 'encoding'
  | 'formatters'
  | 'generators'
  | 'converters'
  | 'text-regex'
  | 'time-date'
  | 'web3'
  | 'marketing'
  | 'ecommerce-vn'
  | 'finance'
  | 'health'
  | 'lifestyle'
  | 'design';

export type ToolPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type ToolEffort = 'S' | 'M' | 'L';

export type SupportedLocale = 'en' | 'vi' | 'es' | 'pt';

export type NextStepSuggestion = {
  tool: string;
  reason: LocalizedText;
};

export type ToolMeta = {
  slug: string;
  cluster: ClusterId;
  title: LocalizedText;
  description: LocalizedText;
  keywords: string[];
  priority: ToolPriority;
  effort: ToolEffort;
  isPremium?: boolean;
  nextStepSuggestions?: NextStepSuggestion[];
  // When set, generateStaticParams renders only these locales (others 404).
  // Use for tools with locale-specific logic (e.g. US-only tax brackets).
  availableLocales?: readonly SupportedLocale[];
  // Dark-launch flag. Tools with published=false are excluded from sitemap
  // and tool catalog until translations land. Defaults to true (existing tools).
  published?: boolean;
};

export type Tool = {
  meta: ToolMeta;
  Component: ComponentType;
};
