import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'create-zip',
  cluster: 'converters',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: { en: 'Create ZIP', vi: 'Tạo File ZIP', es: 'Crear ZIP', pt: 'Criar ZIP' },
  description: {
    en: 'Bundle several files into one .zip, with a compression level you choose. Runs in your browser — nothing is uploaded.',
    vi: 'Gộp nhiều file thành một .zip, chọn mức nén. Chạy trong trình duyệt, không tải file lên.',
    es: 'Agrupa varios archivos en un .zip, con el nivel de compresión que elijas. Se ejecuta en tu navegador.',
    pt: 'Junte vários arquivos num .zip, com o nível de compressão que escolher. Roda no navegador.',
  },
  keywords: [
    'create zip',
    'zip files online',
    'make a zip archive',
    'zip files without uploading',
    'compress files to zip',
    'zip multiple files in browser',
  ],
  priority: 'P1',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'unzip-archive',
      reason: {
        en: 'Open a zip, 7z, rar or tar instead',
        vi: 'Mở ngược lại zip, 7z, rar hay tar',
        es: 'Abrir un zip, 7z, rar o tar',
        pt: 'Abrir um zip, 7z, rar ou tar',
      },
    },
    {
      tool: 'compress-image',
      reason: {
        en: 'Shrink photos before zipping — zip barely compresses JPEGs',
        vi: 'Nén ảnh trước khi zip — zip gần như không nén được JPEG',
        es: 'Reduce las fotos antes de comprimir — zip apenas comprime JPEG',
        pt: 'Reduza as fotos antes de zipar — zip quase não comprime JPEG',
      },
    },
  ],
};
