/**
 * chat.index.tsx — the session list.
 *
 * It is a route rather than a panel inside the conversation view because a
 * session is a URL: a user who wants to send someone "the conversation where we
 * worked that out" needs a link, and a list that only exists as component state
 * has no link to give.
 */
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { MessageSquarePlus } from "lucide-react";
import type { Route } from "./+types/chat.index";
import { requireUserId } from "~/lib/auth.server";
import { createSession, deleteSession, listSessions } from "~/lib/chat.server";
import { Button } from "~/components/ui/button";
import { requireUUID } from "~/lib/turns";
import { PageHeader } from "~/components/ui/page-header";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Chat · AnyTools" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const { sessions } = await listSessions(userId);
  return { sessions };
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    const id = String(form.get("sessionId") ?? "");
    if (id) await deleteSession(userId, requireUUID(id));
    return redirect("/chat");
  }

  const session = await createSession(userId, { title: "" });
  return redirect(`/chat/${session.id}`);
}

export default function ChatIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="lp-measure">
      <PageHeader
        title={t("chat.title")}
        lede={t("chat.lead")}
        actions={
          <Form method="post">
            <Button type="submit" disabled={busy}>
              <MessageSquarePlus aria-hidden="true" />
              {t("chat.new")}
            </Button>
          </Form>
        }
      />

      {loaderData.sessions.length === 0 ? (
        <p className="lp-empty">{t("chat.noSessions")}</p>
      ) : (
        <ul className="divide-y border-y">
          {loaderData.sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 py-2">
              <Link
                to={`/chat/${session.id}`}
                className="min-h-11 min-w-0 flex-1 truncate py-2.5 font-serif text-lg hover:text-primary hover:underline"
              >
                {session.title || t("chat.untitled")}
              </Link>
              <Form method="post">
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="sessionId" value={session.id} />
                <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                  {t("chat.delete")}
                </Button>
              </Form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
