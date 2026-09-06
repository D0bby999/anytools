import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'x509-certificate-decoder',
  cluster: 'encoding',
  title: {
    en: 'X.509 Certificate Decoder',
    vi: 'Giải mã chứng chỉ X.509',
    es: 'Decodificador de certificados X.509',
    pt: 'Decodificador de certificados X.509',
  },
  description: {
    en: 'Inspect a PEM or DER (.cer/.crt/.der) X.509 certificate — subject, issuer, validity, SAN, key usage, fingerprints. Certificate chains parsed in order. Runs in your browser.',
    vi: 'Xem chứng chỉ X.509 dạng PEM hoặc DER (.cer/.crt/.der) — subject, issuer, hiệu lực, SAN, key usage, vân tay. Đọc cả chuỗi chứng chỉ theo thứ tự. Chạy trong trình duyệt.',
    es: 'Inspecciona un certificado X.509 en PEM o DER (.cer/.crt/.der): subject, issuer, validez, SAN, key usage, huellas digitales. Cadenas de certificados en orden. En tu navegador.',
    pt: 'Inspecione um certificado X.509 em PEM ou DER (.cer/.crt/.der): subject, issuer, validade, SAN, key usage, fingerprints. Cadeias de certificados em ordem. No seu navegador.',
  },
  keywords: [
    'x509 decoder',
    'certificate decoder',
    'pem certificate viewer',
    'der certificate viewer',
    'ssl certificate decoder',
    'certificate chain viewer',
    'certificate fingerprint',
    'cert expiry checker',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'jwt-decoder',
      reason: {
        en: 'Decode a JWT, another PKI-adjacent token format',
        vi: 'Giải mã JWT, một định dạng token liên quan PKI khác',
        es: 'Decodifica un JWT, otro formato de token relacionado con PKI',
        pt: 'Decodifique um JWT, outro formato de token relacionado a PKI',
      },
    },
    {
      tool: 'rsa-keypair-generator',
      reason: {
        en: 'Generate an RSA key pair to build a test certificate from',
        vi: 'Tạo cặp khoá RSA để dựng chứng chỉ thử nghiệm',
        es: 'Genera un par de claves RSA para construir un certificado de prueba',
        pt: 'Gere um par de chaves RSA para montar um certificado de teste',
      },
    },
  ],
};
