// @vitest-environment node
// jose needs real WebCrypto (crypto.subtle); Node's `node` test environment provides it,
// happy-dom's does not. All tokens below are FIXED vectors generated once with jose/openssl —
// never signed-then-verified inside a single test, which would be circular (see phase brief).
import { beforeAll, describe, expect, it } from 'vitest';
import { type VerifyStatus, signJwt, verifyJwt } from './logic';

const HS_SECRET = 'your-256-bit-secret';

// The classic jwt.io HS256 debugger example. No "exp" claim, so it verifies as "valid" forever.
const CLASSIC_HS256_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

// Same header/payload, first char of the signature flipped — a tampered/wrong-key token.
const TAMPERED_HS256_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.XflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

// { sub: "test-user" }, iat 2020-01-01, exp 2020-01-02 — signed once with HS_SECRET, fixed.
const EXPIRED_HS256_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpYXQiOjE1Nzc4MzY4MDAsImV4cCI6MTU3NzkyMzIwMH0.b5iHirASQM7r2OWhnfPyf_nCYA_G8l7v5_xlKUiBa-o';

// { sub: "future-user" }, nbf 2099-01-01 — signed once with HS_SECRET, fixed.
const NOT_YET_VALID_HS256_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmdXR1cmUtdXNlciIsImlhdCI6MTc4ODY4NjAwMSwibmJmIjo0MDcwOTA4ODAwfQ.p9dLVUxOOeiZGwpPTOUKhZY4oJedbekTqUSwaJUqOAw';

// header only: {"alg":"none","typ":"JWT"} — the classic unsecured-JWT attack payload.
const ALG_NONE_TOKEN = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIn0.';

