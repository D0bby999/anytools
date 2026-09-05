import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'JSON Formatter / Validator',
  jsonInput: 'JSON input',
  outputPlaceholder: 'Valid JSON output will appear here…',
  sortKeysDeep: 'Sort keys (deep)',
  json5Option: 'JSON5 (comments, trailing commas)',
  lineCol: 'Line {line}, col {col}: ',
  json5Hint: 'This is valid JSON5 — enable the JSON5 option to format it.',
  unsafeWarning: 'Integers above 2^53 were rounded (JavaScript number limit): {list}',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Định dạng / Kiểm tra JSON',
    jsonInput: 'Đầu vào JSON',
    outputPlaceholder: 'JSON hợp lệ sẽ hiện ở đây…',
    sortKeysDeep: 'Sắp xếp khóa (mọi cấp)',
    json5Option: 'JSON5 (comment, dấu phẩy cuối)',
    lineCol: 'Dòng {line}, cột {col}: ',
    json5Hint: 'Đây là JSON5 hợp lệ — bật tùy chọn JSON5 để định dạng.',
    unsafeWarning: 'Số nguyên lớn hơn 2^53 đã bị làm tròn (giới hạn số của JavaScript): {list}',
  },
  es: {
    title: 'Formateador / Validador JSON',
    jsonInput: 'Entrada JSON',
    outputPlaceholder: 'El JSON válido aparecerá aquí…',
    sortKeysDeep: 'Ordenar claves (recursivo)',
    json5Option: 'JSON5 (comentarios, comas finales)',
    lineCol: 'Línea {line}, col {col}: ',
    json5Hint: 'Es JSON5 válido: activa la opción JSON5 para formatearlo.',
    unsafeWarning:
      'Los enteros mayores que 2^53 se redondearon (límite numérico de JavaScript): {list}',
  },
  pt: {
    title: 'Formatador / Validador JSON',
    jsonInput: 'Entrada JSON',
    outputPlaceholder: 'O JSON válido aparecerá aqui…',
    sortKeysDeep: 'Ordenar chaves (recursivo)',
    json5Option: 'JSON5 (comentários, vírgulas finais)',
    lineCol: 'Linha {line}, col {col}: ',
    json5Hint: 'É JSON5 válido — ative a opção JSON5 para formatá-lo.',
    unsafeWarning:
      'Inteiros acima de 2^53 foram arredondados (limite numérico do JavaScript): {list}',
  },
};
