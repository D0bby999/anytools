import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'yaml-formatter',
  cluster: 'formatters',
  title: { en: 'YAML Formatter / Validator', vi: 'Định dạng / Kiểm tra YAML' },
  description: {
    en: 'Format, validate, sort keys in YAML. Browser-only.',
    vi: 'Định dạng, validate, sort key trong YAML. Chỉ trong browser.',
  },
  keywords: ['yaml formatter', 'yaml validator', 'yaml pretty', 'yaml lint', 'k8s yaml'],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'json-yaml-toml',
      reason: { en: 'Convert YAML to JSON or TOML', vi: 'Convert YAML sang JSON hoặc TOML' },
    },
    { tool: 'json-formatter', reason: { en: 'Format the JSON output', vi: 'Format JSON output' } },
  ],
};