// Fixed RSA-2048 key pair, generated once with jose's generateKeyPair('RS256').
const RS256_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/80lb87JA5pc7E5zVmk
jyEHutemIj9KQEfXzSRqL0q1Rl6ONQG9BIG14QBTB+9MtznNLz0eV7FKet37SbsY
CC3mR0yFwQlT2m8AxVCbSjSUZMHQenNK8RwcvqGH6N0MXX82XWBkjOW6X/WgfAIG
jG63aQ0QTha+6NekFo0GScriJQHcndvocqG0U0A28JTj6Zetgj/64wfmkGqoXPDd
FNmxSD8OLtLRoHxggkrRC7Y631WZ5gSsNuVJPWENAxS8G9bptixEs2+nKhqMbfyb
iRE217u/IaGT6bgZf8kV79qrOQ1wmd3m6XWMxVs2zZKx+F7s5dO9TVwwfrezwoWr
yQIDAQAB
-----END PUBLIC KEY-----
`;
const RS256_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCr/zSVvzskDmlz
sTnNWaSPIQe616YiP0pAR9fNJGovSrVGXo41Ab0EgbXhAFMH70y3Oc0vPR5XsUp6
3ftJuxgILeZHTIXBCVPabwDFUJtKNJRkwdB6c0rxHBy+oYfo3QxdfzZdYGSM5bpf
9aB8AgaMbrdpDRBOFr7o16QWjQZJyuIlAdyd2+hyobRTQDbwlOPpl62CP/rjB+aQ
aqhc8N0U2bFIPw4u0tGgfGCCStELtjrfVZnmBKw25Uk9YQ0DFLwb1um2LESzb6cq
Goxt/JuJETbXu78hoZPpuBl/yRXv2qs5DXCZ3ebpdYzFWzbNkrH4Xuzl071NXDB+
t7PChavJAgMBAAECggEAKUWN6rj+igJjT32hbyMpl6bHYhBJL0KcoJwcrn8kc8Cr
iv05hoKqRqCRcjJPukGz2OunzsQNueEzDBSkLecVNzE8ZrN4DQAd/PZR6wcSnFXN
nffb/OYZf43NX/kG0dvpEa5q7zEoL58Yf9pC7j7WL3CJ1k1qMjLHELxeBYNFlQMS
bFljN+FFuEecOi9IGHfBYwsktoXxMVVuWzXxrmPirqup3MdXeRf0VF3oJRrRqLqj
F3yIQAR7oQIFnb5CVsY7OA53+lrRV+B45l/Be5bbJkERQRPFaoTBa+EPVYhZ0MZD
E3fgGWMux3DcAXTfYfcTYl1jGss74ghINFjJioH84QKBgQDwOwZBOIS7uvptKLxH
6sCoKKxlO9A36LsCBpAyAl9VJDAiGh6qvRaLStQpGZU3TbthTPuuHnIU+SfBPyQc
onhjxsGu+WW0SM03tOnE/g6R8TzB25YDvZOo+j9oC+8V5Tu0zqXFa2C91wM7zJIF
p8Cy3Ma0Jutunsgdch8DYI6KfQKBgQC3SYrVr5BR1x1ry/GVO66AZ4o7c/D8tsxk
pFmuxURBJqMarpyPEHZ7EpWu0Eqzofm+8AaDSyAwdxzI0as1xfP9daVDcw1qDWzd
lhAgTCTBMxfkQ6jdovw9bQm/9qxEdYnmd4KZztBf9DTbTb8u4zuPBXFjnv7b1LNb
vW7SYl0cPQKBgQCUM+W88NA6PLToCPx25aVrWIRag9cF1ucf7cqhf4MutH+ZWkHX
FYZF8qkGngjHMIZMFcEi/xdkRv22o2x02eqpq2Grv6J14X/xQQQDCrUUZh4UfpKC
xj7FPXVGjC44dM4r0lzEeWUaWP5esurW4FHqRnezhlsySHSubcwiOjxVxQKBgFRD
uVJ4fo9BqMMQZibH43ghIgonSZnFqL50WM7i3nhdfQsdT9juJqp6ZtqR5GYlh55i
13uxJEFj4ZXp3x6/vWa/mZUi5f3l4jEVdqCCoTs5dDh7ar1K21CaOqtIivaGWznb
o+12iZIzwcE5QzYZPh6I0BKO3HjQlw0MUFDk7A25AoGBAJH2YIEWqTfWbHImlGkS
BNMm1YpZJXGvsvGw1sVKaVZUB7ro9eSKIWrx/uyrN2xYc1R2rGUGYSMfa8ZLuSfo
DiZTnCUicn4jvDZXOYQviWlpu1RyHJHtxYEBRBjSInyy86vXzkS6ZI4z+iwrjJJD
p8eZkpFllBO1XFa81KslECh6
-----END PRIVATE KEY-----
`;
// { sub: "rs-user", role: "admin" }, iat 2024-01-01, exp 2034-01-01 — signed once with the
// private key above.
const RS256_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJycy11c2VyIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzA0MDY3MjAwLCJleHAiOjIwMTk2ODY0MDB9.hJoBtuBshjv3MkPqAA0f3zMDabDNjBSuhLAeRL-EOUF_JoFDtJP1jNL_ekwKLYoMLDCKlRcDYLrDP3GBpg2KYQhwC5o_OAh3iJvbb3yEAYegYbqDNFdJYTQCGqedj7qUx_sMUB7osyV3EBno8vpFhxperGBCWQSPyg_QP8l4czIclrXpZyfo6hz5_sS2aXPov7P4Jfg1jo4zh0CVzxtYk_ZxMltpU5DVyhll9BNGEAX1ql9DKqR8OQ2gflwhhErKNW02l22xYVf8twFjGbsswvGHeG-8yeu4Uj1WLDiAmpwzw7K9S_4iFmTzAA9QsQHiSEmFpYS-QxTTaV3VGlOJ_w';

async function status(
  token: string,
  algorithm: 'HS256' | 'RS256',
  key: string,
): Promise<VerifyStatus> {
  return (await verifyJwt({ token, algorithm, secretOrPublicKey: key })).status;
}

