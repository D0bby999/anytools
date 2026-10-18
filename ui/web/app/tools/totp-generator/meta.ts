import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'totp-generator',
  cluster: 'generators',
  title: {
    en: 'TOTP Code Generator (2FA)',
    vi: 'Tạo mã TOTP (2FA)',
    es: 'Generador de Códigos TOTP (2FA)',
    pt: 'Gerador de Códigos TOTP (2FA)',
  },
  description: {
    en: 'Generate RFC 6238 TOTP two-factor codes from a base32 secret — live countdown, QR code and otpauth:// URI for authenticator apps. Secrets never leave your browser.',
    vi: 'Tạo mã 2FA TOTP chuẩn RFC 6238 từ secret base32 — đếm ngược trực tiếp, mã QR và URI otpauth:// cho app authenticator. Secret không rời trình duyệt.',
    es: 'Genera códigos 2FA TOTP (RFC 6238) desde un secreto base32 — cuenta regresiva en vivo, código QR y URI otpauth://. El secreto nunca sale de tu navegador.',
    pt: 'Gere códigos 2FA TOTP (RFC 6238) a partir de um segredo base32 — contagem regressiva ao vivo, QR code e URI otpauth://. O segredo nunca sai do navegador.',
  },
  keywords: [
    'totp generator',
    '2fa code generator',
    'otp generator',
    'authenticator code',
    'totp online',
    'two factor code',
    'tạo mã 2fa',
    'código totp',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'qr-code-generator',
      reason: {
        en: 'Make a custom QR for any other payload',
        vi: 'Tạo QR tuỳ chỉnh cho nội dung khác',
        es: 'Crea un QR personalizado para otro contenido',
        pt: 'Crie um QR personalizado para outro conteúdo',
      },
    },
    {
      tool: 'password-generator',
      reason: {
        en: 'Pair 2FA with a strong password',
        vi: 'Kết hợp 2FA với mật khẩu mạnh',
        es: 'Combina 2FA con una contraseña fuerte',
        pt: 'Combine 2FA com uma senha forte',
      },
    },
  ],
};
