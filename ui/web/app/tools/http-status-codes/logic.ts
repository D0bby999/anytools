/**
 * HTTP status code + MIME type reference data. Codes/names are IETF-standard
 * facts (RFC 9110 et al.); the short explanations are our own wording.
 */

export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

export type StatusCode = {
  code: number;
  name: string;
  description: string;
};

export const STATUS_CODES: StatusCode[] = [
  {
    code: 100,
    name: 'Continue',
    description: 'Request headers accepted — client may send the body.',
  },
  {
    code: 101,
    name: 'Switching Protocols',
    description: 'Server agrees to switch protocol (e.g. HTTP → WebSocket upgrade).',
  },
  {
    code: 102,
    name: 'Processing',
    description: 'WebDAV: request received, still working — prevents client timeout.',
  },
  {
    code: 103,
    name: 'Early Hints',
    description: 'Preload hints sent before the final response, so browsers fetch assets sooner.',
  },
  {
    code: 200,
    name: 'OK',
    description: 'Standard success — the response body carries the result.',
  },
  {
    code: 201,
    name: 'Created',
    description: 'Resource created; Location header usually points to it.',
  },
  {
    code: 202,
    name: 'Accepted',
    description: 'Request queued for async processing — no promise it will finish.',
  },
  {
    code: 204,
    name: 'No Content',
    description: 'Success with an intentionally empty body (common for DELETE/PUT).',
  },
  {
    code: 206,
    name: 'Partial Content',
    description: 'Byte-range response — used by video streaming and resumable downloads.',
  },
  {
    code: 301,
    name: 'Moved Permanently',
    description: 'Permanent redirect; browsers and search engines update their references.',
  },
  {
    code: 302,
    name: 'Found',
    description: 'Temporary redirect; method may change to GET on follow.',
  },
  {
    code: 304,
    name: 'Not Modified',
    description:
      'Cached copy is still valid — sent for conditional requests (ETag / If-Modified-Since).',
  },
  {
    code: 307,
    name: 'Temporary Redirect',
    description: 'Like 302 but the method and body must not change.',
  },
  {
    code: 308,
    name: 'Permanent Redirect',
    description: 'Like 301 but the method and body must not change.',
  },
  {
    code: 400,
    name: 'Bad Request',
    description: 'Malformed request — syntax, framing, or invalid parameters.',
  },
  {
    code: 401,
    name: 'Unauthorized',
    description: 'Authentication missing or invalid — really means "unauthenticated".',
  },
  {
    code: 403,
    name: 'Forbidden',
    description: 'Authenticated but not allowed — credentials won’t help.',
  },
  {
    code: 404,
    name: 'Not Found',
    description: 'No resource at this URL (or the server hides its existence).',
  },
  {
    code: 405,
    name: 'Method Not Allowed',
    description: 'URL exists but not for this HTTP method — check the Allow header.',
  },
  {
    code: 406,
    name: 'Not Acceptable',
    description: 'Server cannot produce a representation matching the Accept headers.',
  },
  {
    code: 408,
    name: 'Request Timeout',
    description: 'Client took too long to send the full request.',
  },
  {
    code: 409,
    name: 'Conflict',
    description: 'Request clashes with current resource state (e.g. concurrent edit).',
  },
  {
    code: 410,
    name: 'Gone',
    description: 'Deliberately removed, permanently — stronger signal than 404.',
  },
  { code: 411, name: 'Length Required', description: 'Server insists on a Content-Length header.' },
  {
    code: 412,
    name: 'Precondition Failed',
    description: 'An If-* conditional header did not match (optimistic locking).',
  },
  {
    code: 413,
    name: 'Content Too Large',
    description: 'Request body exceeds the server’s size limit.',
  },
  {
    code: 415,
    name: 'Unsupported Media Type',
    description: 'Body format not supported (wrong Content-Type).',
  },
  {
    code: 418,
    name: "I'm a teapot",
    description: 'April-fools RFC 2324; some APIs use it for playful blocks.',
  },
  {
    code: 422,
    name: 'Unprocessable Content',
    description: 'Syntax is fine but the data fails validation rules.',
  },
  {
    code: 425,
    name: 'Too Early',
    description: 'Server refuses to risk a replayed request (TLS early data).',
  },
  {
    code: 429,
    name: 'Too Many Requests',
    description: 'Rate limit hit — Retry-After tells you when to try again.',
  },
  {
    code: 431,
    name: 'Request Header Fields Too Large',
    description: 'Headers (often cookies) exceed the server limit.',
  },
  {
    code: 451,
    name: 'Unavailable For Legal Reasons',
    description: 'Blocked for legal/censorship reasons.',
  },
  {
    code: 500,
    name: 'Internal Server Error',
    description: 'Unhandled server-side failure — the catch-all 5xx.',
  },
  {
    code: 501,
    name: 'Not Implemented',
    description: 'Server does not support this method at all.',
  },
  {
    code: 502,
    name: 'Bad Gateway',
    description: 'Proxy/load balancer got an invalid response from the upstream server.',
  },
  {
    code: 503,
    name: 'Service Unavailable',
    description: 'Temporarily overloaded or down for maintenance — retry later.',
  },
  {
    code: 504,
    name: 'Gateway Timeout',
    description: 'Proxy gave up waiting for the upstream server.',
  },
  {
    code: 505,
    name: 'HTTP Version Not Supported',
    description: 'Requested HTTP version is not supported.',
  },
  {
    code: 507,
    name: 'Insufficient Storage',
    description: 'WebDAV: server cannot store what the request requires.',
  },
  {
    code: 508,
    name: 'Loop Detected',
    description: 'WebDAV: infinite loop while processing the request.',
  },
];

