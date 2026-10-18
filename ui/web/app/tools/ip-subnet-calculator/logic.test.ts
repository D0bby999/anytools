import { describe, expect, it } from 'vitest';
import { calculateSubnet, formatIpv4, parseIpv4, toBinaryOctets } from './logic';

describe('parseIpv4 / formatIpv4', () => {
  it('roundtrips', () => {
    for (const ip of ['0.0.0.0', '255.255.255.255', '192.168.1.42', '10.0.0.1']) {
      expect(formatIpv4(parseIpv4(ip) as number)).toBe(ip);
    }
  });
  it('rejects invalid', () => {
    expect(parseIpv4('256.1.1.1')).toBeNull();
    expect(parseIpv4('1.2.3')).toBeNull();
    expect(parseIpv4('a.b.c.d')).toBeNull();
    expect(parseIpv4('1.2.3.4.5')).toBeNull();
  });
});

describe('calculateSubnet', () => {
  it('computes a standard /24', () => {
    const info = calculateSubnet('192.168.1.130/24');
    expect(info).toMatchObject({
      networkAddress: '192.168.1.0',
      broadcastAddress: '192.168.1.255',
      firstHost: '192.168.1.1',
      lastHost: '192.168.1.254',
      hostCount: 254,
      netmask: '255.255.255.0',
      wildcardMask: '0.0.0.255',
      ipClass: 'C',
      isPrivate: true,
    });
  });

  it('computes a /26 split', () => {
    const info = calculateSubnet('10.0.0.200', 26);
    expect(info).toMatchObject({
      networkAddress: '10.0.0.192',
      broadcastAddress: '10.0.0.255',
      hostCount: 62,
      netmask: '255.255.255.192',
    });
  });

  it('handles /31 and /32 edge cases (RFC 3021)', () => {
    expect(calculateSubnet('10.0.0.0/31')).toMatchObject({
      hostCount: 2,
      firstHost: '10.0.0.0',
      lastHost: '10.0.0.1',
    });
    expect(calculateSubnet('10.0.0.7/32')).toMatchObject({
      hostCount: 1,
      firstHost: '10.0.0.7',
      lastHost: '10.0.0.7',
      networkAddress: '10.0.0.7',
    });
  });

  it('handles /0 without overflow', () => {
    const info = calculateSubnet('8.8.8.8/0');
    expect(info).toMatchObject({
      networkAddress: '0.0.0.0',
      broadcastAddress: '255.255.255.255',
      totalAddresses: 2 ** 32,
      isPrivate: false,
      ipClass: 'A',
      ipClassLetter: 'A',
    });
  });

  it('exposes the bare class letter beside the annotated label', () => {
    expect(calculateSubnet('224.0.0.1/24')).toMatchObject({
      ipClass: 'D (multicast)',
      ipClassLetter: 'D',
    });
    expect(calculateSubnet('240.0.0.1/24')).toMatchObject({
      ipClass: 'E (reserved)',
      ipClassLetter: 'E',
    });
  });

  it('rejects invalid prefix and ip', () => {
    expect(calculateSubnet('192.168.1.0/33')).toBeNull();
    expect(calculateSubnet('192.168.1.0/-1')).toBeNull();
    expect(calculateSubnet('192.168.1.0/abc')).toBeNull();
    expect(calculateSubnet('300.1.1.1/24')).toBeNull();
  });

  it('classifies public vs private', () => {
    expect(calculateSubnet('172.16.0.1/12')?.isPrivate).toBe(true);
    expect(calculateSubnet('172.32.0.1/12')?.isPrivate).toBe(false);
  });
});

describe('toBinaryOctets', () => {
  it('renders dotted binary', () => {
    expect(toBinaryOctets(parseIpv4('255.255.255.0') as number)).toBe(
      '11111111.11111111.11111111.00000000',
    );
  });
});
