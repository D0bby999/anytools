import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'AES Text Encrypt / Decrypt',
  tabEncrypt: 'Encrypt',
  tabDecrypt: 'Decrypt',
  plaintextLabel: 'Text to encrypt',
  plaintextPlaceholder: 'Type or paste the text to encrypt…',
  passwordLabel: 'Password',
  encryptButton: 'Encrypt',
  encrypting: 'Encrypting…',
  encryptedLabel: 'Encrypted text (Base64)',
  ciphertextLabel: 'Encrypted text (Base64)',
  ciphertextPlaceholder: 'Paste the Base64 output from Encrypt…',
  decryptButton: 'Decrypt',
  decrypting: 'Decrypting…',
  decryptedLabel: 'Decrypted text',
  encryptFailed: 'Could not encrypt this text.',
  decryptFailed: 'Could not decrypt this text.',
  formatNote:
    'Output is Base64 of salt + IV + ciphertext, made only for this tool — it is not a standard interchange format, so openssl or 7-zip cannot open it. Decrypt it back here.',
  error_emptyPassword: 'Enter a password first.',
  error_invalidPayload:
    'This is not valid Base64 output from this tool — check you copied the whole string.',
  error_wrongPassword:
    'Wrong password, or the encrypted text was altered: the built-in authenticity check failed.',
  error_noSecureContext: 'Web Crypto is unavailable here. Open this page over HTTPS or localhost.',
  privacy:
    'Encryption and decryption happen in this tab with WebCrypto — the password and text never leave your device. That protects the text in transit or storage; it does not protect it on a machine that is already compromised.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Mã hoá / Giải mã text AES',
    tabEncrypt: 'Mã hoá',
    tabDecrypt: 'Giải mã',
    plaintextLabel: 'Text cần mã hoá',
    plaintextPlaceholder: 'Nhập hoặc dán text cần mã hoá…',
    passwordLabel: 'Mật khẩu',
    encryptButton: 'Mã hoá',
    encrypting: 'Đang mã hoá…',
    encryptedLabel: 'Text đã mã hoá (Base64)',
    ciphertextLabel: 'Text đã mã hoá (Base64)',
    ciphertextPlaceholder: 'Dán chuỗi Base64 từ bước Mã hoá…',
    decryptButton: 'Giải mã',
    decrypting: 'Đang giải mã…',
    decryptedLabel: 'Text đã giải mã',
    encryptFailed: 'Không thể mã hoá đoạn text này.',
    decryptFailed: 'Không thể giải mã đoạn text này.',
    formatNote:
      'Kết quả là Base64 của salt + IV + ciphertext, chỉ tool này hiểu được — không phải định dạng chuẩn liên thông, openssl hay 7-zip không mở được. Giải mã ngược lại ngay tại đây.',
    error_emptyPassword: 'Nhập mật khẩu trước đã.',
    error_invalidPayload:
      'Đây không phải chuỗi Base64 do tool này tạo ra — kiểm tra xem đã dán đủ chuỗi chưa.',
    error_wrongPassword:
      'Sai mật khẩu, hoặc text đã mã hoá bị chỉnh sửa: kiểm tra tính toàn vẹn tích hợp sẵn thất bại.',
    error_noSecureContext:
      'Web Crypto không khả dụng ở đây. Mở trang này qua HTTPS hoặc localhost.',
    privacy:
      'Mã hoá và giải mã diễn ra ngay trong tab này bằng WebCrypto — mật khẩu và text không rời khỏi thiết bị. Điều này bảo vệ text khi truyền/lưu trữ, không bảo vệ được nếu máy đã bị chiếm quyền.',
  },
  es: {
    title: 'Cifrar / Descifrar texto AES',
    tabEncrypt: 'Cifrar',
    tabDecrypt: 'Descifrar',
    plaintextLabel: 'Texto a cifrar',
    plaintextPlaceholder: 'Escribe o pega el texto a cifrar…',
    passwordLabel: 'Contraseña',
    encryptButton: 'Cifrar',
    encrypting: 'Cifrando…',
    encryptedLabel: 'Texto cifrado (Base64)',
    ciphertextLabel: 'Texto cifrado (Base64)',
    ciphertextPlaceholder: 'Pega la salida Base64 de Cifrar…',
    decryptButton: 'Descifrar',
    decrypting: 'Descifrando…',
    decryptedLabel: 'Texto descifrado',
    encryptFailed: 'No se pudo cifrar este texto.',
    decryptFailed: 'No se pudo descifrar este texto.',
    formatNote:
      'La salida es Base64 de salt + IV + texto cifrado, hecho solo para esta herramienta — no es un formato estándar, openssl o 7-zip no pueden abrirlo. Descífralo de vuelta aquí mismo.',
    error_emptyPassword: 'Ingresa una contraseña primero.',
    error_invalidPayload:
      'Esto no es una salida Base64 válida de esta herramienta — revisa que copiaste la cadena completa.',
    error_wrongPassword:
      'Contraseña incorrecta, o el texto cifrado fue alterado: la verificación de autenticidad integrada falló.',
    error_noSecureContext:
      'Web Crypto no está disponible aquí. Abre esta página por HTTPS o localhost.',
    privacy:
      'El cifrado y descifrado ocurren en esta pestaña con WebCrypto — la contraseña y el texto nunca salen de tu dispositivo. Eso protege el texto en tránsito o almacenamiento; no lo protege en una máquina ya comprometida.',
  },
  pt: {
    title: 'Criptografar / Descriptografar texto AES',
    tabEncrypt: 'Criptografar',
    tabDecrypt: 'Descriptografar',
    plaintextLabel: 'Texto para criptografar',
    plaintextPlaceholder: 'Digite ou cole o texto a criptografar…',
    passwordLabel: 'Senha',
    encryptButton: 'Criptografar',
    encrypting: 'Criptografando…',
    encryptedLabel: 'Texto criptografado (Base64)',
    ciphertextLabel: 'Texto criptografado (Base64)',
    ciphertextPlaceholder: 'Cole a saída Base64 de Criptografar…',
    decryptButton: 'Descriptografar',
    decrypting: 'Descriptografando…',
    decryptedLabel: 'Texto descriptografado',
    encryptFailed: 'Não foi possível criptografar este texto.',
    decryptFailed: 'Não foi possível descriptografar este texto.',
    formatNote:
      'A saída é Base64 de salt + IV + texto cifrado, feito só para esta ferramenta — não é um formato padrão, openssl ou 7-zip não conseguem abrir. Descriptografe de volta aqui mesmo.',
    error_emptyPassword: 'Digite uma senha primeiro.',
    error_invalidPayload:
      'Isto não é uma saída Base64 válida desta ferramenta — confira se copiou a string inteira.',
    error_wrongPassword:
      'Senha incorreta, ou o texto criptografado foi alterado: a verificação de autenticidade embutida falhou.',
    error_noSecureContext:
      'Web Crypto não está disponível aqui. Abra esta página por HTTPS ou localhost.',
    privacy:
      'A criptografia e a descriptografia acontecem nesta aba com WebCrypto — a senha e o texto nunca saem do seu dispositivo. Isso protege o texto em trânsito ou armazenamento; não protege numa máquina já comprometida.',
  },
};
