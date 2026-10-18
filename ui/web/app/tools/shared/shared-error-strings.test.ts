import { describe, expect, it } from 'vitest';
import { SHARED_ERROR_STRINGS, returnedErrorText } from './shared-error-strings';

describe('SHARED_ERROR_STRINGS', () => {
  it('translates every shared code in every locale — a missing key would fall back to English', () => {
    const keys = Object.keys(SHARED_ERROR_STRINGS.en);
    for (const locale of ['vi', 'es', 'pt'] as const) {
      expect(Object.keys(SHARED_ERROR_STRINGS[locale] ?? {}).sort()).toEqual([...keys].sort());
    }
  });

  it('uses the same placeholders in every translation as the English template', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const [key, en] of Object.entries(SHARED_ERROR_STRINGS.en)) {
      for (const locale of ['vi', 'es', 'pt'] as const) {
        const translated =
          SHARED_ERROR_STRINGS[locale]?.[key as keyof typeof SHARED_ERROR_STRINGS.en];
        // ocrStartFailed deliberately drops the English language name in translation.
        if (key === 'error_ocrStartFailed') continue;
        expect(placeholders(translated ?? ''), `${locale}.${key}`).toEqual(placeholders(en));
      }
    }
  });
});

describe('returnedErrorText', () => {
  const strings = { error_heicIsAvif: '"{name}" là tệp AVIF.' };

  it('fills the localized template from the params', () => {
    expect(returnedErrorText(strings, 'heicIsAvif', { name: 'x.avif' }, 'fallback')).toBe(
      '"x.avif" là tệp AVIF.',
    );
  });

  it('falls back to the English text for an unknown or missing code', () => {
    expect(returnedErrorText(strings, 'other', {}, 'English text')).toBe('English text');
    expect(returnedErrorText(strings, undefined, undefined, 'English text')).toBe('English text');
  });
});
