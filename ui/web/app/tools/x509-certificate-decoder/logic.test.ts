// @vitest-environment node
// @peculiar/x509 verifies signatures (isSelfSigned) with real WebCrypto, which happy-dom does
// not provide. Both fixtures below are self-signed test certificates generated once with
// `openssl req -x509` and fixed explicit --not_before/--not_after dates, so "days remaining" is
// deterministic regardless of when this test runs.
import { describe, expect, it } from 'vitest';
import { parseCertificateFile, parseCertificateText } from './logic';

// CN=example.com, RSA-2048, SAN=DNS:example.com,DNS:www.example.com,IP:93.184.216.34,
// keyUsage=critical(digitalSignature,keyEncipherment), extKeyUsage=serverAuth,clientAuth,
// basicConstraints=critical,CA:FALSE. Valid 2024-01-01 .. 2034-01-01.
const MAIN_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIEODCCAyCgAwIBAgIUUY2tylcU6VoSZt+bnVYDxfYwjJ8wDQYJKoZIhvcNAQEL
BQAwfTELMAkGA1UEBhMCVVMxEzARBgNVBAgMCkNhbGlmb3JuaWExFjAUBgNVBAcM
DVNhbiBGcmFuY2lzY28xFTATBgNVBAoMDEV4YW1wbGUgQ29ycDEUMBIGA1UECwwL
RW5naW5lZXJpbmcxFDASBgNVBAMMC2V4YW1wbGUuY29tMB4XDTI0MDEwMTAwMDAw
MFoXDTM0MDEwMTAwMDAwMFowfTELMAkGA1UEBhMCVVMxEzARBgNVBAgMCkNhbGlm
b3JuaWExFjAUBgNVBAcMDVNhbiBGcmFuY2lzY28xFTATBgNVBAoMDEV4YW1wbGUg
Q29ycDEUMBIGA1UECwwLRW5naW5lZXJpbmcxFDASBgNVBAMMC2V4YW1wbGUuY29t
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0DqRjDiqVqSlsP+8wL9f
A55Aa0ivR9bqY0LI6cbOw4k2yxLbGCeO9NbMr79My86ylyZGkHXpOeLSM2WrSWmf
33PKmv/n1Ys4ocTx4bJvxIzaT1BBEhQqO58ezhPl4haOffEwqP0yqaI8KSS4PlOV
0aL0TvXvKPUfeR/n6jdoFbSycKTIoNi0bRaIHDIqgZDGhHKfikPatb5GGU8VY8o+
ltRAeTRIeioCzSyLDwKl18EX1bKqeHwMiAhIYLYKb7bbbZKw1Bp3bjifpFMG7fnB
DAvYuTjhiGD8LGIA7m7qDq+mEE1BdTh+j1gLq7SOALOzqMcXI70xfbNrTLFxziS0
GQIDAQABo4GvMIGsMB0GA1UdDgQWBBS/TIS+/G4iiPHX3t/CxnGplZmsxjAfBgNV
HSMEGDAWgBS/TIS+/G4iiPHX3t/CxnGplZmsxjAtBgNVHREEJjAkggtleGFtcGxl
LmNvbYIPd3d3LmV4YW1wbGUuY29thwRduNgiMA4GA1UdDwEB/wQEAwIFoDAdBgNV
HSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDAYDVR0TAQH/BAIwADANBgkqhkiG
9w0BAQsFAAOCAQEANOb84V/PSBWDEA3A0UuVUD2gfllCn5yQm5W/inESU72PYVb2
fzsXJNq2RU6nXGxiSM03veYUQBtgJ8sQxuZ8Ahq56yEQC/6hQC9hX2JA3K0kiwwB
tmcgsPTwOHQY8ZMhV/GWEwaHeV6tlW6HNHeuIM6iAZbGLJE+UyKoxk2L0Q+jqeqD
b6VIvMqaTenXwE2aTMcmEhYqjx3p/4WMCxI27SQHpc2EoLHV0G4/q3NvYgJczx0y
p+YiR8clqb5CNF+Jsy/Cv+FLPBa3rxYNciK17U/CmrpTj/5wHAkcWoeTgr4YVCYb
jsAJL/1jhxbJljBK+L0S9kFasK6O/m8eNdhcrA==
-----END CERTIFICATE-----
`;

// CN=expired.example.com, self-signed, valid 2020-01-01 .. 2021-01-01 (basicConstraints CA:TRUE,
// no SAN/keyUsage extensions) — used only to exercise the "already expired" branch.
const EXPIRED_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDHTCCAgWgAwIBAgIUZPt3vlglVATe6HT5OK2z/B0NKPowDQYJKoZIhvcNAQEL
BQAwHjEcMBoGA1UEAwwTZXhwaXJlZC5leGFtcGxlLmNvbTAeFw0yMDAxMDEwMDAw
MDBaFw0yMTAxMDEwMDAwMDBaMB4xHDAaBgNVBAMME2V4cGlyZWQuZXhhbXBsZS5j
b20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDajkee46iwmefM0lCv
wYizb9vSpRKHrfpbtclqVDvh5UhRZfCugN3McUhw64q57a0qaTA2QhTt7YyGi/C/
xCe3mCJN7vMdMV/GMJwIxTrG45pM13BFFKbx8qq8YG0iqXhvZonHT5iWsdRZNFVC
cuaAPxHbJIsMxJ9COYsh0GJPpGOKI2AEd82nnydQvBImZ74tpxH+1BL1DQqykuTn
yLHbXuHxXvpun17sr6MNeELzZ8IT3kkS6WgU6GAvRvOubi81P4NV6T1BxwnNTE5Y
U8eBazOTqiQoZN0xSq/F0BaEZ5onm0uPBKKi/YGFTxmeMtj3F1cz5HjH58rD1htJ
rlxVAgMBAAGjUzBRMB0GA1UdDgQWBBRJ/CT9/jn313xCpoS3R+nq/DG2GjAfBgNV
HSMEGDAWgBRJ/CT9/jn313xCpoS3R+nq/DG2GjAPBgNVHRMBAf8EBTADAQH/MA0G
CSqGSIb3DQEBCwUAA4IBAQAg7VqIp67r1eaBjVC73AS3trFzpDLb7sq7GypT+AYr
wbBbie8dnjaBFkq/3s6VbDH0trU/MS9ipBBau8LLsaA41R/dlNXieefX/uh4D/R6
MlOtqQ7pu1Jgb41r1ul2lxuBwg37f1Eou3XbP951N2//dzzWfqe0fYGFyyE8OKKR
Xh3Bva77iyD4yiACsnoIWVo0S0c4w6QQA9IA4bEdfQJWOGZrEYUIzO4SZat9/eD5
DBoP7STMCh2A+22s+LBwvDVzFub0+jKIKKdBXOiHjehG3jlGBjHd5s/KIgbMa7Zu
0adsH9R3lZ1PyQQ6RRf3OYyIOcXyP+g1izT1MVhfc1qU
-----END CERTIFICATE-----
`;

