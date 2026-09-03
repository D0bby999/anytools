import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'qr-barcode-scanner',
  cluster: 'image',
  availableLocales: ['en'],
  title: {
    en: 'QR & Barcode Scanner',
    vi: 'Quét Mã QR & Mã Vạch',
    es: 'Escáner de QR y Códigos de Barras',
    pt: 'Leitor de QR e Código de Barras',
  },
  description: {
    en: 'Read QR, Data Matrix, Aztec, PDF417, EAN, UPC, Code 39/93/128 and ITF from a photo or your camera. Lists every code in the image; Wi-Fi codes split into network and password. Runs in your browser.',
    vi: 'Đọc QR, Data Matrix, Aztec, PDF417, EAN, UPC, Code 39/93/128 và ITF từ ảnh hoặc camera. Liệt kê mọi mã trong ảnh; mã Wi-Fi tách thành tên mạng và mật khẩu.',
    es: 'Lee QR, Data Matrix, Aztec, PDF417, EAN, UPC, Code 39/93/128 e ITF desde una foto o la cámara. Lista todos los códigos; los de Wi-Fi se separan en red y contraseña.',
    pt: 'Leia QR, Data Matrix, Aztec, PDF417, EAN, UPC, Code 39/93/128 e ITF de uma foto ou da câmera. Lista todos os códigos; os de Wi-Fi viram rede e senha.',
  },
  keywords: [
    'qr code scanner',
    'barcode scanner online',
    'read qr from image',
    'scan barcode with camera',
    'decode data matrix',
    'read ean 13 from photo',
    'wifi qr code reader',
  ],
  priority: 'P1',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'barcode-generator',
      reason: {
        en: 'Re-make the code you just read, or fix its check digit',
        vi: 'Tạo lại mã vừa đọc, hoặc sửa check digit',
        es: 'Vuelve a crear el código que acabas de leer',
        pt: 'Recrie o código que acabou de ler',
      },
    },
    {
      tool: 'qr-code-generator',
      reason: {
        en: 'Build a QR from the Wi-Fi or vCard fields you just recovered',
        vi: 'Tạo QR từ trường Wi-Fi hoặc vCard vừa lấy được',
        es: 'Crea un QR con los datos Wi-Fi o vCard recuperados',
        pt: 'Crie um QR com os dados Wi-Fi ou vCard recuperados',
      },
    },
    {
      tool: 'crop-image',
      reason: {
        en: 'Crop closer to a code that will not read',
        vi: 'Cắt sát vào mã khi quét không ra',
        es: 'Recorta más cerca del código que no se lee',
        pt: 'Corte mais perto do código que não lê',
      },
    },
  ],
};
