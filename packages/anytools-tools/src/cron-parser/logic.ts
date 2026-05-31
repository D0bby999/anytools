import cronParser from 'cron-parser';
import cronstrue from 'cronstrue';

export type CronInspection = {
  description: string;
  nextRuns: Date[];
};

export function parseCron(expression: string, count = 5, tz = 'UTC'): CronInspection {
  const interval = cronParser.parseExpression(expression, { tz });
  const nextRuns: Date[] = [];
  for (let i = 0; i < count; i++) {
    nextRuns.push(interval.next().toDate());
  }
  return {
    description: cronstrue.toString(expression),
    nextRuns,
  };
}

export function validateCron(expression: string): { valid: boolean; error?: string } {
  try {
    cronParser.parseExpression(expression);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Invalid cron' };
  }
}