export type MimeType = {
  extension: string;
  mime: string;
  label: string;
};

export const MIME_TYPES: MimeType[] = [
  { extension: '.html', mime: 'text/html', label: 'HTML document' },
  { extension: '.css', mime: 'text/css', label: 'Stylesheet' },
  { extension: '.js', mime: 'text/javascript', label: 'JavaScript' },
  { extension: '.mjs', mime: 'text/javascript', label: 'JavaScript module' },
  { extension: '.json', mime: 'application/json', label: 'JSON data' },
  { extension: '.xml', mime: 'application/xml', label: 'XML data' },
  { extension: '.txt', mime: 'text/plain', label: 'Plain text' },
  { extension: '.csv', mime: 'text/csv', label: 'CSV data' },
  { extension: '.md', mime: 'text/markdown', label: 'Markdown' },
  { extension: '.pdf', mime: 'application/pdf', label: 'PDF document' },
  { extension: '.zip', mime: 'application/zip', label: 'ZIP archive' },
  { extension: '.gz', mime: 'application/gzip', label: 'Gzip archive' },
  { extension: '.tar', mime: 'application/x-tar', label: 'Tar archive' },
  { extension: '.7z', mime: 'application/x-7z-compressed', label: '7-Zip archive' },
  { extension: '.png', mime: 'image/png', label: 'PNG image' },
  { extension: '.jpg', mime: 'image/jpeg', label: 'JPEG image' },
  { extension: '.gif', mime: 'image/gif', label: 'GIF image' },
  { extension: '.webp', mime: 'image/webp', label: 'WebP image' },
  { extension: '.avif', mime: 'image/avif', label: 'AVIF image' },
  { extension: '.svg', mime: 'image/svg+xml', label: 'SVG vector image' },
  { extension: '.ico', mime: 'image/vnd.microsoft.icon', label: 'Icon file' },
  { extension: '.mp3', mime: 'audio/mpeg', label: 'MP3 audio' },
  { extension: '.wav', mime: 'audio/wav', label: 'WAV audio' },
  { extension: '.ogg', mime: 'audio/ogg', label: 'Ogg audio' },
  { extension: '.mp4', mime: 'video/mp4', label: 'MP4 video' },
  { extension: '.webm', mime: 'video/webm', label: 'WebM video' },
  { extension: '.woff2', mime: 'font/woff2', label: 'WOFF2 web font' },
  { extension: '.woff', mime: 'font/woff', label: 'WOFF web font' },
  { extension: '.ttf', mime: 'font/ttf', label: 'TrueType font' },
  { extension: '.otf', mime: 'font/otf', label: 'OpenType font' },
  { extension: '.wasm', mime: 'application/wasm', label: 'WebAssembly binary' },
  { extension: '.ics', mime: 'text/calendar', label: 'iCalendar event' },
  { extension: '.doc', mime: 'application/msword', label: 'Word (legacy)' },
  {
    extension: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word document',
  },
  { extension: '.xls', mime: 'application/vnd.ms-excel', label: 'Excel (legacy)' },
  {
    extension: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel spreadsheet',
  },
  { extension: '.ppt', mime: 'application/vnd.ms-powerpoint', label: 'PowerPoint (legacy)' },
  {
    extension: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PowerPoint presentation',
  },
  { extension: '.bin', mime: 'application/octet-stream', label: 'Arbitrary binary' },
  { extension: '.apk', mime: 'application/vnd.android.package-archive', label: 'Android package' },
];

export function classOfCode(code: number): StatusClass {
  return `${Math.floor(code / 100)}xx` as StatusClass;
}

export function searchStatusCodes(query: string, klass?: StatusClass): StatusCode[] {
  const q = query.trim().toLowerCase();
  return STATUS_CODES.filter((entry) => {
    if (klass && classOfCode(entry.code) !== klass) return false;
    if (!q) return true;
    return (
      String(entry.code).includes(q) ||
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q)
    );
  });
}

export function searchMimeTypes(query: string): MimeType[] {
  const q = query.trim().toLowerCase();
  if (!q) return MIME_TYPES;
  return MIME_TYPES.filter(
    (entry) =>
      entry.extension.includes(q) ||
      entry.mime.toLowerCase().includes(q) ||
      entry.label.toLowerCase().includes(q),
  );
}
