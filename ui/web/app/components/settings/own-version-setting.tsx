/**
 * The "write my own version first" switch. A form post, like the zone, so it
 * works before hydration; the switch's state is the loader's, so it shows
 * what the API stored.
 */
import { Switch } from "~/components/doc/switch";
import { Form } from "react-router";
import { useTranslation } from "react-i18next";

export function OwnVersionSetting({ on, pending, saved, failed }: { on: boolean; pending: boolean; saved: boolean; failed: string }) {
  const { t } = useTranslation("ownversion");
  return (
    <section aria-labelledby="lp-account-own">
      <h2 id="lp-account-own" className="lp-section">
        4. {t("settings.title")}
      </h2>
      <p id="lp-account-own-body" className="mt-3 text-sm leading-prose text-muted-foreground">
        {t("settings.body")}
      </p>
      <Form method="post" className="mt-4">
        <input type="hidden" name="intent" value="own_version" />
        <input type="hidden" name="enabled" value={on ? "false" : "true"} />
        <Switch
          type="submit"
          checked={on}
          onCheckedChange={() => {}}
          label={t("settings.label")}
          aria-describedby="lp-account-own-body"
          disabled={pending}
        />
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
