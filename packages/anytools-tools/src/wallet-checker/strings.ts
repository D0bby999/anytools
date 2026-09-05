import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Wallet Address Checker',
  placeholder: 'Paste ETH, BTC, or SOL address',
  checksum: 'Checksum ✓',
  canonical: 'Canonical',
  // Subtype labels come from logic.ts; keyed by their exact English text.
  evmValid: 'EVM (EIP-55 valid)',
  evmMismatch: 'EVM (checksum mismatch)',
  bech32: 'bech32 (native segwit)',
  legacy: 'legacy (P2PKH)',
  segwitWrapped: 'segwit-wrapped (P2SH)',
  privacy:
    'Address validation runs in your browser. We do not query any blockchain or external API.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Kiểm tra địa chỉ ví',
    placeholder: 'Dán địa chỉ ETH, BTC hoặc SOL',
    checksum: 'Checksum ✓',
    canonical: 'Dạng chuẩn',
    evmValid: 'EVM (EIP-55 hợp lệ)',
    evmMismatch: 'EVM (sai checksum)',
    bech32: 'bech32 (segwit gốc)',
    legacy: 'kiểu cũ (P2PKH)',
    segwitWrapped: 'segwit bọc (P2SH)',
    privacy:
      'Việc kiểm tra địa chỉ chạy trong trình duyệt của bạn. Chúng tôi không truy vấn blockchain hay API bên ngoài nào.',
  },
  es: {
    title: 'Verificador de direcciones de billetera',
    placeholder: 'Pega una dirección ETH, BTC o SOL',
    checksum: 'Checksum ✓',
    canonical: 'Canónica',
    evmValid: 'EVM (EIP-55 válido)',
    evmMismatch: 'EVM (checksum incorrecto)',
    bech32: 'bech32 (segwit nativo)',
    legacy: 'legado (P2PKH)',
    segwitWrapped: 'segwit envuelto (P2SH)',
    privacy:
      'La validación de direcciones se ejecuta en tu navegador. No consultamos ninguna blockchain ni API externa.',
  },
  pt: {
    title: 'Verificador de endereço de carteira',
    placeholder: 'Cole um endereço ETH, BTC ou SOL',
    checksum: 'Checksum ✓',
    canonical: 'Canônico',
    evmValid: 'EVM (EIP-55 válido)',
    evmMismatch: 'EVM (checksum incorreto)',
    bech32: 'bech32 (segwit nativo)',
    legacy: 'legado (P2PKH)',
    segwitWrapped: 'segwit encapsulado (P2SH)',
    privacy:
      'A validação do endereço roda no seu navegador. Não consultamos nenhuma blockchain nem API externa.',
  },
};
