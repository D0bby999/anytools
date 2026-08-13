import { createHmac } from 'node:crypto';
import { createPostclawHandlers } from '../route-handlers';
import type { PostclawEndpointConfig } from '../types';
import { FakeBlogStore, FakeIdempotencyStore } from './fakes';

export const TOKEN = 'test-token-0123456789abcdef0123456789abcdef';
export const SITE = 'https://besttoys.world';

export type TestContext = {
  blogStore: FakeBlogStore;
  idemStore: FakeIdempotencyStore;
  handlers: ReturnType<typeof createPostclawHandlers>;
};

export function makeContext(overrides: Partial<PostclawEndpointConfig> = {}): TestContext {
  const blogStore = new FakeBlogStore();
  const idemStore = new FakeIdempotencyStore();
  const handlers = createPostclawHandlers({
    token: TOKEN,
    siteBaseUrl: SITE,
    allowedCategories: ['stem-kits', 'robotics'],
    blogStore,
    idempotencyStore: idemStore,
    ...overrides,
  });
  return { blogStore, idemStore, handlers };
}

export function sign(body: string, token = TOKEN): string {
  return `sha256=${createHmac('sha256', token).update(body, 'utf8').digest('hex')}`;
}

export function request(
  method: string,
  body: string | null,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://example.test/api/postclaw/posts', {
    method,
    body,
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
  });
}

export function signedPost(payload: Record<string, unknown>, idemKey?: string): Request {
  const body = JSON.stringify(payload);
  return request('POST', body, {
    'x-postclaw-signature': sign(body),
    ...(idemKey ? { 'idempotency-key': idemKey } : {}),
  });
}

export function signedPatch(payload: Record<string, unknown>, idemKey?: string): Request {
  const body = JSON.stringify(payload);
  return request('PATCH', body, {
    'x-postclaw-signature': sign(body),
    ...(idemKey ? { 'idempotency-key': idemKey } : {}),
  });
}

export const patchCtx = (id: string) => ({ params: Promise.resolve({ id }) });

export const CREATE_PAYLOAD = {
  title: 'AI is reshaping social media',
  content_html: '<p>Hello <strong>world</strong></p>',
  external_id: 'postclaw_11111111-aaaa',
  tags: ['ai'],
  status: 'published',
};
