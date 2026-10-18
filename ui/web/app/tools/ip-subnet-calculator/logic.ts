/**
 * IPv4 CIDR subnet math — pure integer arithmetic, no deps.
 * All IPs handled as unsigned 32-bit numbers (>>> 0 keeps them unsigned).
 */

export type SubnetInfo = {
  cidr: string;
  networkAddress: string;
  broadcastAddress: string;
  firstHost: string;
  lastHost: string;
  hostCount: number; // usable hosts
  totalAddresses: number;
  netmask: string;
  wildcardMask: string;
  prefix: number;
  /** English label, kept for callers that render it as-is; `ipClassLetter` is the bare id. */
  ipClass: 'A' | 'B' | 'C' | 'D (multicast)' | 'E (reserved)';
  ipClassLetter: 'A' | 'B' | 'C' | 'D' | 'E';
  isPrivate: boolean;
  binaryNetmask: string;
  binaryAddress: string;
};

export function parseIpv4(input: string): number | null {
  const parts = input.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

export function formatIpv4(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

export function toBinaryOctets(value: number): string {
  return formatIpv4(value)
    .split('.')
    .map((o) => Number(o).toString(2).padStart(8, '0'))
    .join('.');
}

function classOf(ip: number): SubnetInfo['ipClass'] {
  const first = (ip >>> 24) & 255;
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D (multicast)';
  return 'E (reserved)';
}

function isPrivateIp(ip: number): boolean {
  const first = (ip >>> 24) & 255;
  const second = (ip >>> 16) & 255;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Accepts "a.b.c.d/nn" or separate ip + prefix. Returns null on invalid input. */
export function calculateSubnet(cidrOrIp: string, prefixInput?: number): SubnetInfo | null {
  let ipPart = cidrOrIp.trim();
  let prefix = prefixInput;
  const slash = ipPart.indexOf('/');
  if (slash !== -1) {
    const parsedPrefix = Number(ipPart.slice(slash + 1));
    ipPart = ipPart.slice(0, slash);
    if (!Number.isInteger(parsedPrefix)) return null;
    prefix = parsedPrefix;
  }
  if (prefix === undefined || prefix < 0 || prefix > 32) return null;
  const ip = parseIpv4(ipPart);
  if (ip === null) return null;

  const netmask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & netmask) >>> 0;
  const broadcast = (network | (~netmask >>> 0)) >>> 0;
  const totalAddresses = 2 ** (32 - prefix);
  // /31 (RFC 3021 point-to-point) and /32 have no network/broadcast split.
  const hostCount = prefix >= 31 ? totalAddresses : Math.max(0, totalAddresses - 2);
  const firstHost = prefix >= 31 ? network : network + 1;
  const lastHost = prefix >= 31 ? broadcast : broadcast - 1;

  return {
    cidr: `${formatIpv4(network)}/${prefix}`,
    networkAddress: formatIpv4(network),
    broadcastAddress: formatIpv4(broadcast),
    firstHost: formatIpv4(firstHost),
    lastHost: formatIpv4(lastHost),
    hostCount,
    totalAddresses,
    netmask: formatIpv4(netmask),
    wildcardMask: formatIpv4(~netmask >>> 0),
    prefix,
    ipClass: classOf(ip),
    ipClassLetter: classOf(ip)[0] as SubnetInfo['ipClassLetter'],
    isPrivate: isPrivateIp(ip),
    binaryNetmask: toBinaryOctets(netmask),
    binaryAddress: toBinaryOctets(ip),
  };
}
