import cronParser from 'cron-parser';
import cronstrue from 'cronstrue';
import 'cronstrue/locales/es';
import 'cronstrue/locales/pt_BR';
import 'cronstrue/locales/vi';

/**
 * Builder for standard 5-field crontab expressions (minute hour day month weekday).
 * Complements the cron-parser tool: this one goes UI → expression,
 * that one goes expression → explanation.
 */

/** Widget locales → the cronstrue locale that describes the expression in that language. */
export type CronLocale = 'en' | 'vi' | 'es' | 'pt';
const CRONSTRUE_LOCALE: Record<CronLocale, string> = { en: 'en', vi: 'vi', es: 'es', pt: 'pt_BR' };

export type CronFields = {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
};

export type CronPreset = {
  id: string;
  label: string;
  fields: CronFields;
};

export const EVERY: CronFields = {
  minute: '*',
  hour: '*',
  dayOfMonth: '*',
  month: '*',
  dayOfWeek: '*',
};

export const PRESETS: CronPreset[] = [
  { id: 'every-minute', label: 'Every minute', fields: { ...EVERY } },
  { id: 'every-5-min', label: 'Every 5 minutes', fields: { ...EVERY, minute: '*/5' } },
  { id: 'every-15-min', label: 'Every 15 minutes', fields: { ...EVERY, minute: '*/15' } },
  { id: 'hourly', label: 'Every hour', fields: { ...EVERY, minute: '0' } },
  { id: 'daily-midnight', label: 'Daily at 00:00', fields: { ...EVERY, minute: '0', hour: '0' } },
  { id: 'daily-9am', label: 'Daily at 09:00', fields: { ...EVERY, minute: '0', hour: '9' } },
  {
    id: 'weekdays-9am',
    label: 'Weekdays at 09:00',
    fields: { ...EVERY, minute: '0', hour: '9', dayOfWeek: '1-5' },
  },
  {
    id: 'weekly-sunday',
    label: 'Weekly on Sunday 00:00',
    fields: { ...EVERY, minute: '0', hour: '0', dayOfWeek: '0' },
  },
  {
    id: 'monthly-first',
    label: 'Monthly on the 1st 00:00',
    fields: { ...EVERY, minute: '0', hour: '0', dayOfMonth: '1' },
  },
  {
    id: 'yearly-jan1',
    label: 'Yearly on Jan 1 00:00',
    fields: { ...EVERY, minute: '0', hour: '0', dayOfMonth: '1', month: '1' },
  },
];

export function buildExpression(fields: CronFields): string {
  return [fields.minute, fields.hour, fields.dayOfMonth, fields.month, fields.dayOfWeek]
    .map((f) => f.trim() || '*')
    .join(' ');
}

export type CronBuildResult =
  | { valid: true; expression: string; description: string; nextRuns: Date[] }
  | {
      valid: false;
      expression: string;
      /** cron-parser's own (English) message. */
      error: string;
      /** Stable code + the message as `detail`, so a widget can wrap it in its own language. */
      code: string;
      params: Record<string, string | number>;
    };

export function describeExpression(
  fields: CronFields,
  runCount = 5,
  locale: CronLocale = 'en',
): CronBuildResult {
  const expression = buildExpression(fields);
  try {
    const interval = cronParser.parseExpression(expression, { tz: 'UTC' });
    const nextRuns: Date[] = [];
    for (let i = 0; i < runCount; i++) {
      nextRuns.push(interval.next().toDate());
    }
    return {
      valid: true,
      expression,
      description: cronstrue.toString(expression, { locale: CRONSTRUE_LOCALE[locale] }),
      nextRuns,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Invalid cron expression';
    return { valid: false, expression, error, code: 'invalidCron', params: { detail: error } };
  }
}