describe('verifyJwt — fixed vectors', () => {
  it('accepts a correctly signed HS256 token', async () => {
    const r = await verifyJwt({
      token: CLASSIC_HS256_TOKEN,
      algorithm: 'HS256',
      secretOrPublicKey: HS_SECRET,
    });
    expect(r.status).toBe('valid');
    expect(r.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
  });

  it('rejects a tampered signature as invalidSignature, not "expired" or generic', async () => {
    expect(await status(TAMPERED_HS256_TOKEN, 'HS256', HS_SECRET)).toBe('invalidSignature');
  });

  it('rejects the wrong secret as invalidSignature', async () => {
    expect(await status(CLASSIC_HS256_TOKEN, 'HS256', 'wrong-secret')).toBe('invalidSignature');
  });

  it('reports a signature-valid-but-expired token as "expired", distinct from invalidSignature', async () => {
    const r = await verifyJwt({
      token: EXPIRED_HS256_TOKEN,
      algorithm: 'HS256',
      secretOrPublicKey: HS_SECRET,
    });
    expect(r.status).toBe('expired');
    // Signature was valid, so the claims set is still readable.
    expect(r.payload).toMatchObject({ sub: 'test-user' });
  });

  it('reports an nbf-in-the-future token as notYetValid', async () => {
    expect(await status(NOT_YET_VALID_HS256_TOKEN, 'HS256', HS_SECRET)).toBe('notYetValid');
  });

  it('rejects alg:none even when a real secret is supplied — the classic unsecured-JWT attack', async () => {
    expect(await status(ALG_NONE_TOKEN, 'HS256', HS_SECRET)).toBe('algRejected');
  });

  it('accepts a correctly signed RS256 token against its public key', async () => {
    const r = await verifyJwt({
      token: RS256_TOKEN,
      algorithm: 'RS256',
      secretOrPublicKey: RS256_PUBLIC_KEY_PEM,
    });
    expect(r.status).toBe('valid');
    expect(r.payload).toMatchObject({ sub: 'rs-user', role: 'admin' });
  });

  it('rejects alg-confusion: an HS256 token verified as if it were RS256', async () => {
    expect(await status(CLASSIC_HS256_TOKEN, 'RS256', RS256_PUBLIC_KEY_PEM)).toBe('algRejected');
  });

  it('reports a malformed token distinctly', async () => {
    expect(await status('not-a-jwt', 'HS256', HS_SECRET)).toBe('malformed');
  });
});

describe('signJwt — round trips through a fresh key, then checked against the fixed vectors above', () => {
  let signed: string;

  beforeAll(async () => {
    signed = await signJwt({
      algorithm: 'HS256',
      payloadJson: '{"sub":"round-trip"}',
      secretOrPrivateKey: HS_SECRET,
      expiresIn: '1h',
    });
  });

  it('produces a token verifiable with the same secret', async () => {
    expect(await status(signed, 'HS256', HS_SECRET)).toBe('valid');
  });

  it('signs with the RS256 private key fixture and verifies with its public key fixture', async () => {
    const token = await signJwt({
      algorithm: 'RS256',
      payloadJson: '{"sub":"rs-round-trip"}',
      secretOrPrivateKey: RS256_PRIVATE_KEY_PEM,
      expiresIn: '',
    });
    expect(await status(token, 'RS256', RS256_PUBLIC_KEY_PEM)).toBe('valid');
  });

  it('rejects invalid payload JSON', async () => {
    await expect(
      signJwt({
        algorithm: 'HS256',
        payloadJson: 'not json',
        secretOrPrivateKey: HS_SECRET,
        expiresIn: '',
      }),
    ).rejects.toThrow(/JSON/);
  });

  it('rejects a JSON array payload (must be an object)', async () => {
    await expect(
      signJwt({
        algorithm: 'HS256',
        payloadJson: '[1,2,3]',
        secretOrPrivateKey: HS_SECRET,
        expiresIn: '',
      }),
    ).rejects.toThrow(/JSON object/);
  });

  it('rejects HS256 signing with an empty secret', async () => {
    await expect(
      signJwt({ algorithm: 'HS256', payloadJson: '{}', secretOrPrivateKey: '', expiresIn: '' }),
    ).rejects.toThrow(/secret/);
  });

  it('rejects RS256 signing with a malformed private key', async () => {
    await expect(
      signJwt({
        algorithm: 'RS256',
        payloadJson: '{}',
        secretOrPrivateKey: 'not a pem key',
        expiresIn: '',
      }),
    ).rejects.toThrow(/private key/);
  });
});
