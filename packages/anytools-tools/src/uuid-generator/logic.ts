import { validate as uuidValidate, version as uuidVersion, v1, v4, v7 } from 'uuid';

export type UuidVersion = 'v1' | 'v4' | 'v7';

export function generateUuid(version: UuidVersion = 'v7', count = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (version === 'v1') out.push(v1());
    else if (version === 'v4') out.push(v4());
    else out.push(v7());
  }
  return out;
}

export function formatUuid(
  uuid: string,
  options: { uppercase?: boolean; dashes?: boolean },
): string {
  let s = uuid;
  if (options.dashes === false) s = s.replace(/-/g, '');
  if (options.uppercase) s = s.toUpperCase();
  return s;
}

export type UuidInspection = {
  valid: boolean;
  version: number | null;
  variant: string;
};

export function inspectUuid(input: string): UuidInspection {
  const normalized = input.trim().toLowerCase();
  const valid = uuidValidate(normalized);
  if (!valid) return { valid: false, version: null, variant: 'invalid' };
  const v = uuidVersion(normalized);
  return { valid: true, version: v, variant: detectVariant(normalized) };
}

function detectVariant(uuid: string): string {
  // The variant is encoded in the high bits of the 9th hex digit (after stripping dashes, position 16)
  const stripped = uuid.replace(/-/g, '');
  const variantNibble = Number.parseInt(stripped[16] ?? '0', 16);
  if ((variantNibble & 0b1000) === 0) return 'NCS (legacy)';
  if ((variantNibble & 0b1100) === 0b1000) return 'RFC 4122';
  if ((variantNibble & 0b1110) === 0b1100) return 'Microsoft';
  return 'Reserved';
}
