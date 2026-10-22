/**
 * circles.tsx
 * Study with friends (the private design notes): the
 * learner's study circles, the cheers they had today, a new circle, and
 * joining one by its code or invite link (`/circles?join=CODE`).
 */
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/circles";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { createCircle, joinCircle, listCircles } from "~/lib/progress.server";
import { StatusLine } from "~/components/doc/status-line";
import { FIELD } from "~/components/body/fields";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

const LINK = "text-primary underline underline-offset-4";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Study with friends") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const { circles, cheers } = await listCircles(user.id);
  const join = (new URL(request.url).searchParams.get("join") ?? "").slice(0, 32);
  return { circles, cheers, join };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const nickname = String(form.get("nickname") ?? "");
  try {
    const circle =
      intent === "create"
        ? await createCircle(user.id, String(form.get("name") ?? ""), nickname)
        : await joinCircle(user.id, String(form.get("code") ?? ""), nickname);
    return redirect(`/circles/${circle.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { intent, error: "notFound" as const };
    if (error instanceof ApiError && (error.status === 400 || error.status === 409 || error.status === 429)) {
      return { intent, message: error.message };
    }
    throw error;
  }
}

export default function Circles({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("progress");
  const { circles, cheers, join } = loaderData;
  const busy = useNavigation().state === "submitting";
  const problem = (intent: string) =>
    actionData && actionData.intent === intent ? ("error" in actionData ? t("circles.errors.notFound") : actionData.message) : null;

  return (
    <div className="lp-doc">
      <PageHeader title={t("circles.title")} lede={t("circles.lede")} />

      <p id="lp-circles-nickname-note" className="mb-6 max-w-[64ch] text-sm text-muted-foreground">
        {t("circles.nicknameNote")}
      </p>
      {join ? (
        <section aria-labelledby="lp-circles-invited" className="rounded border border-border bg-card p-4">
          <h2 id="lp-circles-invited" className="font-semibold">
            {t("circles.invited.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("circles.invited.body")}</p>
          <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="join" />
            <input type="hidden" name="code" value={join} />
            <label className="min-w-0 flex-1 text-xs text-muted-foreground">
              {t("circles.nickname")}
              <input name="nickname" required maxLength={40} autoComplete="off" aria-describedby="lp-circles-nickname-note" className={FIELD} />
            </label>
            <Button type="submit" disabled={busy}>
              {t("circles.join.submit")}
            </Button>
          </Form>
          <StatusLine tone="error">{problem("join")}</StatusLine>
        </section>
      ) : null}

      {cheers.length > 0 ? (
        <section aria-labelledby="lp-circles-cheers" className="mt-8">
          <h2 id="lp-circles-cheers" className="lp-section">
            {t("circles.cheers.title")}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {cheers.map((c) => (
              <li key={`${c.circle_id}:${c.from}:${c.at}`}>
                {t("circles.cheers.line", { name: c.from })}{" "}
                <Link to={`/circles/${c.circle_id}`} className={LINK}>
                  {c.circle}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="lp-circles-mine" className="mt-8">
        <h2 id="lp-circles-mine" className="lp-section">
          {t("circles.mine")}
        </h2>
        {circles.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("circles.none")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {circles.map((c) => (
              <li key={c.id}>
                <Link to={`/circles/${c.id}`} className={`${LINK} font-medium`}>
                  {c.name}
                </Link>{" "}
                <span className="text-sm text-muted-foreground">
                  {t("circles.members", { count: c.members })}
                  {c.owner ? ` · ${t("circles.youOwn")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lp-circles-new" className="mt-8">
        <h2 id="lp-circles-new" className="lp-section">
          {t("circles.create.title")}
        </h2>
        <Form method="post" className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="intent" value="create" />
          <label className="text-xs text-muted-foreground">
            {t("circles.create.name")}
            <input name="name" required maxLength={60} className={FIELD} />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("circles.nickname")}
            <input name="nickname" required maxLength={40} autoComplete="off" aria-describedby="lp-circles-nickname-note" className={FIELD} />
          </label>
          <Button type="submit" disabled={busy}>
            {t("circles.create.submit")}
          </Button>
        </Form>
        <StatusLine tone="error">{problem("create")}</StatusLine>
      </section>

      {join ? null : (
        <section aria-labelledby="lp-circles-join" className="mt-8">
          <h2 id="lp-circles-join" className="lp-section">
            {t("circles.join.title")}
          </h2>
          <Form method="post" className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="intent" value="join" />
            <label className="text-xs text-muted-foreground">
              {t("circles.join.code")}
              <input name="code" required maxLength={32} autoComplete="off" spellCheck={false} className={`${FIELD} uppercase`} />
            </label>
            <label className="text-xs text-muted-foreground">
              {t("circles.nickname")}
              <input name="nickname" required maxLength={40} autoComplete="off" aria-describedby="lp-circles-nickname-note" className={FIELD} />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              {t("circles.join.submit")}
            </Button>
          </Form>
          <StatusLine tone="error">{problem("join")}</StatusLine>
        </section>
      )}

      <section aria-labelledby="lp-circles-privacy" className="mt-8">
        <h2 id="lp-circles-privacy" className="lp-section">
          {t("circles.privacy.title")}
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>{t("circles.privacy.seen")}</li>
          <li>{t("circles.privacy.notSeen")}</li>
          <li>{t("circles.privacy.together")}</li>
        </ul>
        <p className="mt-3 text-sm">
          <Link to="/progress" className={LINK}>
            {t("circles.toProgress")}
          </Link>
        </p>
      </section>
    </div>
  );
}
