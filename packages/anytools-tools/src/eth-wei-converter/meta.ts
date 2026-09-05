import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'eth-wei-converter',
  cluster: 'web3',
  title: {
    en: 'ETH ↔ Wei ↔ Gwei Converter',
    vi: 'Chuyển đổi ETH ↔ Wei ↔ Gwei',
    es: 'Conversor ETH ↔ Wei ↔ Gwei',
    pt: 'Conversor ETH ↔ Wei ↔ Gwei',
  },
  description: {
    en: 'Convert between Ethereum units (wei, gwei, ether, etc.). BigInt math, no precision loss.',
    vi: 'Chuyển giữa các đơn vị Ethereum (wei, gwei, ether, v.v.). BigInt math, không mất độ chính xác.',
    es: 'Convierte entre unidades de Ethereum (wei, gwei, ether, etc.). Cálculo con BigInt, sin pérdida de precisión.',
    pt: 'Converte entre unidades do Ethereum (wei, gwei, ether etc.). Cálculo com BigInt, sem perda de precisão.',
  },
  keywords: [
    'eth to wei',
    'wei to ether',
    'gwei converter',
    'ethereum units',
    'parseunits',
    'formatunits',
  ],
  priority: 'P3',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'wallet-checker',
      reason: { en: 'Validate Ethereum addresses', vi: 'Validate địa chỉ Ethereum' },
    },
    {
      tool: 'hash-generator',
      reason: { en: 'Compute hashes for Ethereum signing', vi: 'Tính hash cho Ethereum signing' },
    },
  ],
};
