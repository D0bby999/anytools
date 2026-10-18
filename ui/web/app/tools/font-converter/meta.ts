import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'font-converter',
  cluster: 'converters',
  title: {
    en: 'Font Converter',
    vi: 'Chuyển đổi Font',
    es: 'Convertidor de Fuentes',
    pt: 'Conversor de Fontes',
  },
  description: {
    en: 'Convert a TTF/OTF to WOFF (or back), and subset a font down to only the characters you need. Runs in your browser — nothing is uploaded.',
    vi: 'Chuyển TTF/OTF sang WOFF (hoặc ngược lại), và rút gọn font chỉ giữ ký tự cần dùng. Chạy trong trình duyệt, không tải file lên.',
    es: 'Convierte un TTF/OTF a WOFF (o al revés), y crea un subconjunto de la fuente con solo los caracteres que necesitas. Se ejecuta en tu navegador.',
    pt: 'Converta um TTF/OTF para WOFF (ou vice-versa), e crie um subconjunto da fonte só com os caracteres que você precisa. Roda no navegador.',
  },
  keywords: [
    'font converter online',
    'ttf to woff',
    'woff to ttf',
    'font subsetting online',
    'reduce font file size',
    'otf to woff converter',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'audio-trim',
      reason: {
        en: 'Another browser-only file tool with no upload',
        vi: 'Một công cụ xử lý file khác cũng không tải lên đâu cả',
        es: 'Otra herramienta de archivos que no sube nada',
        pt: 'Outra ferramenta de arquivo que não envia nada',
      },
    },
    {
      tool: 'image-format-converter',
      reason: {
        en: 'Convert the images that go with this font next',
        vi: 'Chuyển tiếp định dạng ảnh đi kèm font này',
        es: 'Convierte a continuación las imágenes que acompañan a esta fuente',
        pt: 'Converta em seguida as imagens que acompanham esta fonte',
      },
    },
  ],
};
