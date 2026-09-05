import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'ETH ↔ Wei ↔ Gwei Converter',
  value: 'Value',
  unit: 'Unit',
  weiSmallest: 'wei (smallest)',
  // {parse} and {format} are the ethers function names in <code>.
  note: 'Uses {parse} / {format} (BigInt math — no floating-point loss).',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi ETH ↔ Wei ↔ Gwei',
    value: 'Giá trị',
    unit: 'Đơn vị',
    weiSmallest: 'wei (nhỏ nhất)',
    note: 'Dùng {parse} / {format} (tính bằng BigInt — không mất độ chính xác kiểu số thực).',
  },
  es: {
    title: 'Conversor ETH ↔ Wei ↔ Gwei',
    value: 'Valor',
    unit: 'Unidad',
    weiSmallest: 'wei (la más pequeña)',
    note: 'Usa {parse} / {format} (aritmética BigInt — sin pérdida de coma flotante).',
  },
  pt: {
    title: 'Conversor ETH ↔ Wei ↔ Gwei',
    value: 'Valor',
    unit: 'Unidade',
    weiSmallest: 'wei (a menor)',
    note: 'Usa {parse} / {format} (aritmética BigInt — sem perda de ponto flutuante).',
  },
};
