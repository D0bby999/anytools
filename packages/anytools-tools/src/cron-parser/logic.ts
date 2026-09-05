import cronParser from 'cron-parser';
import cronstrue from 'cronstrue';
import 'cronstrue/locales/es';
import 'cronstrue/locales/pt_BR';
import 'cronstrue/locales/vi';

/** Widget locales → the cronstrue locale that describes the expression in that language. */
export type CronLocale = 'en' | 'vi' | 'es' | 'pt';
const CRONSTRUE_LOCALE: Record<CronLocale, string> = { en: 'en', vi: 'vi', es: 'es', pt: 'pt_BR' };

export type CronInspection = {
  description: string;
  nextRuns: Date[];
};

export function parseCron(
  expression: string,
  count = 5,
  tz = 'UTC',
  locale: CronLocale = 'en',
): CronInspection {
  const interval = cronParser.parseExpression(expression, { tz });
  const nextRuns: Date[] = [];
  for (let i = 0; i < count; i++) {
    nextRuns.push(interval.next().toDate());
  }
  return {
    description: cronstrue.toString(expression, { locale: CRONSTRUE_LOCALE[locale] }),
    nextRuns,
  };
}

export type CronValidation = {
  valid: boolean;
  /** cron-parser's own (English) message. */
  error?: string;
  /** Stable code + the message as `detail`, so a widget can wrap it in its own language. */
  code?: string;
  params?: Record<string, string | number>;
};

export function validateCron(expression: string): CronValidation {
  try {
    cronParser.parseExpression(expression);
    return { valid: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Invalid cron';
    return { valid: false, error, code: 'invalidCron', params: { detail: error } };
  }
}
