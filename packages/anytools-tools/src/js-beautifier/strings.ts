import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'JavaScript Beautifier / Minifier',
  minifyTerser: 'Minify (Terser)',
  mangleNames: 'Mangle names',
  sizeNote: '{before} → {after} bytes ({pct}% smaller)',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Làm đẹp / Rút gọn JavaScript',
    minifyTerser: 'Rút gọn (Terser)',
    mangleNames: 'Rút gọn tên biến',
    sizeNote: '{before} → {after} byte (nhỏ hơn {pct}%)',
  },
  es: {
    title: 'Embellecedor / Minificador JavaScript',
    minifyTerser: 'Minificar (Terser)',
    mangleNames: 'Ofuscar nombres',
    sizeNote: '{before} → {after} bytes ({pct}% más pequeño)',
  },
  pt: {
    title: 'Embelezador / Minificador JavaScript',
    minifyTerser: 'Minificar (Terser)',
    mangleNames: 'Encurtar nomes',
    sizeNote: '{before} → {after} bytes ({pct}% menor)',
  },
};