describe('parseCertificateText — main fixture (all fields)', () => {
  it('extracts subject, issuer, serial, validity and public key', async () => {
    const [cert] = await parseCertificateText(MAIN_CERT_PEM);
    expect(cert).toBeDefined();
    expect(cert?.subject).toContain('CN=example.com');
    expect(cert?.issuer).toBe(cert?.subject); // self-signed: issuer === subject
    expect(cert?.serialNumber).toBe('51:8D:AD:CA:57:14:E9:5A:12:66:DF:9B:9D:56:03:C5:F6:30:8C:9F');
    expect(cert?.notBefore.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(cert?.notAfter.toISOString()).toBe('2034-01-01T00:00:00.000Z');
    expect(cert?.publicKey).toEqual({ algorithm: 'RSA', keySize: 2048 });
    expect(cert?.signatureAlgorithm).toBe('SHA-256 with RSASSA-PKCS1-v1_5');
  });

  it('parses SAN entries in order', async () => {
    const [cert] = await parseCertificateText(MAIN_CERT_PEM);
    expect(cert?.san).toEqual([
      { type: 'dns', value: 'example.com' },
      { type: 'dns', value: 'www.example.com' },
      { type: 'ip', value: '93.184.216.34' },
    ]);
  });

  it('decodes key usage and extended key usage', async () => {
    const [cert] = await parseCertificateText(MAIN_CERT_PEM);
    expect(cert?.keyUsageIds.sort()).toEqual(['digitalSignature', 'keyEncipherment'].sort());
    expect(cert?.extendedKeyUsageIds.sort()).toEqual(['clientAuth', 'serverAuth'].sort());
    expect(cert?.basicConstraints).toEqual({ isCa: false, pathLengthConstraint: undefined });
  });

  it('computes fingerprints and self-signed status', async () => {
    const [cert] = await parseCertificateText(MAIN_CERT_PEM);
    expect(cert?.fingerprintSha256).toBe(
      '0B:FD:A0:C5:A4:D7:D4:5D:A4:55:69:17:7F:71:00:55:69:D0:AE:1C:8D:94:57:35:4E:4A:D3:16:B6:72:D2:56',
    );
    expect(cert?.fingerprintSha1).toBe(
      '64:A0:3C:C1:D3:D1:85:4E:84:81:8B:93:24:11:B6:02:EF:DE:5B:9B',
    );
    expect(cert?.isSelfSigned).toBe(true);
  });

  it('flags an expired certificate with a negative days-remaining count', async () => {
    const [cert] = await parseCertificateText(EXPIRED_CERT_PEM);
    expect(cert?.isExpired).toBe(true);
    expect(cert?.isNotYetValid).toBe(false);
    expect(cert?.daysRemaining).toBeLessThan(0);
  });

  it('reports the still-valid fixture as neither expired nor not-yet-valid', async () => {
    const [cert] = await parseCertificateText(MAIN_CERT_PEM);
    expect(cert?.isExpired).toBe(false);
    expect(cert?.isNotYetValid).toBe(false);
    expect(cert?.daysRemaining).toBeGreaterThan(365); // valid until 2034
  });
});

describe('parseCertificateText — chains and errors', () => {
  it('parses a multi-certificate PEM in file order', async () => {
    const certs = await parseCertificateText(`${MAIN_CERT_PEM}\n${EXPIRED_CERT_PEM}`);
    expect(certs).toHaveLength(2);
    expect(certs[0]?.subject).toContain('example.com');
    expect(certs[0]?.subject).not.toContain('expired');
    expect(certs[1]?.subject).toContain('expired.example.com');
  });

  it('rejects text with no BEGIN CERTIFICATE block', async () => {
    await expect(parseCertificateText('not a certificate at all')).rejects.toThrow(
      /BEGIN CERTIFICATE/,
    );
  });

  it('rejects a PEM block with corrupt base64 content', async () => {
    const bad = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';
    await expect(parseCertificateText(bad)).rejects.toThrow(/Could not read this/);
  });
});

describe('parseCertificateFile — DER and PEM-in-a-file', () => {
  it('parses a PEM certificate saved with a .crt extension', async () => {
    const file = new File([MAIN_CERT_PEM], 'example.crt', { type: 'application/x-x509-ca-cert' });
    const [cert] = await parseCertificateFile(file);
    expect(cert?.subject).toContain('CN=example.com');
  });

  it('parses raw DER bytes (no PEM markers)', async () => {
    const base64Body = MAIN_CERT_PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(base64Body), (c) => c.charCodeAt(0));
    const file = new File([der], 'example.der', { type: 'application/x-x509-ca-cert' });
    const [cert] = await parseCertificateFile(file);
    expect(cert?.subject).toContain('CN=example.com');
    expect(cert?.serialNumber).toBe('51:8D:AD:CA:57:14:E9:5A:12:66:DF:9B:9D:56:03:C5:F6:30:8C:9F');
  });
});
