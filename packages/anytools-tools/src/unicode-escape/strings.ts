import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Unicode Escape / Unescape',
  escapeTab: 'Text → \\uXXXX',
  unescapeTab: '\\uXXXX → Text',
  mode: 'Mode',
  modeJson: 'JSON (surrogate pairs, escape non-ASCII)',
  modeEs6: 'ES6 (\\u{XXXXX} for astral)',
  modeAll: 'All (escape ASCII too)',
  uppercaseHex: 'Uppercase hex',
  typeText: 'Type text with emoji or non-ASCII...',
  pasteEscapes: 'Paste \\uXXXX or \\u{XXXXX} escapes',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Escape / Unescape Unicode',
    escapeTab: 'Văn bản → \\uXXXX',
    unescapeTab: '\\uXXXX → Văn bản',
    mode: 'Chế độ',
    modeJson: 'JSON (cặp surrogate, escape ký tự ngoài ASCII)',
    modeEs6: 'ES6 (\\u{XXXXX} cho ký tự astral)',
    modeAll: 'Tất cả (escape cả ASCII)',
    uppercaseHex: 'Hex chữ hoa',
    typeText: 'Nhập văn bản có emoji hoặc ký tự ngoài ASCII...',
    pasteEscapes: 'Dán chuỗi escape \\uXXXX hoặc \\u{XXXXX}',
  },
  es: {
    title: 'Escapar / Desescapar Unicode',
    escapeTab: 'Texto → \\uXXXX',
    unescapeTab: '\\uXXXX → Texto',
    mode: 'Modo',
    modeJson: 'JSON (pares sustitutos, escapa no-ASCII)',
    modeEs6: 'ES6 (\\u{XXXXX} para astrales)',
    modeAll: 'Todo (escapa también ASCII)',
    uppercaseHex: 'Hex en mayúsculas',
    typeText: 'Escribe texto con emoji o caracteres no ASCII...',
    pasteEscapes: 'Pega escapes \\uXXXX o \\u{XXXXX}',
  },
  pt: {
    title: 'Escapar / Desescapar Unicode',
    escapeTab: 'Texto → \\uXXXX',
    unescapeTab: '\\uXXXX → Texto',
    mode: 'Modo',
    modeJson: 'JSON (pares substitutos, escapa não-ASCII)',
    modeEs6: 'ES6 (\\u{XXXXX} para astrais)',
    modeAll: 'Tudo (escapa ASCII também)',
    uppercaseHex: 'Hex em maiúsculas',
    typeText: 'Digite texto com emoji ou caracteres não ASCII...',
    pasteEscapes: 'Cole escapes \\uXXXX ou \\u{XXXXX}',
  },
};
