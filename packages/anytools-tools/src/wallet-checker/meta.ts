import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'wallet-checker',
  cluster: 'web3',
  title: {
    en: 'Wallet Address Checker',
    vi: 'Kiểm tra Địa chỉ Ví',
    es: 'Verificador de direcciones de wallet',
    pt: 'Verificador de endereços de carteira',
  },
  description: {
    en: 'Validate Ethereum (EIP-55), Bitcoin (legacy/segwit/bech32), and Solana addresses. Browser-only, no blockchain queries.',
    vi: 'Validate địa chỉ Ethereum (EIP-55), Bitcoin (legacy/segwit/bech32), và Solana. Chỉ trong browser, không query blockchain.',
    es: 'Valida direcciones de Ethereum (EIP-55), Bitcoin (legacy/segwit/bech32) y Solana. Solo en el navegador, sin consultas a la blockchain.',
    pt: 'Valida endereços de Ethereum (EIP-55), Bitcoin (legacy/segwit/bech32) e Solana. Só no navegador, sem consultas à blockchain.',
  },
  keywords: ['eth address', 'btc address', 'sol address', 'wallet validator', 'eip-55', 'bech32'],
  priority: 'P3',
  effort: 'M',
  nextStepSuggestions: [
    { tool: 'eth-wei-converter', reason: { en: 'Convert ETH amounts', vi: 'Convert lượng ETH' } },
    {
      tool: 'hash-generator',
      reason: { en: 'Hash address for shorter ID', vi: 'Hash địa chỉ cho ID ngắn' },
    },
  ],
};
