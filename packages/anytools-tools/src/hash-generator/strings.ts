import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Hash Generator',
  tabText: 'Text',
  tabFile: 'File',
  pasteText: 'Paste text to hash',
  hashing: 'Hashing…',
  hashFile: 'Hash file',
  messageToAuthenticate: 'Message to authenticate',
  secretKey: 'Secret key',
  sharedSecret: 'Shared secret',
  hmacNote:
    'MD5 is not offered here — HMAC-MD5 is not something to start a new integration with. Everything is computed in your browser via WebCrypto; the key is never sent anywhere.',
  algorithms: 'Algorithms:',
  error: 'Error',
  weakNote:
    'MD5 and SHA-1 are cryptographically broken — fine for non-security checksums, never for passwords or signatures. Use SHA-256+ for anything security-related.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Tạo mã hash',
    tabText: 'Văn bản',
    tabFile: 'Tệp',
    pasteText: 'Dán văn bản cần băm',
    hashing: 'Đang băm…',
    hashFile: 'Băm tệp',
    messageToAuthenticate: 'Thông điệp cần xác thực',
    secretKey: 'Khóa bí mật',
    sharedSecret: 'Bí mật dùng chung',
    hmacNote:
      'Không hỗ trợ MD5 ở đây — HMAC-MD5 không phải thứ nên dùng cho một tích hợp mới. Mọi thứ được tính ngay trong trình duyệt qua WebCrypto; khóa không bao giờ được gửi đi đâu.',
    algorithms: 'Thuật toán:',
    error: 'Lỗi',
    weakNote:
      'MD5 và SHA-1 đã bị phá về mặt mật mã — dùng được cho checksum không liên quan bảo mật, không bao giờ dùng cho mật khẩu hay chữ ký. Hãy dùng SHA-256 trở lên cho mọi việc liên quan đến bảo mật.',
  },
  es: {
    title: 'Generador de hash',
    tabText: 'Texto',
    tabFile: 'Archivo',
    pasteText: 'Pega el texto a hashear',
    hashing: 'Calculando hash…',
    hashFile: 'Hashear archivo',
    messageToAuthenticate: 'Mensaje a autenticar',
    secretKey: 'Clave secreta',
    sharedSecret: 'Secreto compartido',
    hmacNote:
      'MD5 no se ofrece aquí: HMAC-MD5 no es algo con lo que empezar una integración nueva. Todo se calcula en tu navegador mediante WebCrypto; la clave nunca se envía a ningún sitio.',
    algorithms: 'Algoritmos:',
    error: 'Error',
    weakNote:
      'MD5 y SHA-1 están rotos criptográficamente: sirven para sumas de verificación sin implicaciones de seguridad, nunca para contraseñas ni firmas. Usa SHA-256 o superior para todo lo relacionado con seguridad.',
  },
  pt: {
    title: 'Gerador de hash',
    tabText: 'Texto',
    tabFile: 'Arquivo',
    pasteText: 'Cole o texto a ser hasheado',
    hashing: 'Calculando hash…',
    hashFile: 'Hashear arquivo',
    messageToAuthenticate: 'Mensagem a autenticar',
    secretKey: 'Chave secreta',
    sharedSecret: 'Segredo compartilhado',
    hmacNote:
      'MD5 não é oferecido aqui — HMAC-MD5 não é algo com que se deva começar uma integração nova. Tudo é calculado no seu navegador via WebCrypto; a chave nunca é enviada a lugar nenhum.',
    algorithms: 'Algoritmos:',
    error: 'Erro',
    weakNote:
      'MD5 e SHA-1 estão criptograficamente quebrados — servem para checksums sem relação com segurança, nunca para senhas ou assinaturas. Use SHA-256 ou superior para qualquer coisa ligada à segurança.',
  },
};
