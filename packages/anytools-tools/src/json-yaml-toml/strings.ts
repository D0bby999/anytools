import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'JSON ↔ YAML ↔ TOML',
  swap: '⇄ Swap',
  autoDetect: 'Auto-detect input',
  // {fmt} is the format name in upper case (JSON / YAML / TOML).
  pasteHere: 'Paste {fmt} here',
  // {path} is the dotted path of the null value, or (root).
  error_tomlNull:
    'TOML has no null value, and "{path}" is null. Remove the key or give it a value before converting.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'JSON ↔ YAML ↔ TOML',
    swap: '⇄ Đảo chiều',
    autoDetect: 'Tự nhận dạng đầu vào',
    pasteHere: 'Dán {fmt} vào đây',
    error_tomlNull:
      'TOML không có giá trị null, mà "{path}" đang là null. Hãy bỏ khóa đó hoặc gán giá trị trước khi chuyển đổi.',
  },
  es: {
    title: 'JSON ↔ YAML ↔ TOML',
    swap: '⇄ Intercambiar',
    autoDetect: 'Detectar formato de entrada',
    pasteHere: 'Pega {fmt} aquí',
    error_tomlNull:
      'TOML no tiene valor null, y "{path}" es null. Elimina la clave o asígnale un valor antes de convertir.',
  },
  pt: {
    title: 'JSON ↔ YAML ↔ TOML',
    swap: '⇄ Trocar',
    autoDetect: 'Detectar formato de entrada',
    pasteHere: 'Cole {fmt} aqui',
    error_tomlNull:
      'TOML não tem valor null, e "{path}" é null. Remova a chave ou dê um valor a ela antes de converter.',
  },
};
