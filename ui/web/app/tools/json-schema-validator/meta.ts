import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'json-schema-validator',
  cluster: 'formatters',
  title: {
    en: 'JSON Schema Validator',
    vi: 'Kiểm tra JSON theo Schema',
    es: 'Validador de esquema JSON',
    pt: 'Validador de esquema JSON',
  },
  description: {
    en: 'Validate JSON data against a JSON Schema (draft-07 or 2020-12) and see exactly which field failed. Or go the other way: infer a schema from one sample. Browser-only.',
    vi: 'Kiểm tra dữ liệu JSON theo JSON Schema (draft-07 hoặc 2020-12), báo đúng trường bị lỗi. Hoặc làm ngược lại: suy ra schema từ một mẫu JSON. Chỉ chạy trong trình duyệt.',
    es: 'Valida datos JSON contra un JSON Schema (draft-07 o 2020-12) y ve exactamente qué campo falló. O al revés: infiere un esquema a partir de una muestra. Solo en el navegador.',
    pt: 'Valide dados JSON contra um JSON Schema (draft-07 ou 2020-12) e veja exatamente qual campo falhou. Ou o caminho inverso: infira um esquema a partir de uma amostra. Só no navegador.',
  },
  keywords: [
    'json schema validator',
    'validate json against schema',
    'json schema draft-07',
    'json schema 2020-12',
    'infer json schema',
    'generate schema from json',
    'ajv online',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'json-formatter',
      reason: {
        en: 'Format or fix syntax before validating shape',
        vi: 'Định dạng hoặc sửa cú pháp trước khi kiểm tra cấu trúc',
        es: 'Formatea o corrige la sintaxis antes de validar la forma',
        pt: 'Formate ou corrija a sintaxe antes de validar a forma',
      },
    },
    {
      tool: 'json-diff',
      reason: {
        en: 'Compare two JSON documents field by field',
        vi: 'So sánh hai tài liệu JSON theo từng trường',
        es: 'Compara dos documentos JSON campo por campo',
        pt: 'Compare dois documentos JSON campo por campo',
      },
    },
  ],
};
