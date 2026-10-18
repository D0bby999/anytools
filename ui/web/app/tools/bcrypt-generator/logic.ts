import bcrypt from 'bcryptjs';

/**
 * bcrypt hashing/verification via bcryptjs (pure JS, MIT — runs fully in the
 * browser, no server round-trip). Async APIs keep the main thread responsive
 * at high cost factors.
 */

export const MIN_ROUNDS = 4;
export const MAX_ROUNDS = 15; // >15 in pure JS blocks the tab for many seconds
export const DEFAULT_ROUNDS = 10;

export function clampRounds(rounds: number): number {
  if (!Number.isFinite(rounds)) return DEFAULT_ROUNDS;
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(rounds)));
}

export async function hashPassword(password: string, rounds: number): Promise<string> {
  return bcrypt.hash(password, clampRounds(rounds));
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    // Malformed hash string — treat as non-match rather than throwing at the UI.
    return false;
  }
}

/** Extract the cost factor from a bcrypt hash like $2b$10$... Returns null if malformed. */
export function parseCostFactor(hash: string): number | null {
  const match = /^\$2[abxy]\$(\d{2})\$/.exec(hash.trim());
  if (!match) return null;
  return Number(match[1]);
}
