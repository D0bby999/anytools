import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { Flyout, FlyoutGroup, FlyoutLink, FLYOUT_ITEM } from "~/components/doc/flyout";

/** One or two letters for the avatar: the name's initials, else the email's first. */
export function initials(displayName: string, email: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (email.trim()[0] ?? "?").toUpperCase();
}

/** Who is signed in, Settings, the language and a POST sign-out: the menu's rows. */
export function AccountItems({ displayName, email }: { displayName: string; email: string }) {
  const { t } = useTranslation("common");
  const name = displayName || email;
  return (
    <>
      <FlyoutGroup>
        <p className="truncate px-3 text-sm leading-8 font-semibold">{name}</p>
        {displayName ? <p className="truncate px-3 pb-1 text-xs text-muted-foreground">{email}</p> : null}
      </FlyoutGroup>
      <FlyoutGroup>
        <FlyoutLink to="/settings">{t("account.settings")}</FlyoutLink>
        <FlyoutLink to="/settings/account">{t("account.language")}</FlyoutLink>
      </FlyoutGroup>
      <FlyoutGroup>
        {/* A POST, not a link: a GET logout can be fired by any third-party
            <img src="/auth/logout"> the user's browser happens to load. */}
        <Form method="post" action="/auth/logout">
          <button type="submit" className={FLYOUT_ITEM}>
            {t("actions.signOut")}
          </button>
        </Form>
      </FlyoutGroup>
    </>
  );
}

/**
 * The account, as a flyout at the end of the nav (pattern I9): the avatar's
 * initials open who is signed in, Settings, the interface language and Sign
 * out. The name is read as text, not shown: the visible initials are hidden
 * from the name, so they cannot disagree with it (WCAG 2.5.3).
 */
export function AccountMenu({ displayName, email }: { displayName: string; email: string }) {
  const { t } = useTranslation("common");
  const name = displayName || email;
  return (
    <Flyout
      label={t("account.menu", { name })}
      hideChevron
      buttonClassName="group px-2"
      menuClassName="w-64"
      icon={
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full border border-control-border bg-card text-xs font-semibold text-foreground transition-colors group-hover:border-primary group-aria-expanded:border-primary"
        >
          {initials(displayName, email)}
        </span>
      }
    >
      <AccountItems displayName={displayName} email={email} />
    </Flyout>
  );
}
