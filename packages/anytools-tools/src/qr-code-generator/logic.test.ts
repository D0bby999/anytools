import { describe, expect, it } from 'vitest';
import { buildPayload, generateQrDataUrl, generateQrSvg } from './logic';

describe('buildPayload', () => {
  it('text → raw', () => {
    expect(buildPayload({ kind: 'text', text: 'hello' })).toBe('hello');
  });
  it('url → raw', () => {
    expect(buildPayload({ kind: 'url', url: 'https://example.com' })).toBe('https://example.com');
  });
  it('email with subject + body', () => {
    expect(buildPayload({ kind: 'email', to: 'a@b.com', subject: 'hi', body: 'msg' })).toBe(
      'mailto:a@b.com?subject=hi&body=msg',
    );
  });
  it('tel', () => {
    expect(buildPayload({ kind: 'tel', phone: '+84909000000' })).toBe('tel:+84909000000');
  });
  it('sms with message', () => {
    expect(buildPayload({ kind: 'sms', phone: '0909', message: 'hi there' })).toContain(
      'sms:0909?body=hi%20there',
    );
  });
  it('wifi escapes special chars', () => {
    const out = buildPayload({
      kind: 'wifi',
      ssid: 'My;SSID',
      password: 'pa\\ss',
      encryption: 'WPA',
    });
    expect(out).toContain('S:My\\;SSID');
    expect(out).toContain('P:pa\\\\ss');
    expect(out).toContain('T:WPA');
  });
  it('vcard includes name + email', () => {
    const out = buildPayload({
      kind: 'vcard',
      firstName: 'Alice',
      lastName: 'Tran',
      email: 'a@b.com',
    });
    expect(out).toContain('BEGIN:VCARD');
    expect(out).toContain('FN:Alice Tran');
    expect(out).toContain('EMAIL:a@b.com');
    expect(out).toContain('END:VCARD');
  });
});

describe('generateQrDataUrl', () => {
  it('returns data:image/png base64', async () => {
    const url = await generateQrDataUrl('hello');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan(100);
  });
  it('throws on empty payload', async () => {
    await expect(generateQrDataUrl('')).rejects.toThrow();
  });
  it('respects error correction level', async () => {
    const low = await generateQrDataUrl('hello', { errorCorrectionLevel: 'L' });
    const high = await generateQrDataUrl('hello', { errorCorrectionLevel: 'H' });
    expect(low).not.toBe(high);
  });
});

describe('generateQrSvg', () => {
  it('returns SVG XML', async () => {
    const svg = await generateQrSvg('hello');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
  it('respects custom colors', async () => {
    const svg = await generateQrSvg('hi', { darkColor: '#FF0000', lightColor: '#00FF00' });
    expect(svg).toContain('#FF0000');
    expect(svg).toContain('#00FF00');
  });
});
