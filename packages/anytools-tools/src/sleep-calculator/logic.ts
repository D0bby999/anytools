export const CYCLE_MIN = 90;
export const FALL_ASLEEP_MIN = 14;

export type SleepMode = 'wakeUp' | 'goToBed';

export type SleepCycleRow = {
  /** Human-readable label, e.g. "5 cycles (7h 30m)" */
  label: string;
  /** Target time as a Date */
  target: Date;
  /** Whether this row should be emphasized (recommended cycle count) */
  emphasis: boolean;
};

/**
 * Returns a new Date offset by the given number of minutes.
 */
export function offsetMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

/**
 * Parses an HH:MM time string and applies it to the given reference date.
 * Falls back to 07:00 for invalid segments.
 */
export function parseTimeString(value: string, ref: Date): Date {
  const parts = value.split(':');
  const hh = parts[0] ?? '7';
  const mm = parts[1] ?? '0';
  const d = new Date(ref);
  d.setHours(Number(hh), Number(mm), 0, 0);
  return d;
}

/**
 * Computes suggested bedtimes (mode=wakeUp) or wake-up times (mode=goToBed)
 * for 3–6 sleep cycles.
 *
 * @param mode    - 'wakeUp': user specifies desired wake time; target = bedtime
 *                  'goToBed': user specifies bedtime; target = wake time
 * @param anchor  - The user-specified time
 * @param cycles  - Cycle counts to compute; defaults to [6, 5, 4, 3]
 */
export function computeSleepTimes(
  mode: SleepMode,
  anchor: Date,
  cycles: number[] = [6, 5, 4, 3],
): SleepCycleRow[] {
  return cycles.map((n) => {
    const totalMinutes = n * CYCLE_MIN + FALL_ASLEEP_MIN;
    const target =
      mode === 'wakeUp'
        ? offsetMinutes(anchor, -totalMinutes)
        : offsetMinutes(anchor, totalMinutes);

    const sleepMinutes = n * CYCLE_MIN;
    const hours = Math.floor(sleepMinutes / 60);
    const mins = sleepMinutes % 60;
    const label = `${n} cycles (${hours}h${mins ? ` ${mins}m` : ''})`;

    return { label, target, emphasis: n === 5 };
  });
}
