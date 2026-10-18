/**
 * Parse a User-Agent string into browser / engine / OS / device.
 *
 * Written from MDN's User-Agent reference and the vendor documentation for each token; no
 * third-party parser consulted, and deliberately no ua-parser-js dependency — 20 KB for one
 * tool, when the ordering below is the entire difficulty.
 *
 * UA strings are a pile of historical lies: every browser claims to be Mozilla, Chrome claims
 * Safari, Edge claims Chrome. Detection therefore has to run MOST-SPECIFIC FIRST, and the order
 * of these tables is the algorithm. Treat results as a hint, never as a security control.
 */

import { ToolError } from '../shared/tool-error';

export type UaResult = {
  browser: { name: string; version: string };
  engine: { name: string; version: string };
  os: { name: string; version: string };
  device: { type: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'; model: string };
  raw: string;
};

type Rule = { name: string; re: RegExp };

// Order matters. Edge must precede Chrome, Chrome must precede Safari, and so on — each of
// these browsers puts the one below it in its own UA string.
const BROWSERS: Rule[] = [
  { name: 'Edge', re: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
  { name: 'Opera', re: /(?:OPR|Opera)\/([\d.]+)/ },
  { name: 'Samsung Internet', re: /SamsungBrowser\/([\d.]+)/ },
  { name: 'Vivaldi', re: /Vivaldi\/([\d.]+)/ },
  { name: 'Brave', re: /Brave\/([\d.]+)/ },
  { name: 'Chrome', re: /(?:Chrome|CriOS)\/([\d.]+)/ },
  { name: 'Firefox', re: /(?:Firefox|FxiOS)\/([\d.]+)/ },
  { name: 'Safari', re: /Version\/([\d.]+).*Safari/ },
  { name: 'Internet Explorer', re: /(?:MSIE |rv:)([\d.]+)\)?.*Trident/ },
];

const ENGINES: Rule[] = [
  { name: 'Blink', re: /Chrome\/([\d.]+)/ },
  { name: 'Gecko', re: /rv:([\d.]+).*Gecko\/\d/ },
  { name: 'WebKit', re: /AppleWebKit\/([\d.]+)/ },
  { name: 'Trident', re: /Trident\/([\d.]+)/ },
];

const OSES: Rule[] = [
  // iPadOS 13+ reports "Macintosh", so iPad must be checked before macOS.
  { name: 'iPadOS', re: /iPad.*OS ([\d_]+)/ },
  { name: 'iOS', re: /(?:iPhone|iPod).*OS ([\d_]+)/ },
  { name: 'Android', re: /Android ([\d.]+)/ },
  { name: 'Windows', re: /Windows NT ([\d.]+)/ },
  { name: 'macOS', re: /Mac OS X ([\d_.]+)/ },
  { name: 'Chrome OS', re: /CrOS \S+ ([\d.]+)/ },
  { name: 'Linux', re: /(Linux)/ },
];

const BOT = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|headless/i;

const WINDOWS_NT: Record<string, string> = {
  '10.0': '10 or 11',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
};

function match(rules: Rule[], ua: string): { name: string; version: string } {
  for (const { name, re } of rules) {
    const m = ua.match(re);
    if (m) return { name, version: (m[1] ?? '').replace(/_/g, '.') };
  }
  return { name: 'Unknown', version: '' };
}

export function parseUserAgent(raw: string): UaResult {
  const ua = raw.trim();
  if (!ua) throw new ToolError('emptyInput', 'Paste a User-Agent string.');

  const browser = match(BROWSERS, ua);
  const engine = match(ENGINES, ua);
  const os = match(OSES, ua);

  if (os.name === 'Windows') os.version = WINDOWS_NT[os.version] ?? os.version;

  let type: UaResult['device']['type'] = 'desktop';
  if (BOT.test(ua)) type = 'bot';
  else if (/iPad|Tablet|Android(?!.*Mobile)/.test(ua)) type = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/.test(ua)) type = 'mobile';
  else if (os.name === 'Unknown' && browser.name === 'Unknown') type = 'unknown';

  const model =
    ua.match(/\((?:Linux; )?Android [\d.]+; ([^;)]+)/)?.[1]?.trim() ??
    (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : '');

  return { browser, engine, os, device: { type, model }, raw: ua };
}
