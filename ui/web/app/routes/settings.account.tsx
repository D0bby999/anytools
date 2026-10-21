/**
 * settings.account.tsx
 * The account itself: who is signed in, and deleting everything.
 *
 * Deletion asks the person to type their email: a single click that erases
 * every document, note and learning record is one misclick too few. The API
 * revokes Drive and Gemini grants at Google, deletes every row the account
 * owns and its files (internal/account); this side then ends the session.
 *
 * The time zone is here too: every "today" in the learning features is the
 * learner's calendar day. The shell reports the browser's zone once; this
 * form is how the learner changes it.
 *
 * And "write my own version first" (up-methods phase 11): with it on, Solve
 * and chat ask for three lines before sending.
 */
import { Field } from "~/components/doc/field";
import { LanguageChoice } from "~/components/settings/language-choice";
import { useEffect, useState } from "react";
import { Form, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/settings.account";
import { requireUser } from "~/lib/auth.server";
import { ApiError, apiFetch } from "~/lib/api.server";
import { isSupportedLng, type SupportedLng } from "~/lib/i18n";
import { destroySession, getSession } from "~/lib/session.server";
import { invalidateWatermark } from "~/lib/session-watermark.server";
import { Button } from "~/components/ui/button";
import { OwnVersionSetting } from "~/components/settings/own-version-setting";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return {
    email: user.email,
    displayName: user.display_name,
    timezone: user.timezone,
    ownVersionFirst: user.own_version_first === true,
    language: isSupportedLng(user.language ?? "") ? (user.language as SupportedLng) : "en",
  };
}

/** Each language named in itself, so a learner can find their own in any of them. */
export const LANGUAGE_NAMES: Record<SupportedLng, string> = { en: "English", vi: "Tiếng Việt", es: "Español", pt: "Português" };

type ActionResult = {
  errorKey: string;
  errorDetail: string;
  intent?: "timezone" | "own_version";
  saved?: boolean;
};

