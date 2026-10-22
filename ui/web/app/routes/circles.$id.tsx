/**
 * circles.$id.tsx
 * One study circle (the private design notes): how many
 * met their week, each member's week, streak, level and last study day, a
 * cheer for each, the invite link, and the owner's controls. Nobody's
 * studies are shown, only their steadiness.
 */
import { Form, Link, data, redirect, useFetcher, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/circles.$id";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import {
  cheerMember,
  getCircle,
  leaveCircle,
  newInvite,
  removeMember,
  updateCircle,
  type CircleMember,
} from "~/lib/progress.server";
import { Details } from "~/components/doc/details";
import { RefTable } from "~/components/doc/ref-table";
import { StatusLine } from "~/components/doc/status-line";
import { CopyLink } from "~/components/doc/copy-link";
import { FIELD } from "~/components/body/fields";
import { Bar } from "~/components/progress/study-calendar";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { dayLabel } from "~/lib/day-label";

export function meta({ matches, data: d }: Route.MetaArgs) {
  return [{ title: appTitle(matches, d?.detail.circle.name ?? "Study circle") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    const detail = await getCircle(user.id, params.id);
    const invite = new URL(`/circles?join=${detail.circle.invite_code}`, request.url).toString();
    return { detail, invite };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw data(null, { status: 404 });
    throw error;
  }
}

type ActionData = { intent: string; ok?: boolean; message?: string };

export async function action({ request, params }: Route.ActionArgs): Promise<ActionData | Response> {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const member = String(form.get("member") ?? "");
  try {
    switch (intent) {
      case "cheer":
        await cheerMember(user.id, params.id, member);
        return { intent, ok: true };
      case "nickname":
        await updateCircle(user.id, params.id, { nickname: String(form.get("nickname") ?? "") });
        return { intent, ok: true };
      case "rename":
        await updateCircle(user.id, params.id, { name: String(form.get("name") ?? "") });
        return { intent, ok: true };
      case "invite":
        await newInvite(user.id, params.id);
        return { intent, ok: true };
      case "remove":
        await removeMember(user.id, params.id, member);
        return { intent, ok: true };
      case "leave":
        await leaveCircle(user.id, params.id);
        return redirect("/circles");
    }
    return { intent, message: "?" };
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 409, 429].includes(error.status)) return { intent, message: error.message };
    throw error;
  }
}

/** "Today" (in the member's own zone), the day, or "not yet". */
function useLastStudied() {
  const { t, i18n } = useTranslation("progress");
  return (m: CircleMember) =>
    m.progress.studied_today
      ? t("circle.today")
      : m.progress.last_studied
        ? dayLabel(m.progress.last_studied, i18n.language)
        : t("circle.notYet");
}

function CheerButton({ member }: { member: CircleMember }) {
  const { t } = useTranslation("progress");
  const fetcher = useFetcher<ActionData>();
  const done = member.cheered || fetcher.data?.ok;
  if (member.me) return <span className="text-sm text-muted-foreground">{t("circle.you")}</span>;
  return done ? (
    <span className="text-sm text-muted-foreground">{t("circle.cheered")}</span>
  ) : (
    <fetcher.Form method="post">
      {fetcher.data?.message ? (
        <p role="status" className="mb-1 text-xs text-destructive">
          {fetcher.data.message}
        </p>
      ) : null}
      <input type="hidden" name="intent" value="cheer" />
      <input type="hidden" name="member" value={member.id} />
      <Button type="submit" variant="outline" size="sm" disabled={fetcher.state !== "idle"} aria-label={t("circle.cheerName", { name: member.nickname })}>
        {t("circle.cheer")}
      </Button>
    </fetcher.Form>
  );
}

