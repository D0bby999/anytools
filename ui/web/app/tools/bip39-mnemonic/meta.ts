import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'bip39-mnemonic',
  cluster: 'web3',
  title: {
    en: 'BIP-39 Mnemonic Tool',
    vi: 'Công cụ cụm từ BIP-39',
    es: 'Herramienta de frase mnemónica BIP-39',
    pt: 'Ferramenta de frase mnemônica BIP-39',
  },
  description: {
    en: 'Generate, validate and convert BIP-39 mnemonic phrases (12–24 words) — entropy, checksum and seed derivation, English wordlist. Runs in your browser, for learning and testing only.',
    vi: 'Tạo, kiểm tra và đổi cụm từ BIP-39 (12–24 từ) — entropy, checksum và dẫn xuất seed, chỉ wordlist tiếng Anh. Chạy trong trình duyệt, chỉ để học và kiểm tra.',
    es: 'Genera, valida y convierte frases mnemónicas BIP-39 (12–24 palabras) — entropía, checksum y derivación de seed, solo wordlist en inglés. En tu navegador, solo para aprender y probar.',
    pt: 'Gere, valide e converta frases mnemônicas BIP-39 (12–24 palavras) — entropia, checksum e derivação de seed, apenas wordlist em inglês. No navegador, só para aprender e testar.',
  },
  keywords: [
    'bip39',
    'mnemonic generator',
    'seed phrase generator',
    'mnemonic validator',
    'bip39 to seed',
    'entropy to mnemonic',
    'crypto wallet phrase',
  ],
  priority: 'P3',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'wallet-checker',
      reason: {
        en: 'Validate the address format a wallet derived from this seed would produce',
        vi: 'Kiểm tra định dạng địa chỉ mà ví dẫn ra từ seed này sẽ tạo',
        es: 'Valida el formato de dirección que produciría una wallet derivada de este seed',
        pt: 'Valide o formato de endereço que uma carteira derivada deste seed produziria',
      },
    },
    {
      tool: 'eth-wei-converter',
      reason: {
        en: 'Convert ETH amounts once you have an address to work with',
        vi: 'Convert lượng ETH khi đã có địa chỉ để dùng',
        es: 'Convierte montos de ETH una vez que tengas una dirección',
        pt: 'Converta valores de ETH quando tiver um endereço para usar',
      },
    },
  ],
};
