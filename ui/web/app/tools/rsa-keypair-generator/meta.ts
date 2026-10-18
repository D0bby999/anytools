import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'rsa-keypair-generator',
  cluster: 'generators',
  title: {
    en: 'RSA Key Pair Generator',
    vi: 'Tạo cặp khoá RSA',
    es: 'Generador de par de claves RSA',
    pt: 'Gerador de par de chaves RSA',
  },
  description: {
    en: 'Generate an RSA (2048/3072/4096-bit) or Ed25519 key pair as PEM, right in your browser. Nothing is uploaded, and the private key never leaves the tab.',
    vi: 'Tạo cặp khoá RSA (2048/3072/4096-bit) hoặc Ed25519 dưới dạng PEM, ngay trong trình duyệt. Không tải lên đâu cả, khoá riêng không rời khỏi tab.',
    es: 'Genera un par de claves RSA (2048/3072/4096 bits) o Ed25519 en formato PEM, en tu navegador. La clave privada nunca sale de la pestaña.',
    pt: 'Gere um par de chaves RSA (2048/3072/4096 bits) ou Ed25519 em PEM, no seu navegador. A chave privada nunca sai da aba.',
  },
  keywords: [
    'rsa key generator',
    'generate rsa keys online',
    'rsa public private key',
    'pem key generator',
    'ed25519 keypair',
    'rsa 2048 4096',
    'rsa-oaep key',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'jwt-decoder',
      reason: {
        en: 'Decode a JWT signed with an RSA key',
        vi: 'Giải mã JWT được ký bằng khoá RSA',
        es: 'Decodifica un JWT firmado con una clave RSA',
        pt: 'Decodifique um JWT assinado com uma chave RSA',
      },
    },
    {
      tool: 'hash-generator',
      reason: {
        en: 'Hash a message before signing it',
        vi: 'Hash một thông điệp trước khi ký',
        es: 'Genera el hash de un mensaje antes de firmarlo',
        pt: 'Gere o hash de uma mensagem antes de assiná-la',
      },
    },
  ],
};
