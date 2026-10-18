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

export type UuidVariantId = 'ncs' | 'rfc4122' | 'microsoft' | 'reserved' | 'invalid';

const VARIANT_LABELS: Record<UuidVariantId, string> = {
  ncs: 'NCS (legacy)',
  rfc4122: 'RFC 4122',
  microsoft: 'Microsoft',
  reserved: 'Reserved',
  invalid: 'invalid',
};

export type UuidInspection = {
  valid: boolean;
  version: number | null;
  /** English variant name; `variantId` is the stable id a widget localizes. */
  variant: string;
  variantId: UuidVariantId;
};

export function inspectUuid(input: string): UuidInspection {
  const normalized = input.trim().toLowerCase();
  const valid = uuidValidate(normalized);
  if (!valid) return { valid: false, version: null, variant: 'invalid', variantId: 'invalid' };
  const v = uuidVersion(normalized);
  const variantId = detectVariant(normalized);
  return { valid: true, version: v, variant: VARIANT_LABELS[variantId], variantId };
}

function detectVariant(uuid: string): UuidVariantId {
  // The variant is encoded in the high bits of the 9th hex digit (after stripping dashes, position 16)
  const stripped = uuid.replace(/-/g, '');
  const variantNibble = Number.parseInt(stripped[16] ?? '0', 16);
  if ((variantNibble & 0b1000) === 0) return 'ncs';
  if ((variantNibble & 0b1100) === 0b1000) return 'rfc4122';
  if ((variantNibble & 0b1110) === 0b1100) return 'microsoft';
  return 'reserved';
}
