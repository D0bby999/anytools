import { Form } from "react-router";
import { useTranslation } from "react-i18next";

/**
 * The "write my own version first" switch. A form post, like the zone, so it
 * works before hydration; the switch's state is the loader's, so it shows
 * what the API stored.
 */
export function OwnVersionSetting({
  on,
  pending,
  saved,
  failed,
}: {
  on: boolean;
  pending: boolean;
  saved: boolean;
  failed: string;
}) {
  const { t } = useTranslation("ownversion");
  return (
    <section aria-labelledby="lp-account-own" className="border-t pt-6">
      <h2 id="lp-account-own" className="lp-kicker">
        {t("settings.title")}
      </h2>
      <p id="lp-account-own-body" className="mt-3 text-sm leading-prose text-muted-foreground">
        {t("settings.body")}
      </p>
      <Form method="post" className="mt-4">
        <input type="hidden" name="intent" value="own_version" />
        <input type="hidden" name="enabled" value={on ? "false" : "true"} />
        <button
          type="submit"
          role="switch"
          aria-checked={on}
          aria-describedby="lp-account-own-body"
          disabled={pending}
          className="flex min-h-11 items-center gap-3 text-sm font-medium disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className={
              "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors " +
              (on ? "border-primary bg-primary" : "border-control-border bg-sunken")
            }
          >
            <span
              className={
                "inline-block size-4 rounded-full bg-background transition-transform " +
                (on ? "translate-x-5" : "translate-x-1")
              }
            />
          </span>
          {t("settings.label")}
        </button>
      </Form>
      {saved ? (
        <p role="status" className="mt-3 text-sm leading-snug">
          {t("settings.saved")}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t("settings.failed")} {failed.trim()}
        </p>
      ) : null}
    </section>
  );
}
