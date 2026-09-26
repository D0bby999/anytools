import { afterEach, describe, expect, it, vi } from 'vitest';

// Accounts are off on the HOSTED build too (lib/accounts.ts). self-hosted.test.ts only
// proves the auth surfaces 404 with NEXT_PUBLIC_SELF_HOSTED=1; these run with the flag
// off, which is what anytools.world actually serves.
describe('accounts disabled on the hosted build', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('/api/auth/** answers 404 to GET and POST', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.resetModules();
    const { GET, POST } = await import('../app/api/auth/[...all]/route');
    expect((await GET(new Request('http://localhost/api/auth/get-session'))).status).toBe(404);
    const signUp = new Request('http://localhost/api/auth/sign-up/email', { method: 'POST' });
    expect((await POST(signUp)).status).toBe(404);
  });

  it('requireAdmin() throws before importing better-auth', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.resetModules();
    const { requireAdmin } = await import('./auth-guards');
    await expect(requireAdmin()).rejects.toThrow('admin disabled');
  });
});
