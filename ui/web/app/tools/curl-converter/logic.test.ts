import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertCurl } from './logic';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe('convertCurl (API client)', () => {
  it('POSTs payload and returns code', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 'fetch("https://api.example.com")' }),
    });
    const out = await convertCurl('curl https://api.example.com', 'fetch');
    expect(out).toContain('fetch(');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/curl-convert',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ curl: 'curl https://api.example.com', target: 'fetch' }),
      }),
    );
  });

  it('throws on API error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Parse failed' }),
    });
    await expect(convertCurl('not a curl', 'fetch')).rejects.toThrow('Parse failed');
  });

  it('carries a code and params so the widget can localize', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Parse failed' }),
    });
    await expect(convertCurl('not a curl', 'fetch')).rejects.toMatchObject({
      code: 'apiError',
      params: { detail: 'Parse failed' },
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(convertCurl('curl x', 'python')).rejects.toMatchObject({
      code: 'requestFailed',
      params: { status: 500 },
    });
  });

  it('throws on missing code with no error message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(convertCurl('curl x', 'python')).rejects.toThrow('500');
  });
});
