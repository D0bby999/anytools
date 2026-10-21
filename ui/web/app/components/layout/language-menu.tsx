import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { Flyout, FlyoutTitle, FLYOUT_ITEM } from "~/components/doc/flyout";
import { isSupportedLng, supportedLngs, type SupportedLng } from "~/lib/i18n";

/** Each language named in itself, so a learner can find their own in any of them. */
export const LANGUAGE_NAMES: Record<SupportedLng, string> = { en: "English", vi: "Tiếng Việt", es: "Español", pt: "Português" };

/**
 * Saves the account's language through the action Settings → Account
 * already has (intent=language), then reloads the page the learner is on, so
 * the whole shell comes back in the new language. Before hydration the form
 * posts natively and lands on Settings → Account, which is where that action
 * redirects; that is the one difference.
 */
async function switchLanguage(e: FormEvent<HTMLFormElement>) {
  const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
  const language = submitter?.value ?? "";
  if (!isSupportedLng(language)) return;
  e.preventDefault();
  const body = new FormData();
  body.set("intent", "language");
  body.set("language", language);
  // `manual`: the action answers with a redirect to Settings, which there
  // is no need to download.
  await fetch(e.currentTarget.action, { method: "POST", body, redirect: "manual", credentials: "same-origin" }).catch(() => null);
  window.location.reload();
}

/** The languages as a list of submit buttons, the current one marked. */
export function LanguageList({ className }: { className?: string }) {
  const { i18n } = useTranslation("common");
  const current = isSupportedLng(i18n.language) ? i18n.language : "en";
  return (
    <form method="post" action="/settings/account" onSubmit={switchLanguage} className={className}>
      <input type="hidden" name="intent" value="language" />
      <ul>
        {supportedLngs.map((l) => (
          <li key={l}>
            <button
              type="submit"
              name="language"
              value={l}
              lang={l}
              aria-current={l === current ? "true" : undefined}
              className={l === current ? `${FLYOUT_ITEM} text-primary` : FLYOUT_ITEM}
            >
              {LANGUAGE_NAMES[l]}
            </button>
          </li>
        ))}
      </ul>
    </form>
  );
}

/** The nav's language flyout, VPNavBarTranslations: a globe opening the list. */
export function LanguageMenu() {
  const { t, i18n } = useTranslation("common");
  const current = isSupportedLng(i18n.language) ? i18n.language : "en";
  return (
    <Flyout label={t("nav.changeLanguage")} icon={<Languages aria-hidden="true" className="size-4" />}>
      <FlyoutTitle>{LANGUAGE_NAMES[current]}</FlyoutTitle>
      <LanguageList />
    </Flyout>
  );
}
