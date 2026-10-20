/**
 * share.tsx
 * Share to AnyLearn (plans/261020-1155-open-source-adds, phase 4). On Android
 * the installed app is a share target (manifest.webmanifest's share_target):
 * Share → AnyLearn from YouTube, a browser or a podcast app opens this page
 * with the shared title, text and url. It finds the link, offers the
 * knowledge base used last, and adds the link exactly as the knowledge page's
 * "Add a link" does, so a playlist or a podcast feed becomes a feed.
 *
 * Under the app layout, so a learner who is signed out signs in and comes
 * back here with the share intact. iOS Safari has no share target.
 */
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/share";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { addLink, createKB, listKBs } from "~/lib/kb.server";
import { pickLink, sharedTitle } from "~/lib/share";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

/** The knowledge base the last share went to. */
const LAST_KB = "al_share_kb";

const field = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm text-foreground";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Share") }, { name: "robots", content: "noindex, nofollow" }];
}

function lastKB(request: Request): string {
  const cookie = request.headers.get("Cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${LAST_KB}=([0-9a-f-]{36})`));
  return m?.[1] ?? "";
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const params = new URL(request.url).searchParams;
  const shared = { title: params.get("title"), text: params.get("text"), url: params.get("url") };
  const link = pickLink(shared);
  const { knowledge_bases } = await listKBs(user.id);
  const kbs = knowledge_bases.map((s) => ({ id: s.kb.id, name: s.kb.name }));
  const last = lastKB(request);
  return { link, title: sharedTitle(shared, link), kbs, selected: kbs.some((k) => k.id === last) ? last : (kbs[0]?.id ?? "") };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const url = pickLink({ url: String(form.get("url") ?? "") });
  if (!url) return { error: "" };
  let kbId = String(form.get("kb") ?? "");
  try {
    if (!kbId) {
      const name = String(form.get("name") ?? "").trim();
      if (!name) return { error: "", needsName: true };
      kbId = (await createKB(user.id, name)).id;
    }
    await addLink(user.id, kbId, url, false);
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "" };
  }
  return redirect(`/knowledge/${encodeURIComponent(kbId)}`, {
    headers: { "Set-Cookie": `${LAST_KB}=${kbId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly` },
  });
}

export default function Share({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("knowledge");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { link, title, kbs, selected } = loaderData;

  return (
    <div className="lp-measure">
      <PageHeader title={t("share.title")} lede={t("share.lead")} />
      {!link ? (
        <div className="mt-8 space-y-3">
          <p role="status" className="text-sm leading-prose">
            {t("share.noLink")}
          </p>
          <Link to="/knowledge" className="text-sm text-primary underline underline-offset-4">
            {t("share.toKnowledge")}
          </Link>
        </div>
      ) : (
        <Form method="post" className="mt-8 space-y-4">
          <input type="hidden" name="url" value={link} />
          <div className="rounded-md border p-3">
            {title ? <p className="text-sm font-medium">{title}</p> : null}
            <p className="break-all font-mono text-xs text-muted-foreground">{link}</p>
          </div>
          {kbs.length > 0 ? (
            <label className="block text-sm">
              {t("share.kb")}
              <select name="kb" defaultValue={selected} className={field}>
                {kbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-sm">
              {t("share.newKb")}
              <input name="name" required defaultValue={t("share.newKbName")} className={field} />
            </label>
          )}
          {actionData && "error" in actionData ? (
            <p role="alert" className="text-sm text-destructive">
              {actionData.error || t("share.failed")}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? t("share.adding") : t("share.add")}
          </Button>
        </Form>
      )}
    </div>
  );
}
