import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Image Format Converter',
  sourceImage: 'Source image (PNG, JPEG, WebP, AVIF, GIF) — max 10 MB',
  targetFormat: 'Target format',
  quality: 'Quality: {p}%',
  converting: 'Converting…',
  larger: 'larger',
  smaller: 'smaller',
  convertedPreview: 'Converted preview',
  downloadFile: 'Download {name}',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi định dạng ảnh',
    sourceImage: 'Ảnh nguồn (PNG, JPEG, WebP, AVIF, GIF) — tối đa 10 MB',
    targetFormat: 'Định dạng đích',
    quality: 'Chất lượng: {p}%',
    converting: 'Đang chuyển đổi…',
    larger: 'lớn hơn',
    smaller: 'nhỏ hơn',
    convertedPreview: 'Xem trước ảnh đã chuyển',
    downloadFile: 'Tải {name}',
  },
  es: {
    title: 'Conversor de formato de imagen',
    sourceImage: 'Imagen de origen (PNG, JPEG, WebP, AVIF, GIF) — máx. 10 MB',
    targetFormat: 'Formato de destino',
    quality: 'Calidad: {p}%',
    converting: 'Convirtiendo…',
    larger: 'más grande',
    smaller: 'más pequeño',
    convertedPreview: 'Vista previa convertida',
    downloadFile: 'Descargar {name}',
  },
  pt: {
    title: 'Conversor de formato de imagem',
    sourceImage: 'Imagem de origem (PNG, JPEG, WebP, AVIF, GIF) — máx. 10 MB',
    targetFormat: 'Formato de destino',
    quality: 'Qualidade: {p}%',
    converting: 'Convertendo…',
    larger: 'maior',
    smaller: 'menor',
    convertedPreview: 'Pré-visualização convertida',
    downloadFile: 'Baixar {name}',
  },
};