export async function action({ request }: Route.ActionArgs): Promise<ActionResult | Response> {
  // The language form is a native post (reloadDocument): the redirect that
  // follows loads the whole app again in the new language.
  const language = await peekLanguage(request);
  if (language) {
    const { user } = await requireUser(request);
    await apiFetch("/v1/me/language", user.id, { method: "PUT", body: { language, only_if_unset: false } });
    return redirect("/settings/account");
  }
  const { user } = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "timezone") {
    const timezone = String(form.get("timezone") ?? "").trim();
    try {
      await apiFetch("/v1/me/timezone", user.id, { method: "PUT", body: { timezone, only_if_unset: false } });
      return { intent: "timezone", saved: true, errorKey: "", errorDetail: "" };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        return { intent: "timezone", errorKey: "settings.account.zoneInvalid", errorDetail: "" };
      }
      throw error;
    }
  }
  if (form.get("intent") === "own_version") {
    try {
      await apiFetch("/v1/me/own-version-first", user.id, {
        method: "PUT",
        body: { enabled: form.get("enabled") === "true" },
      });
      return { intent: "own_version", saved: true, errorKey: "", errorDetail: "" };
    } catch (error) {
      if (error instanceof ApiError) {
        return { intent: "own_version", errorKey: "settings.failed", errorDetail: error.message };
      }
      throw error;
    }
  }
  const typed = String(form.get("confirm") ?? "")
    .trim()
    .toLowerCase();
  if (typed !== user.email.toLowerCase()) {
    return { errorKey: "settings.account.mismatch", errorDetail: "" };
  }
  try {
    await apiFetch<void>("/v1/me", user.id, { method: "DELETE" });
  } catch (error) {
    return { errorKey: "settings.account.failed", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  invalidateWatermark(user.id);
  return redirect("/", { headers: { "Set-Cookie": await destroySession(await getSession(request)) } });
}

/**
 * The zone list comes from the browser after hydration: the server's Intl may
 * list a different set, and a mismatch would be a hydration warning.
 */
function useZoneNames(): string[] {
  const [zones, setZones] = useState<string[]>([]);
  useEffect(() => {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    setZones(intl.supportedValuesOf?.("timeZone") ?? []);
  }, []);
  return zones;
}

export default function SettingsAccount({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const zones = useZoneNames();
  const zoneResult = actionData && "intent" in actionData && actionData.intent === "timezone" ? actionData : null;
  const ownResult = actionData && "intent" in actionData && actionData.intent === "own_version" ? actionData : null;
  const deleteResult = actionData && !("intent" in actionData && actionData.intent) ? actionData : null;

  return (
    <div className="mt-8 space-y-10">
      <section aria-labelledby="lp-account-who">
        <h2 id="lp-account-who" className="lp-section">
          1. {t("settings.connections.name")}
        </h2>
        <p className="mt-3 text-sm">
          {loaderData.displayName ? `${loaderData.displayName} · ` : ""}
          {loaderData.email}
        </p>
      </section>

      <section aria-labelledby="lp-account-language">
        <h2 id="lp-account-language" className="lp-section">
          2. {t("settings.account.languageTitle")}
        </h2>
        <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("settings.account.languageBody")}</p>
        <Form method="post" reloadDocument className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="language" />
          <LanguageChoice language={loaderData.language} names={LANGUAGE_NAMES} label={t("settings.account.languageLabel")} />
          <Button type="submit" variant="outline">
            {t("settings.account.languageSave")}
          </Button>
        </Form>
      </section>

      <section aria-labelledby="lp-account-zone">
        <h2 id="lp-account-zone" className="lp-section">
          3. {t("settings.account.zoneTitle")}
        </h2>
        <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("settings.account.zoneBody")}</p>
        <Form method="post" className="mt-4 space-y-3">
          <input type="hidden" name="intent" value="timezone" />
          <div>
            <Field label={t("settings.account.zoneLabel")}>
              <input
                id="lp-account-zone-input"
                name="timezone"
                list="lp-account-zone-list"
                required
                autoComplete="off"
                spellCheck={false}
                defaultValue={loaderData.timezone}
                className="mt-1 min-h-11 w-full max-w-sm rounded-md border border-control-border bg-card px-3 text-sm"
              />
            </Field>
            <datalist id="lp-account-zone-list">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>
          <Button type="submit" variant="outline" disabled={navigation.state !== "idle"}>
            {t("settings.account.zoneSave")}
          </Button>
        </Form>
        {zoneResult?.saved ? (
          <p role="status" className="mt-3 text-sm leading-snug">
            {t("settings.account.zoneSaved")}
          </p>
        ) : null}
        {zoneResult?.errorKey ? (
          <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
            {t(zoneResult.errorKey)}
          </p>
        ) : null}
      </section>

      <OwnVersionSetting
        on={loaderData.ownVersionFirst}
        pending={navigation.state !== "idle"}
        saved={ownResult?.saved === true}
        failed={ownResult?.errorKey ? ownResult.errorDetail || " " : ""}
      />

      <Form method="post" action="/auth/logout">
        <Button type="submit" variant="outline">
          {t("actions.signOut")}
        </Button>
      </Form>

      <section aria-labelledby="lp-account-delete">
        <h2 id="lp-account-delete" className="lp-section">
          {t("settings.account.deleteTitle")}
        </h2>
        <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("settings.account.deleteBody")}</p>
        {/* Owner decision 1 of drive-user-storage: the learner's Drive is theirs. */}
        <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("settings.account.deleteDrive")}</p>
        <Form method="post" className="mt-4 space-y-3">
          <div>
            <label htmlFor="lp-account-confirm" className="block text-sm font-medium">
              {t("settings.account.confirmLabel")}
            </label>
            <input
              id="lp-account-confirm"
              name="confirm"
              required
              autoComplete="off"
              className="mt-1 min-h-11 w-full max-w-sm rounded-md border border-control-border bg-card px-3 text-sm"
            />
          </div>
          <Button type="submit" variant="destructive" disabled={navigation.state !== "idle"}>
            {t("settings.account.deleteSubmit")}
          </Button>
        </Form>
        {deleteResult?.errorKey ? (
          <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
            {t(deleteResult.errorKey)}
            {deleteResult.errorDetail ? ` ${deleteResult.errorDetail}` : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** The language form's choice, read from a clone so the rest of the action still has its body. */
async function peekLanguage(request: Request): Promise<SupportedLng | null> {
  const form = await request.clone().formData();
  const language = String(form.get("language") ?? "");
  return form.get("intent") === "language" && isSupportedLng(language) ? language : null;
}
