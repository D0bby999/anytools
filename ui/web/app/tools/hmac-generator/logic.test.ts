// @vitest-environment node
// HMAC needs a real crypto.subtle.sign/verify implementation for HMAC key import; Node 22's
// WebCrypto provides it and lets this test check against the actual RFC 4231 vectors.
import { describe, expect, it } from 'vitest';
import { computeHmac, verifyHmac } from './logic';

// RFC 4231 test cases 1 and 2 (https://www.rfc-editor.org/rfc/rfc4231). Case 1's key is
// twenty 0x0b bytes hex-encoded; case 2's key is the ASCII string "Jefe".
const CASE_1_KEY_HEX = '0b'.repeat(20);
const CASE_1_MESSAGE = 'Hi There';
const CASE_2_KEY_TEXT = 'Jefe';
const CASE_2_MESSAGE = 'what do ya want for nothing?';

const EXPECTED: Record<'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512', [string, string]> = {
  'SHA-1': ['b617318655057264e28bc0b6fb378c8ef146be00', 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79'],
  'SHA-256': [
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  ],
  'SHA-384': [
    'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
    'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
  ],
  'SHA-512': [
    '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
    '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
  ],
};

describe('computeHmac — RFC 4231 vectors', () => {
  for (const algo of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const) {
    it(`${algo} test case 1 (hex key)`, async () => {
      const { hex } = await computeHmac(CASE_1_MESSAGE, CASE_1_KEY_HEX, 'hex', algo);
      expect(hex).toBe(EXPECTED[algo][0]);
    });

    it(`${algo} test case 2 ("Jefe" text key)`, async () => {
      const { hex } = await computeHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', algo);
      expect(hex).toBe(EXPECTED[algo][1]);
    });
  }

  it('base64 output decodes back to the same bytes as hex', async () => {
    const { hex, base64 } = await computeHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', 'SHA-256');
    const fromBase64 = Buffer.from(base64, 'base64').toString('hex');
    expect(fromBase64).toBe(hex);
  });
});

describe('computeHmac — input validation', () => {
  it('rejects an odd-length hex key', async () => {
    await expect(computeHmac('msg', 'abc', 'hex', 'SHA-256')).rejects.toMatchObject({
      code: 'invalidKeyHex',
    });
  });

  it('rejects a hex key with non-hex characters', async () => {
    await expect(computeHmac('msg', 'zz11', 'hex', 'SHA-256')).rejects.toMatchObject({
      code: 'invalidKeyHex',
    });
  });

  it('accepts arbitrary text as a text-mode key, unlike hex mode', async () => {
    await expect(computeHmac('msg', 'not hex at all!', 'text', 'SHA-256')).resolves.toBeDefined();
  });
});

describe('verifyHmac', () => {
  it('confirms a correct signature computed by this same tool', async () => {
    const { hex } = await computeHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', 'SHA-256');
    await expect(
      verifyHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', 'SHA-256', hex, 'hex'),
    ).resolves.toBe(true);
  });

  it('confirms a correct signature in base64', async () => {
    const { base64 } = await computeHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', 'SHA-256');
    await expect(
      verifyHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', 'SHA-256', base64, 'base64'),
    ).resolves.toBe(true);
  });

  it('rejects a wrong signature without throwing', async () => {
    await expect(
      verifyHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', 'SHA-256', 'a'.repeat(64), 'hex'),
    ).resolves.toBe(false);
  });

  it('rejects a signature computed with a different key', async () => {
    const { hex } = await computeHmac(CASE_2_MESSAGE, 'right-key', 'text', 'SHA-256');
    await expect(
      verifyHmac(CASE_2_MESSAGE, 'wrong-key', 'text', 'SHA-256', hex, 'hex'),
    ).resolves.toBe(false);
  });

  it('rejects a tampered message even with the right key and signature', async () => {
    const { hex } = await computeHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', 'SHA-256');
    await expect(
      verifyHmac('a different message', CASE_2_KEY_TEXT, 'text', 'SHA-256', hex, 'hex'),
    ).resolves.toBe(false);
  });

  it('flags a malformed expected hash as invalidExpectedHash, not a false negative', async () => {
    await expect(
      verifyHmac(CASE_2_MESSAGE, CASE_2_KEY_TEXT, 'text', 'SHA-256', 'not-hex-zz', 'hex'),
    ).rejects.toMatchObject({ code: 'invalidExpectedHash' });
  });
});
