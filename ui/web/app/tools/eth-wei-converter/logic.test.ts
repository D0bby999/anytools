import { describe, expect, it } from 'vitest';
import { allConversions, convert } from './logic';

describe('convert', () => {
  it('1 ETH = 10^18 wei', () => {
    expect(convert('1', 'ether', 'wei')).toBe('1000000000000000000');
  });
  it('1 ETH = 10^9 gwei', () => {
    expect(convert('1', 'ether', 'gwei')).toBe('1000000000.0');
  });
  it('1 gwei = 10^9 wei', () => {
    expect(convert('1', 'gwei', 'wei')).toBe('1000000000');
  });
  it('preserves precision (BigInt)', () => {
    expect(convert('123456789012345678', 'wei', 'ether')).toBe('0.123456789012345678');
  });
  it('handles zero', () => {
    expect(convert('0', 'ether', 'wei')).toBe('0');
  });
});

describe('allConversions', () => {
  it('produces all units', () => {
    const out = allConversions('1', 'ether');
    expect(out.wei).toBe('1000000000000000000');
    expect(out.gwei).toBe('1000000000.0');
    expect(out.ether).toBe('1.0');
  });
  it('returns empty for invalid input', () => {
    const out = allConversions('not a number', 'ether');
    expect(out.wei).toBe('');
  });
});
