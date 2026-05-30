import { type Locale, isValidLocale } from '@anytools/i18n';
import en from '@anytools/i18n/messages/en/common.json';
import es from '@anytools/i18n/messages/es/common.json';
import pt from '@anytools/i18n/messages/pt/common.json';
import vi from '@anytools/i18n/messages/vi/common.json';
import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

const messagesMap: Record<Locale, AbstractIntlMessages> = {
  en: en as AbstractIntlMessages,
  vi: vi as AbstractIntlMessages,
  es: es as AbstractIntlMessages,
  pt: pt as AbstractIntlMessages,
};

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isValidLocale(requested) ? requested : routing.defaultLocale;
  return { locale, messages: messagesMap[locale] };
});
