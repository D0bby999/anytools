import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'jq-playground',
  cluster: 'formatters',
  title: {
    en: 'jq Playground',
    vi: 'Playground jq',
    es: 'Playground de jq',
    pt: 'Playground de jq',
  },
  description: {
    en: 'Run jq filters against JSON right in the tab, with clickable examples for select/map/group_by/to_entries. Browser-only.',
    vi: 'Chạy filter jq trên JSON ngay trong tab, có ví dụ bấm-là-chạy cho select/map/group_by/to_entries. Chỉ trong browser.',
    es: 'Ejecuta filtros jq sobre JSON en la pestaña, con ejemplos listos para probar de select/map/group_by/to_entries. Solo en el navegador.',
    pt: 'Execute filtros jq sobre JSON direto na aba, com exemplos prontos de select/map/group_by/to_entries. Só no navegador.',
  },
  keywords: [
    'jq',
    'jq playground',
    'jq online',
    'json filter',
    'jq query',
    'jq tester',
    'jq trực tuyến',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'json-formatter',
      reason: {
        en: "Pretty-print jq's output as standalone JSON",
        vi: 'Format lại kết quả jq thành JSON độc lập',
      },
    },
    {
      tool: 'json-diff',
      reason: {
        en: 'Compare jq output before/after tweaking a filter',
        vi: 'So sánh kết quả jq trước/sau khi sửa filter',
      },
    },
    {
      tool: 'json-yaml-toml',
      reason: {
        en: "Convert jq's JSON output to YAML or TOML",
        vi: 'Chuyển kết quả JSON của jq sang YAML hoặc TOML',
      },
    },
  ],
};
