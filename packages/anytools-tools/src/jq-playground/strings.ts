import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'jq Playground',
  jsonInput: 'JSON input',
  jsonPlaceholder: '{ "hello": "world", "items": [1, 2, 3] }',
  filter: 'jq filter',
  filterPlaceholder: '.',
  examples: 'Examples:',
  running: 'Running…',
  emptyOutput: '(no output — the filter produced nothing)',
  stderrLabel: 'jq also wrote to stderr:',
  // {n} the byte cap, already localized/formatted by the caller.
  footnote:
    'Re-runs automatically ~300ms after you stop typing. Runs in a Web Worker so a filter that never returns (e.g. an infinite recursive def) is stopped after 8s instead of freezing the tab. Input capped at {n} — everything stays in your browser, nothing is uploaded.',
  error_invalidQuery: '{detail}',
  error_timeout: '{detail}',
  error_unavailable: '{detail}',
  error_inputTooLarge: '{detail}',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Playground jq',
    jsonInput: 'JSON đầu vào',
    jsonPlaceholder: '{ "hello": "world", "items": [1, 2, 3] }',
    filter: 'Filter jq',
    filterPlaceholder: '.',
    examples: 'Ví dụ:',
    running: 'Đang chạy…',
    emptyOutput: '(không có kết quả — filter không trả về gì)',
    stderrLabel: 'jq cũng ghi ra stderr:',
    footnote:
      'Tự chạy lại khoảng 300ms sau khi bạn ngừng gõ. Chạy trong Web Worker nên filter không bao giờ dừng (vd. def đệ quy vô hạn) sẽ bị dừng sau 8 giây thay vì treo tab. Đầu vào giới hạn {n} — mọi thứ ở trong trình duyệt, không upload đi đâu.',
    error_invalidQuery: '{detail}',
    error_timeout: '{detail}',
    error_unavailable: '{detail}',
    error_inputTooLarge: '{detail}',
  },
  es: {
    title: 'Playground de jq',
    jsonInput: 'JSON de entrada',
    jsonPlaceholder: '{ "hello": "world", "items": [1, 2, 3] }',
    filter: 'Filtro jq',
    filterPlaceholder: '.',
    examples: 'Ejemplos:',
    running: 'Ejecutando…',
    emptyOutput: '(sin salida — el filtro no produjo nada)',
    stderrLabel: 'jq también escribió en stderr:',
    footnote:
      'Se vuelve a ejecutar ~300ms después de dejar de escribir. Corre en un Web Worker, así que un filtro que nunca termina (p. ej. un def recursivo infinito) se detiene tras 8s en vez de congelar la pestaña. Entrada limitada a {n} — todo queda en tu navegador, nada se sube.',
    error_invalidQuery: '{detail}',
    error_timeout: '{detail}',
    error_unavailable: '{detail}',
    error_inputTooLarge: '{detail}',
  },
  pt: {
    title: 'Playground de jq',
    jsonInput: 'JSON de entrada',
    jsonPlaceholder: '{ "hello": "world", "items": [1, 2, 3] }',
    filter: 'Filtro jq',
    filterPlaceholder: '.',
    examples: 'Exemplos:',
    running: 'Executando…',
    emptyOutput: '(sem saída — o filtro não produziu nada)',
    stderrLabel: 'o jq também escreveu no stderr:',
    footnote:
      'Roda de novo automaticamente ~300ms depois que você para de digitar. Roda num Web Worker, então um filtro que nunca termina (ex.: um def recursivo infinito) é parado após 8s em vez de travar a aba. Entrada limitada a {n} — tudo fica no seu navegador, nada é enviado.',
    error_invalidQuery: '{detail}',
    error_timeout: '{detail}',
    error_unavailable: '{detail}',
    error_inputTooLarge: '{detail}',
  },
};
