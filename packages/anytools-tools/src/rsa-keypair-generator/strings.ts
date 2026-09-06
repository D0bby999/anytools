import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'RSA Key Pair Generator',
  algorithmLabel: 'Key type',
  algoRsaSign: 'RSA — sign / verify',
  algoRsaEncrypt: 'RSA — encrypt / decrypt',
  algoEd25519: 'Ed25519 — sign / verify',
  keySizeLabel: 'Key size',
  generateButton: 'Generate key pair',
  generating: 'Generating… large RSA keys can take a few seconds',
  publicKeyLabel: 'Public key (PEM)',
  privateKeyLabel: 'Private key (PEM)',
  downloadPublic: 'Download public key',
  downloadPrivate: 'Download private key',
  generateFailed: 'Could not generate a key pair.',
  ed25519Unsupported: 'Ed25519 is not available in this browser — RSA is shown instead.',
  error_noSecureContext: 'Web Crypto is unavailable here. Open this page over HTTPS or localhost.',
  // {detail} is the underlying WebCrypto error message.
  error_keyGenFailed: 'Key generation failed: {detail}',
  privacy:
    'The key pair is generated inside this tab with WebCrypto — the private key is never sent anywhere. Do not use browser-generated keys for high-value production systems; use a hardware security module or an audited offline tool for those.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Tạo cặp khoá RSA',
    algorithmLabel: 'Loại khoá',
    algoRsaSign: 'RSA — ký / xác minh',
    algoRsaEncrypt: 'RSA — mã hoá / giải mã',
    algoEd25519: 'Ed25519 — ký / xác minh',
    keySizeLabel: 'Kích thước khoá',
    generateButton: 'Tạo cặp khoá',
    generating: 'Đang tạo… khoá RSA lớn có thể mất vài giây',
    publicKeyLabel: 'Khoá công khai (PEM)',
    privateKeyLabel: 'Khoá riêng (PEM)',
    downloadPublic: 'Tải khoá công khai',
    downloadPrivate: 'Tải khoá riêng',
    generateFailed: 'Không thể tạo cặp khoá.',
    ed25519Unsupported: 'Trình duyệt này chưa hỗ trợ Ed25519 — chỉ hiện RSA.',
    error_noSecureContext:
      'Web Crypto không khả dụng ở đây. Mở trang này qua HTTPS hoặc localhost.',
    error_keyGenFailed: 'Tạo khoá thất bại: {detail}',
    privacy:
      'Cặp khoá được tạo ngay trong tab này bằng WebCrypto — khoá riêng không gửi đi đâu cả. Đừng dùng khoá tạo từ trình duyệt cho hệ thống production giá trị cao; hãy dùng module bảo mật phần cứng hoặc công cụ offline đã kiểm định.',
  },
  es: {
    title: 'Generador de par de claves RSA',
    algorithmLabel: 'Tipo de clave',
    algoRsaSign: 'RSA — firmar / verificar',
    algoRsaEncrypt: 'RSA — cifrar / descifrar',
    algoEd25519: 'Ed25519 — firmar / verificar',
    keySizeLabel: 'Tamaño de clave',
    generateButton: 'Generar par de claves',
    generating: 'Generando… las claves RSA grandes pueden tardar unos segundos',
    publicKeyLabel: 'Clave pública (PEM)',
    privateKeyLabel: 'Clave privada (PEM)',
    downloadPublic: 'Descargar clave pública',
    downloadPrivate: 'Descargar clave privada',
    generateFailed: 'No se pudo generar el par de claves.',
    ed25519Unsupported:
      'Ed25519 no está disponible en este navegador — se muestra RSA en su lugar.',
    error_noSecureContext:
      'Web Crypto no está disponible aquí. Abre esta página por HTTPS o localhost.',
    error_keyGenFailed: 'Falló la generación de la clave: {detail}',
    privacy:
      'El par de claves se genera dentro de esta pestaña con WebCrypto — la clave privada nunca se envía. No uses claves generadas en el navegador para sistemas de producción de alto valor; usa un módulo de seguridad de hardware o una herramienta offline auditada.',
  },
  pt: {
    title: 'Gerador de par de chaves RSA',
    algorithmLabel: 'Tipo de chave',
    algoRsaSign: 'RSA — assinar / verificar',
    algoRsaEncrypt: 'RSA — criptografar / descriptografar',
    algoEd25519: 'Ed25519 — assinar / verificar',
    keySizeLabel: 'Tamanho da chave',
    generateButton: 'Gerar par de chaves',
    generating: 'Gerando… chaves RSA grandes podem levar alguns segundos',
    publicKeyLabel: 'Chave pública (PEM)',
    privateKeyLabel: 'Chave privada (PEM)',
    downloadPublic: 'Baixar chave pública',
    downloadPrivate: 'Baixar chave privada',
    generateFailed: 'Não foi possível gerar o par de chaves.',
    ed25519Unsupported: 'Ed25519 não está disponível neste navegador — RSA é exibido em vez disso.',
    error_noSecureContext:
      'Web Crypto não está disponível aqui. Abra esta página por HTTPS ou localhost.',
    error_keyGenFailed: 'Falha ao gerar a chave: {detail}',
    privacy:
      'O par de chaves é gerado dentro desta aba com WebCrypto — a chave privada nunca é enviada. Não use chaves geradas no navegador para sistemas de produção de alto valor; use um módulo de segurança de hardware ou uma ferramenta offline auditada.',
  },
};
