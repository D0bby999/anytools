import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'barcode-generator',
  cluster: 'generators',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'Barcode Generator',
    vi: 'Tạo Mã Vạch',
    es: 'Generador de Códigos de Barras',
    pt: 'Gerador de Código de Barras',
  },
  description: {
    en: 'Make an EAN-13, EAN-8, UPC-A, ITF-14, Code 128, Code 39, Data Matrix, PDF417 or Aztec code. Check digits verified before encoding; SVG and PNG download. Runs in your browser.',
    vi: 'Tạo mã EAN-13, EAN-8, UPC-A, ITF-14, Code 128, Code 39, Data Matrix, PDF417 hay Aztec. Kiểm checksum trước khi sinh; tải SVG và PNG. Chạy trong trình duyệt.',
    es: 'Crea un código EAN-13, EAN-8, UPC-A, ITF-14, Code 128, Code 39, Data Matrix, PDF417 o Aztec. Verifica el dígito de control; descarga SVG y PNG.',
    pt: 'Crie um código EAN-13, EAN-8, UPC-A, ITF-14, Code 128, Code 39, Data Matrix, PDF417 ou Aztec. Verifica o dígito verificador; download SVG e PNG.',
  },
  keywords: [
    'barcode generator',
    'ean 13 generator',
    'upc a barcode',
    'code 128 generator',
    'itf-14 barcode',
    'barcode check digit calculator',
    'data matrix generator',
    'barcode svg download',
  ],
  priority: 'P1',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'qr-barcode-scanner',
      reason: {
        en: 'Scan the code you just made to confirm it reads back',
        vi: 'Quét lại mã vừa tạo để chắc nó đọc được',
        es: 'Escanea el código recién creado para comprobarlo',
        pt: 'Leia o código recém-criado para confirmar',
      },
    },
    {
      tool: 'qr-code-generator',
      reason: {
        en: 'For a QR code — with Wi-Fi, vCard and email templates',
        vi: 'Cho mã QR — có mẫu Wi-Fi, vCard và email',
        es: 'Para un código QR — con plantillas Wi-Fi, vCard y email',
        pt: 'Para um QR code — com modelos Wi-Fi, vCard e email',
      },
    },
  ],
};
