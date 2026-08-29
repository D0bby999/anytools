import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'bcrypt-generator',
  cluster: 'generators',
  title: {
    en: 'Bcrypt Hash Generator & Checker',
    vi: 'Tạo & kiểm tra hash Bcrypt',
    es: 'Generador y Verificador de Bcrypt',
    pt: 'Gerador e Verificador de Bcrypt',
  },
  description: {
    en: 'Hash passwords with bcrypt (choose cost rounds 4–15) and verify a password against an existing hash — everything runs in your browser, nothing is sent anywhere.',
    vi: 'Băm mật khẩu bằng bcrypt (chọn cost 4–15) và kiểm tra mật khẩu với hash có sẵn — chạy hoàn toàn trong trình duyệt, không gửi đi đâu.',
    es: 'Hashea contraseñas con bcrypt (rondas 4–15) y verifica una contraseña contra un hash existente — todo en tu navegador.',
    pt: 'Faça hash de senhas com bcrypt (rounds 4–15) e verifique uma senha contra um hash existente — tudo no seu navegador.',
  },
  keywords: [
    'bcrypt generator',
    'bcrypt hash',
    'bcrypt online',
    'bcrypt verify',
    'password hash',
    'bcrypt checker',
    'băm bcrypt',
    'hash bcrypt',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'hash-generator',
      reason: {
        en: 'Need MD5/SHA hashes instead?',
        vi: 'Cần hash MD5/SHA?',
        es: '¿Necesitas hashes MD5/SHA?',
        pt: 'Precisa de hashes MD5/SHA?',
      },
    },
    {
      tool: 'password-generator',
      reason: {
        en: 'Generate a strong password to hash',
        vi: 'Tạo mật khẩu mạnh để băm',
        es: 'Genera una contraseña fuerte para hashear',
        pt: 'Gere uma senha forte para o hash',
      },
    },
  ],
};
