import { describe, expect, it } from 'vitest';
import { parseUserAgent } from './logic';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/124.0.2478.51`;
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

describe('parseUserAgent', () => {
  it('does not call Chrome "Safari" — Chrome puts Safari in its own UA', () => {
    expect(parseUserAgent(CHROME).browser.name).toBe('Chrome');
  });

  it('does not call Edge "Chrome" — Edge puts Chrome in its own UA', () => {
    // This ordering is the whole difficulty of UA parsing. EDGE contains the full Chrome
    // string, so a table checked in the wrong order reports Chrome for every Edge user.
    expect(parseUserAgent(EDGE).browser).toEqual({ name: 'Edge', version: '124.0.2478.51' });
  });

  it('identifies real Safari', () => {
    const r = parseUserAgent(SAFARI);
    expect(r.browser).toEqual({ name: 'Safari', version: '17.4' });
    expect(r.os.name).toBe('macOS');
    expect(r.os.version).toBe('10.15.7');
  });

  it('translates iOS underscore versions', () => {
    const r = parseUserAgent(IPHONE);
    expect(r.os).toEqual({ name: 'iOS', version: '17.4' });
    expect(r.device.type).toBe('mobile');
    expect(r.device.model).toBe('iPhone');
  });

  it('reads an Android device model', () => {
    const r = parseUserAgent(ANDROID);
    expect(r.os).toEqual({ name: 'Android', version: '14' });
    expect(r.device.model).toBe('Pixel 8');
    expect(r.device.type).toBe('mobile');
  });

  it('reports Gecko for Firefox, not WebKit', () => {
    const r = parseUserAgent(FIREFOX);
    expect(r.browser.name).toBe('Firefox');
    expect(r.engine.name).toBe('Gecko');
  });

  it('flags bots', () => {
    expect(parseUserAgent(GOOGLEBOT).device.type).toBe('bot');
  });

  it('translates Windows NT numbers, and admits 10 and 11 are indistinguishable', () => {
    // Windows 11 still reports NT 10.0. Claiming to tell them apart would be a lie.
    expect(parseUserAgent(CHROME).os).toEqual({ name: 'Windows', version: '10 or 11' });
  });

  it('rejects empty input', () => {
    expect(() => parseUserAgent('   ')).toThrow(/Paste a User-Agent/);
    expect(() => parseUserAgent('   ')).toThrow(expect.objectContaining({ code: 'emptyInput' }));
  });

  it('degrades to Unknown rather than guessing on nonsense', () => {
    const r = parseUserAgent('definitely not a user agent');
    expect(r.browser.name).toBe('Unknown');
    expect(r.device.type).toBe('unknown');
  });
});