export default function CirclePage({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("progress");
  const { detail, invite } = loaderData;
  const { circle, members, met_goal } = detail;
  const busy = useNavigation().state === "submitting";
  const me = members.find((m) => m.me);
  const lastStudied = useLastStudied();
  const number = new Intl.NumberFormat(i18n.language);
  const result = (intent: string) =>
    actionData && "intent" in actionData && actionData.intent === intent ? (actionData.message ?? t(`circle.done.${intent}`)) : null;
  const tone = (intent: string) => (actionData && "intent" in actionData && actionData.intent === intent && actionData.message ? "error" : "info");

  return (
    <div className="lp-doc">
      <p className="text-sm">
        <Link to="/circles" className="text-primary underline underline-offset-4">
          {t("circle.back")}
        </Link>
      </p>
      <PageHeader title={circle.name} lede={t("circle.lede", { count: members.length })} />

      <section aria-labelledby="lp-circle-week">
        <h2 id="lp-circle-week" className="lp-section">
          {t("circle.week.title")}
        </h2>
        <p className="mt-2 text-lg">{t("circle.week.met", { count: met_goal, total: members.length })}</p>
        <Bar value={met_goal} max={members.length} label={t("circle.week.met", { count: met_goal, total: members.length })} />
        <p className="mt-2 max-w-[64ch] text-sm text-muted-foreground">{t("circle.week.lede")}</p>
      </section>

      <section aria-labelledby="lp-circle-members" className="mt-10">
        <h2 id="lp-circle-members" className="lp-section">
          {t("circle.members")}
        </h2>
        <RefTable
          caption={t("circle.members")}
          columns={[t("circle.name"), t("circle.thisWeek"), t("circle.streak"), t("circle.level"), t("circle.last"), t("circle.cheerColumn")]}
          rows={members.map((m) => [
            <span key="n">
              {m.nickname}
              {m.owner ? <span className="text-muted-foreground"> · {t("circle.owner")}</span> : null}
              {m.cheers > 0 ? <span className="block text-xs text-muted-foreground">{t("circle.cheers", { count: m.cheers })}</span> : null}
            </span>,
            <span key="w">
              {`${number.format(m.progress.week_days)} / ${number.format(m.progress.week_goal)}`}
              {m.progress.week_days >= m.progress.week_goal ? (
                <>
                  {" "}
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">{t("circle.metGoal")}</span>
                </>
              ) : null}
            </span>,
            t("circle.days", { count: m.progress.streak }),
            number.format(m.progress.level),
            lastStudied(m),
            <CheerButton key="c" member={m} />,
          ])}
        />
      </section>

      <section aria-labelledby="lp-circle-invite" className="mt-10">
        <h2 id="lp-circle-invite" className="lp-section">
          {t("circle.invite.title")}
        </h2>
        <p className="mt-2 max-w-[64ch] text-sm text-muted-foreground">{t("circle.invite.lede")}</p>
        <p className="mt-2 break-all font-mono text-sm">{invite}</p>
        <p className="mt-1 text-sm">
          {t("circle.invite.code")} <span className="font-mono">{circle.invite_code}</span>
        </p>
        <div className="mt-3">
          <CopyLink url={invite} label={t("circle.copy")} copiedLabel={t("circle.copied")} />
        </div>
      </section>

      <section aria-labelledby="lp-circle-me" className="mt-10">
        <h2 id="lp-circle-me" className="lp-section">
          {t("circle.me.title")}
        </h2>
        <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="nickname" />
          <label className="min-w-0 flex-1 text-xs text-muted-foreground">
            {t("circles.nickname")}
            <input name="nickname" required maxLength={40} defaultValue={me?.nickname ?? ""} className={FIELD} />
          </label>
          <Button type="submit" variant="outline" disabled={busy}>
            {t("circle.me.save")}
          </Button>
        </Form>
        <StatusLine tone={tone("nickname")}>{result("nickname")}</StatusLine>

        {circle.owner ? (
          <Details summary={t("circle.manage.title")} className="mt-4">
            <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="rename" />
              <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                {t("circles.create.name")}
                <input name="name" required maxLength={60} defaultValue={circle.name} className={FIELD} />
              </label>
              <Button type="submit" variant="outline" disabled={busy}>
                {t("circle.manage.rename")}
              </Button>
            </Form>
            <StatusLine tone={tone("rename")}>{result("rename")}</StatusLine>
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="invite" />
              <Button type="submit" variant="outline" disabled={busy}>
                {t("circle.manage.newCode")}
              </Button>
              <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground">{t("circle.manage.newCodeNote")}</p>
            </Form>
            <StatusLine tone={tone("invite")}>{result("invite")}</StatusLine>
            {members.length > 1 ? (
              <ul className="mt-3 space-y-2">
                {members
                  .filter((m) => !m.me)
                  .map((m) => (
                    <li key={m.id}>
                      <Form method="post" className="flex flex-wrap items-center gap-3">
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="member" value={m.id} />
                        <span className="text-sm">{m.nickname}</span>
                        <Button type="submit" variant="outline" size="sm" disabled={busy} aria-label={t("circle.manage.removeName", { name: m.nickname })}>
                          {t("circle.manage.remove")}
                        </Button>
                      </Form>
                    </li>
                  ))}
              </ul>
            ) : null}
            <StatusLine tone={tone("remove")}>{result("remove")}</StatusLine>
          </Details>
        ) : null}

        <Details summary={t("circle.leave.title")} className="mt-4">
          <p className="mt-2 max-w-[64ch] text-sm text-muted-foreground">
            {members.length === 1 ? t("circle.leave.last") : circle.owner ? t("circle.leave.owner") : t("circle.leave.member")}
          </p>
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="leave" />
            <Button type="submit" variant="outline" disabled={busy}>
              {t("circle.leave.submit")}
            </Button>
          </Form>
          <StatusLine tone={tone("leave")}>{result("leave")}</StatusLine>
        </Details>
      </section>
    </div>
  );
}
