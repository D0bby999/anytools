import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'JWT Decoder',
  tokenLabel: 'JWT token',
  pasteHint: 'Paste a JWT to decode.',
  // {n} is replaced with the number of seconds.
  expiredAgo: 'Expired {n}s ago',
  validFor: 'Valid for {n}s',
  header: 'Header',
  payload: 'Payload',
  signature: 'Signature (raw)',
  decodeFailed: 'Decode failed',
  privacy:
    'Decoded in your browser. Never store or send JWTs that contain secrets to third-party tools.',
  signatureNote:
    "Signature verification requires the issuer's key — intentionally not exposed in this client-side tool.",
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Giải mã JWT',
    tokenLabel: 'Chuỗi JWT',
    pasteHint: 'Dán JWT để giải mã.',
    expiredAgo: 'Đã hết hạn {n} giây trước',
    validFor: 'Còn hiệu lực {n} giây',
    signature: 'Chữ ký (thô)',
    decodeFailed: 'Giải mã thất bại',
    privacy:
      'Giải mã ngay trong trình duyệt. Đừng lưu hay gửi JWT chứa bí mật cho công cụ bên thứ ba.',
    signatureNote:
      'Xác minh chữ ký cần khóa của bên phát hành — công cụ chạy phía client này cố ý không làm việc đó.',
  },
  es: {
    title: 'Decodificador JWT',
    tokenLabel: 'Token JWT',
    pasteHint: 'Pega un JWT para decodificarlo.',
    expiredAgo: 'Expiró hace {n}s',
    validFor: 'Válido durante {n}s',
    header: 'Encabezado',
    signature: 'Firma (sin procesar)',
    decodeFailed: 'La decodificación falló',
    privacy:
      'Decodificado en tu navegador. Nunca guardes ni envíes JWT con secretos a herramientas de terceros.',
    signatureNote:
      'Verificar la firma requiere la clave del emisor — esta herramienta del lado del cliente no lo hace a propósito.',
  },
  pt: {
    title: 'Decodificador JWT',
    tokenLabel: 'Token JWT',
    pasteHint: 'Cole um JWT para decodificar.',
    expiredAgo: 'Expirou há {n}s',
    validFor: 'Válido por {n}s',
    header: 'Cabeçalho',
    signature: 'Assinatura (bruta)',
    decodeFailed: 'A decodificação falhou',
    privacy:
      'Decodificado no seu navegador. Nunca guarde nem envie JWTs com segredos para ferramentas de terceiros.',
    signatureNote:
      'Verificar a assinatura exige a chave do emissor — esta ferramenta no cliente não faz isso de propósito.',
  },
};
