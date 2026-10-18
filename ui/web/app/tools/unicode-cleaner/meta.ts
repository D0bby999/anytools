import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'unicode-cleaner',
  cluster: 'text-regex',
  title: {
    en: 'Unicode Cleaner',
    vi: 'Dọn ký tự Unicode ẩn',
    es: 'Limpiador de Unicode oculto',
    pt: 'Limpador de Unicode oculto',
  },
  description: {
    en: 'Find invisible characters and Latin-lookalike letters from other alphabets hiding in pasted text, then clean them. Runs in your browser.',
    vi: 'Tìm ký tự vô hình và chữ cái nhìn giống Latin nhưng thuộc bảng chữ cái khác lẫn trong văn bản dán vào, rồi làm sạch. Chạy trong trình duyệt.',
    es: 'Encuentra caracteres invisibles y letras de otros alfabetos que se parecen al latín escondidas en el texto pegado, y límpialas. Se ejecuta en tu navegador.',
    pt: 'Encontre caracteres invisíveis e letras de outros alfabetos parecidas com o latim escondidas no texto colado, e limpe-as. Roda no navegador.',
  },
  keywords: [
    'unicode cleaner',
    'invisible characters',
    'zero width space detector',
    'homoglyph checker',
    'cyrillic homoglyph',
    'remove hidden characters',
    'confusable characters',
    'text sanitizer',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'diff-checker',
      reason: {
        en: 'Compare cleaned text against the original to see exactly what changed',
        vi: 'So sánh văn bản đã dọn với bản gốc để thấy chính xác chỗ đã đổi',
        es: 'Compara el texto limpio con el original para ver qué cambió',
        pt: 'Compare o texto limpo com o original para ver o que mudou',
      },
    },
    {
      tool: 'text-case-converter',
      reason: {
        en: 'Normalize letter case once the hidden characters are gone',
        vi: 'Chuẩn hoá chữ hoa/thường sau khi đã dọn ký tự ẩn',
        es: 'Normaliza mayúsculas/minúsculas una vez limpio el texto',
        pt: 'Normalize maiúsculas/minúsculas depois de limpar o texto',
      },
    },
  ],
};
