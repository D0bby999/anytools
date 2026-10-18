/**
 * Break a URL into its parts.
 * Implemented against the WHATWG URL Standard using the platform `URL` class — the browser
 * already contains a conforming parser, and a hand-rolled regex would disagree with it.
 * No third-party source consulted.
 */

import { ToolError } from '../shared/tool-error';

export class UrlParseError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'UrlParseError';
  }
}

export type QueryParam = { key: string; value: string };

export type ParsedUrl = {
  href: string;
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  /** Effective port, filled in from the protocol when not stated. */
  effectivePort: string;
  pathname: string;
  /** Path split on "/", empty segments dropped. */
  segments: string[];
  search: string;
  params: QueryParam[];
  hash: string;
  origin: string;
};

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};

export function parseUrl(input: string): ParsedUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new UrlParseError('emptyUrl', 'Enter a URL.');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // The overwhelmingly common mistake is a missing scheme. Retry with https rather than
    // making the user retype, but only when the input has no scheme-like prefix at all.
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      throw new UrlParseError('invalidUrl', `"${trimmed}" is not a valid URL.`, { url: trimmed });
    }
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      throw new UrlParseError('invalidUrl', `"${trimmed}" is not a valid URL.`, { url: trimmed });
    }
  }

  // getAll, not entries: ?a=1&a=2 is legal and meaningful, and a Record would drop one.
  const params: QueryParam[] = [...url.searchParams.entries()].map(([key, value]) => ({
    key,
    value,
  }));

  return {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    effectivePort: url.port || DEFAULT_PORTS[url.protocol] || '',
    pathname: url.pathname,
    segments: url.pathname.split('/').filter(Boolean).map(decodeSegment),
    search: url.search,
    params,
    hash: url.hash,
    origin: url.origin,
  };
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // A stray % that is not a valid escape — show it as written rather than throwing.
    return s;
  }
}
