import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'qr-code-generator',
  cluster: 'generators',
  title: {
    en: 'QR Code Generator',
    vi: 'Tạo mã QR',
    es: 'Generador de Código QR',
    pt: 'Gerador de QR Code',
  },
  description: {
    en: 'Generate QR codes for text, URLs, vCard, Wi-Fi, or email — PNG and SVG download, error correction levels, color customization. 100% local.',
    vi: 'Tạo mã QR cho văn bản, URL, vCard, Wi-Fi, hoặc email — tải PNG và SVG, mức sửa lỗi, tùy chỉnh màu. 100% offline.',
    es: 'Genera códigos QR para texto, URLs, vCard, Wi-Fi o email — descarga PNG y SVG, niveles de corrección de errores, personalización de color.',
    pt: 'Gere QR codes para texto, URLs, vCard, Wi-Fi ou email — download PNG e SVG, níveis de correção de erros, personalização de cores.',
  },
  keywords: [
    'qr code',
    'qr code generator',
    'qr generator',
    'qr png',
    'qr svg',
    'vcard qr',
    'wifi qr',
    'tạo mã qr',
    'generar qr',
    'gerador qr',
  ],
  priority: 'P3',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'barcode-generator',
      reason: {
        en: 'For EAN-13, UPC-A, Code 128 and the other 1D symbologies',
        vi: 'Cho EAN-13, UPC-A, Code 128 và các mã vạch 1D khác',
        es: 'Para EAN-13, UPC-A, Code 128 y otros códigos 1D',
        pt: 'Para EAN-13, UPC-A, Code 128 e outros códigos 1D',
      },
    },
    {
      tool: 'url-encode',
      reason: {
        en: 'Encode URL parameters before generating a QR',
        vi: 'Encode tham số URL trước khi tạo QR',
        es: 'Codificar parámetros URL antes de generar QR',
        pt: 'Codificar parâmetros de URL antes de gerar QR',
      },
    },
    {
      tool: 'base64-encode',
      reason: {
        en: 'QR data can be Base64 for compactness',
        vi: 'Dữ liệu QR có thể Base64 cho gọn',
        es: 'Los datos QR pueden ser Base64 para compactar',
        pt: 'Dados QR podem ser Base64 para compactação',
      },
    },
  ],
};
