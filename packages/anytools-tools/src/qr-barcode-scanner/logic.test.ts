import { describe, expect, it } from 'vitest';
import { buildPayload } from '../qr-code-generator/logic';
import { classifyPayload, parseVCardPayload, parseWifiPayload, safeLinkUrl } from './logic';

/**
 * The decode path (`decodeBarcodeImage`, `decodeImageData`) is not tested here: it needs a canvas
 * and a 1.5 MB WASM binary, neither of which happy-dom provides. It is verified in the browser
 * lane by generating an EAN-13 with barcode-generator and reading the PNG back here.
 *
 * What IS tested is the round trip that matters most for correctness: qr-code-generator's
 * `buildPayload` is imported and its real output parsed, so the two tools cannot drift apart on
 * escaping without a test going red.
 */
describe('parseWifiPayload', () => {
  it('parses what qr-code-generator emits, without hardcoding the string', () => {
    const payload = buildPayload({ kind: 'wifi', ssid: 'Cafe Guest', password: 'flatwhite' });
    expect(parseWifiPayload(payload)).toEqual({
      ssid: 'Cafe Guest',
      password: 'flatwhite',
      encryption: 'WPA',
      hidden: false,
    });
  });

  it('recovers a semicolon and a backslash that the generator escaped', () => {
    // The whole reason the parser is a tokenizer rather than a `split(';')`.
    const payload = buildPayload({
      kind: 'wifi',
      ssid: 'a;b',
      password: 'p\\a:ss;word',
      encryption: 'WPA',
    });
    expect(parseWifiPayload(payload)).toMatchObject({ ssid: 'a;b', password: 'p\\a:ss;word' });
  });

  it('reads the hidden flag and an open network', () => {
    const hidden = buildPayload({
      kind: 'wifi',
      ssid: 'Backroom',
      encryption: 'nopass',
      hidden: true,
    });
    expect(parseWifiPayload(hidden)).toEqual({
      ssid: 'Backroom',
      password: '',
      encryption: 'nopass',
      hidden: true,
    });
  });

  it('accepts fields in any order and a lowercase prefix', () => {
    expect(parseWifiPayload('wifi:P:secret;S:Home;T:WEP;;')).toEqual({
      ssid: 'Home',
      password: 'secret',
      encryption: 'WEP',
      hidden: false,
    });
  });

  it('treats a missing T as an open network', () => {
    expect(parseWifiPayload('WIFI:S:Open;;')?.encryption).toBe('nopass');
  });

  it('returns null for a payload that is not Wi-Fi, or has no SSID', () => {
    expect(parseWifiPayload('https://example.com')).toBeNull();
    expect(parseWifiPayload('WIFI:T:WPA;P:x;;')).toBeNull();
    expect(parseWifiPayload('WIFI:S:;P:x;;')).toBeNull();
  });
});

describe('parseVCardPayload', () => {
  it('parses what qr-code-generator emits', () => {
    const payload = buildPayload({
      kind: 'vcard',
      firstName: 'Ada',
      lastName: 'Lovelace',
      org: 'Analytical Engines',
      phone: '+44 20 7946 0000',
      email: 'ada@example.com',
    });
    expect(parseVCardPayload(payload)).toMatchObject({
      name: 'Ada Lovelace',
      org: 'Analytical Engines',
      phone: '+44 20 7946 0000',
      email: 'ada@example.com',
    });
  });

  it('ignores property parameters like TEL;TYPE=CELL', () => {
    const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nTEL;TYPE=CELL:+15550100\r\nEND:VCARD';
    expect(parseVCardPayload(card)).toEqual({ phone: '+15550100' });
  });

  it('returns null for anything that is not a vCard', () => {
    expect(parseVCardPayload('BEGIN:VEVENT\nEND:VEVENT')).toBeNull();
    expect(parseVCardPayload('just text')).toBeNull();
  });
});

describe('safeLinkUrl', () => {
  it('accepts http and https', () => {
    expect(safeLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLinkUrl('  http://example.com  ')).toBe('http://example.com/');
  });

  it('refuses every scheme that could execute or exfiltrate', () => {
    // A printed sticker must not be able to hand the page a runnable href.
    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'HTTPS:not a url',
    ]) {
      expect(safeLinkUrl(hostile), hostile).toBeNull();
    }
  });

  it('refuses mailto and tel — real, but not things to render as a web link', () => {
    expect(safeLinkUrl('mailto:a@example.com')).toBeNull();
    expect(safeLinkUrl('tel:+15550100')).toBeNull();
  });
});

describe('classifyPayload', () => {
  it('picks the right kind for each payload the generator can make', () => {
    expect(classifyPayload(buildPayload({ kind: 'wifi', ssid: 'X' })).kind).toBe('wifi');
    expect(classifyPayload(buildPayload({ kind: 'vcard', firstName: 'X' })).kind).toBe('vcard');
    expect(classifyPayload(buildPayload({ kind: 'url', url: 'https://x.test' })).kind).toBe('url');
    expect(classifyPayload(buildPayload({ kind: 'tel', phone: '+1' })).kind).toBe('text');
    expect(classifyPayload('5901234123457').kind).toBe('text');
  });

  it('carries the parsed value through, not just the kind', () => {
    const p = classifyPayload('https://example.com/x');
    expect(p).toEqual({ kind: 'url', url: 'https://example.com/x' });
  });
});
