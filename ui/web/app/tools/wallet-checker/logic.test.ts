import { describe, expect, it } from 'vitest';
import { inspect } from './logic';

describe('inspect', () => {
  it('valid ETH checksum', () => {
    const r = inspect('0x52908400098527886E0F7030069857D2E4169EE7');
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.kind).toBe('eth');
  });
  it('ETH all-lowercase OK', () => {
    const r = inspect('0x52908400098527886e0f7030069857d2e4169ee7');
    expect(r.valid).toBe(true);
  });
  it('rejects bad ETH checksum', () => {
    const r = inspect('0x52908400098527886E0F7030069857D2E4169Ee7');
    expect(r.valid).toBe(false);
  });
  it('BTC legacy', () => {
    const r = inspect('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.kind).toBe('btc');
  });
  it('BTC bech32', () => {
    const r = inspect('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.subtype).toContain('bech32');
  });
  it('SOL', () => {
    const r = inspect('11111111111111111111111111111111');
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.kind).toBe('sol');
  });
  it('garbage', () => {
    expect(inspect('hello world').valid).toBe(false);
  });
  it('failures carry a code and successes a subtype id', () => {
    expect(inspect('   ')).toMatchObject({ valid: false, code: 'emptyInput' });
    expect(inspect('0x52908400098527886E0F7030069857D2E4169Ee7')).toMatchObject({
      code: 'evmChecksum',
      error: 'Invalid EVM checksum',
    });
    expect(inspect('hello world')).toMatchObject({ code: 'unrecognized' });
    expect(inspect('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toMatchObject({ subtypeId: 'legacy' });
    expect(inspect('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toMatchObject({
      subtypeId: 'bech32',
    });
    expect(inspect('0x52908400098527886E0F7030069857D2E4169EE7')).toMatchObject({
      subtypeId: 'evmValid',
    });
  });
});
