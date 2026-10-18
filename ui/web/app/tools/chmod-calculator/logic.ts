/**
 * Unix chmod permission math — octal ↔ symbolic ↔ per-bit flags,
 * including setuid/setgid/sticky special bits.
 */

export type PermBits = {
  read: boolean;
  write: boolean;
  execute: boolean;
};

export type ChmodState = {
  owner: PermBits;
  group: PermBits;
  others: PermBits;
  setuid: boolean;
  setgid: boolean;
  sticky: boolean;
};

export const DEFAULT_STATE: ChmodState = {
  owner: { read: true, write: true, execute: true },
  group: { read: true, write: false, execute: true },
  others: { read: true, write: false, execute: false },
  setuid: false,
  setgid: false,
  sticky: false,
};

function bitsToDigit({ read, write, execute }: PermBits): number {
  return (read ? 4 : 0) + (write ? 2 : 0) + (execute ? 1 : 0);
}

function digitToBits(digit: number): PermBits {
  return { read: (digit & 4) !== 0, write: (digit & 2) !== 0, execute: (digit & 1) !== 0 };
}

/** 3- or 4-digit octal string, special digit omitted when zero (chmod convention). */
export function stateToOctal(state: ChmodState): string {
  const special = (state.setuid ? 4 : 0) + (state.setgid ? 2 : 0) + (state.sticky ? 1 : 0);
  const base = `${bitsToDigit(state.owner)}${bitsToDigit(state.group)}${bitsToDigit(state.others)}`;
  return special > 0 ? `${special}${base}` : base;
}

/** rwxr-xr-- style, with s/S t/T markers for special bits per ls(1) convention. */
export function stateToSymbolic(state: ChmodState): string {
  const triad = (bits: PermBits, special: boolean, specialChar: 's' | 't'): string => {
    const x = special
      ? bits.execute
        ? specialChar
        : specialChar.toUpperCase()
      : bits.execute
        ? 'x'
        : '-';
    return `${bits.read ? 'r' : '-'}${bits.write ? 'w' : '-'}${x}`;
  };
  return (
    triad(state.owner, state.setuid, 's') +
    triad(state.group, state.setgid, 's') +
    triad(state.others, state.sticky, 't')
  );
}

/** Parse "755" or "4755". Returns null on invalid input. */
export function octalToState(input: string): ChmodState | null {
  const text = input.trim();
  if (!/^[0-7]{3,4}$/.test(text)) return null;
  const digits = text.split('').map(Number);
  const special = digits.length === 4 ? (digits.shift() as number) : 0;
  const [owner, group, others] = digits as [number, number, number];
  return {
    owner: digitToBits(owner),
    group: digitToBits(group),
    others: digitToBits(others),
    setuid: (special & 4) !== 0,
    setgid: (special & 2) !== 0,
    sticky: (special & 1) !== 0,
  };
}

/** Parse "rwxr-xr--" (9 chars, s/S t/T accepted). Returns null on invalid input. */
export function symbolicToState(input: string): ChmodState | null {
  const text = input.trim();
  if (!/^[rwxsStT-]{9}$/.test(text)) return null;
  const readAt = (i: number) => text[i] === 'r';
  const writeAt = (i: number) => text[i] === 'w';
  const execChar = (i: number) => text[i] as string;
  const parseTriad = (offset: number, specialChar: 's' | 't') => {
    const c = execChar(offset + 2);
    if (!['x', '-', specialChar, specialChar.toUpperCase()].includes(c)) return null;
    return {
      bits: {
        read: readAt(offset),
        write: writeAt(offset + 1),
        execute: c === 'x' || c === specialChar,
      },
      special: c.toLowerCase() === specialChar,
    };
  };
  const owner = parseTriad(0, 's');
  const group = parseTriad(3, 's');
  const others = parseTriad(6, 't');
  if (!owner || !group || !others) return null;
  return {
    owner: owner.bits,
    group: group.bits,
    others: others.bits,
    setuid: owner.special,
    setgid: group.special,
    sticky: others.special,
  };
}

export function chmodCommand(state: ChmodState, filename = 'file'): string {
  return `chmod ${stateToOctal(state)} ${filename}`;
}
