import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'JSON ↔ YAML ↔ TOML',
  swap: '⇄ Swap',
  autoDetect: 'Auto-detect input',
  // {fmt} is the format name in upper case (JSON / YAML / TOML).
  pasteHere: 'Paste {fmt} here',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'JSON ↔ YAML ↔ TOML',
    swap: '⇄ Đảo chiều',
    autoDetect: 'Tự nhận dạng đầu vào',
    pasteHere: 'Dán {fmt} vào đây',
  },
  es: {
    title: 'JSON ↔ YAML ↔ TOML',
    swap: '⇄ Intercambiar',
    autoDetect: 'Detectar formato de entrada',
    pasteHere: 'Pega {fmt} aquí',
  },
  pt: {
    title: 'JSON ↔ YAML ↔ TOML',
    swap: '⇄ Trocar',
    autoDetect: 'Detectar formato de entrada',
    pasteHere: 'Cole {fmt} aqui',
  },
};
