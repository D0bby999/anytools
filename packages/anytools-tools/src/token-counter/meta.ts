import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'token-counter',
  cluster: 'text-regex',
  title: {
    en: 'Token Counter',
    vi: 'Đếm Token',
    es: 'Contador de tokens',
    pt: 'Contador de tokens',
  },
  description: {
    en: 'Count OpenAI tokens (o200k_base or cl100k_base) plus characters and words for any pasted text. Runs entirely in your browser.',
    vi: 'Đếm token OpenAI (o200k_base hoặc cl100k_base), cùng số ký tự và số từ cho văn bản dán vào. Chạy hoàn toàn trong trình duyệt.',
    es: 'Cuenta tokens de OpenAI (o200k_base o cl100k_base), además de caracteres y palabras, para cualquier texto pegado. Se ejecuta enteramente en tu navegador.',
    pt: 'Conte tokens da OpenAI (o200k_base ou cl100k_base), além de caracteres e palavras, para qualquer texto colado. Roda inteiramente no navegador.',
  },
  keywords: [
    'token counter',
    'openai token counter',
    'gpt token count',
    'tiktoken online',
    'cl100k_base',
    'o200k_base',
    'llm token estimator',
    'chatgpt token count',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'word-counter',
      reason: {
        en: 'Plain character and word counts without loading a tokenizer',
        vi: 'Đếm ký tự và từ đơn giản, không cần tải bộ mã hoá',
        es: 'Conteo simple de caracteres y palabras sin cargar un tokenizador',
        pt: 'Contagem simples de caracteres e palavras sem carregar um tokenizador',
      },
    },
    {
      tool: 'unicode-cleaner',
      reason: {
        en: 'Strip invisible characters before counting — they inflate the token count too',
        vi: 'Dọn ký tự vô hình trước khi đếm — chúng cũng làm tăng số token',
        es: 'Elimina caracteres invisibles antes de contar — también inflan el número de tokens',
        pt: 'Remova caracteres invisíveis antes de contar — eles também inflam a contagem de tokens',
      },
    },
  ],
};
