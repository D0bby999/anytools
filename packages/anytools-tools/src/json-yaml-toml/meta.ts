import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'json-yaml-toml',
  cluster: 'converters',
  title: {
    en: 'JSON ↔ YAML ↔ TOML Converter',
    vi: 'Chuyển đổi JSON ↔ YAML ↔ TOML',
    es: 'Conversor JSON ↔ YAML ↔ TOML',
    pt: 'Conversor JSON ↔ YAML ↔ TOML',
  },
  description: {
    en: 'Convert between JSON, YAML, and TOML. Auto-detect input format. Browser-only.',
    vi: 'Chuyển đổi giữa JSON, YAML, TOML. Tự nhận diện format input. Chỉ trong browser.',
    es: 'Convierte entre JSON, YAML y TOML. Detecta el formato de entrada automáticamente. Solo en el navegador.',
    pt: 'Converte entre JSON, YAML e TOML. Detecta o formato de entrada automaticamente. Só no navegador.',
  },
  keywords: [
    'json yaml toml',
    'config converter',
    'yaml to json',
    'toml to yaml',
    'config formats',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    { tool: 'json-formatter', reason: { en: 'Format the JSON output', vi: 'Format JSON output' } },
    { tool: 'yaml-formatter', reason: { en: 'Format the YAML output', vi: 'Format YAML output' } },
  ],
};
