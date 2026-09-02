import { type Locale, isValidLocale } from '@anytools/i18n';
import en from '@anytools/i18n/messages/en/common.json';
import es from '@anytools/i18n/messages/es/common.json';
import pt from '@anytools/i18n/messages/pt/common.json';
import vi from '@anytools/i18n/messages/vi/common.json';
import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

// `as unknown as` rather than a direct cast: AbstractIntlMessages is declared as
// { [key: string]: string | AbstractIntlMessages }, which does not admit arrays,
// but next-intl reads them fine — t.raw() is documented to return list messages
// as arrays, and clusterLanding.<cluster>.body is one. The double cast is the
// narrow, deliberate hole; the alternative was flattening the paragraphs into
// p1/p2/p3 keys purely to satisfy a type that the runtime does not enforce.
const messagesMap: Record<Locale, AbstractIntlMessages> = {
  en: en as unknown as AbstractIntlMessages,
  vi: vi as unknown as AbstractIntlMessages,
  es: es as unknown as AbstractIntlMessages,
  pt: pt as unknown as AbstractIntlMessages,
};

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isValidLocale(requested) ? requested : routing.defaultLocale;
  return { locale, messages: messagesMap[locale] };
});
