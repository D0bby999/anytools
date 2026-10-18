import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'jwt-sign-verify',
  cluster: 'encoding',
  title: {
    en: 'JWT Sign & Verify',
    vi: 'Ký & Xác minh JWT',
    es: 'Firmar y verificar JWT',
    pt: 'Assinar e verificar JWT',
  },
  description: {
    en: 'Sign a JWT with HS256/384/512 or RS256/ES256, and verify a token against a secret or public key — signature, expiry and alg:none checked separately. Runs in your browser.',
    vi: 'Ký JWT bằng HS256/384/512 hoặc RS256/ES256, và xác minh token bằng secret hoặc khoá công khai — kiểm chữ ký, hết hạn, alg:none riêng biệt. Chạy trong trình duyệt.',
    es: 'Firma un JWT con HS256/384/512 o RS256/ES256, y verifica un token con un secreto o clave pública — firma, caducidad y alg:none comprobados por separado. En tu navegador.',
    pt: 'Assine um JWT com HS256/384/512 ou RS256/ES256, e verifique um token com um segredo ou chave pública — assinatura, validade e alg:none checados separadamente. No seu navegador.',
  },
  keywords: [
    'jwt sign',
    'jwt verify',
    'verify jwt signature',
    'jwt hs256',
    'jwt rs256',
    'jwt es256',
    'alg none vulnerability',
    'json web token verifier',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'jwt-decoder',
      reason: {
        en: 'Just want to read a token, no key required? Decode it there instead',
        vi: 'Chỉ cần đọc token, không cần khoá? Giải mã bên đó',
        es: 'Solo quieres leer un token, sin clave? Decodifícalo ahí',
        pt: 'Só quer ler um token, sem chave? Decodifique lá',
      },
    },
    {
      tool: 'rsa-keypair-generator',
      reason: {
        en: 'Generate an RSA key pair to sign and verify RS256 tokens with',
        vi: 'Tạo cặp khoá RSA để ký và xác minh token RS256',
        es: 'Genera un par de claves RSA para firmar y verificar tokens RS256',
        pt: 'Gere um par de chaves RSA para assinar e verificar tokens RS256',
      },
    },
  ],
};
