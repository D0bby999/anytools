import { formatUnits, parseUnits } from 'ethers';

export type EthUnit = 'wei' | 'kwei' | 'mwei' | 'gwei' | 'szabo' | 'finney' | 'ether';

const DECIMALS: Record<EthUnit, number> = {
  wei: 0,
  kwei: 3,
  mwei: 6,
  gwei: 9,
  szabo: 12,
  finney: 15,
  ether: 18,
};

export function convert(value: string, from: EthUnit, to: EthUnit): string {
  if (value.trim().length === 0) return '';
  // Normalize to wei (BigInt), then format to target
  const wei = parseUnits(value, DECIMALS[from]);
  return formatUnits(wei, DECIMALS[to]);
}

export function allConversions(value: string, from: EthUnit): Record<EthUnit, string> {
  const out = {} as Record<EthUnit, string>;
  if (value.trim().length === 0) {
    for (const u of Object.keys(DECIMALS) as EthUnit[]) out[u] = '';
    return out;
  }
  try {
    for (const to of Object.keys(DECIMALS) as EthUnit[]) {
      out[to] = convert(value, from, to);
    }
  } catch {
    for (const u of Object.keys(DECIMALS) as EthUnit[]) out[u] = '';
  }
  return out;
}
