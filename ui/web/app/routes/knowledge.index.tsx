/**
 * knowledge.index.tsx
 * The Knowledge Center's list screen: every knowledge base, and the form that
 * makes another one.
 *
 * Its loader runs inside app-layout's guard, so the session is already proven;
 * what it must still do is pass the session's user id to every API call, which
 * is the assertion the Go API's RequireUser trusts this process to make.
 */
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { Route } from "./+types/knowledge.index";
import { requireUser } from "~/lib/auth.server";
import { createKB, listKBs } from "~/lib/kb.server";
import { ApiError } from "~/lib/api.server";
import { Button } from "~/components/ui/button";
import { KBCard } from "~/components/knowledge/kb-card";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Knowledge · AnyTools" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const { knowledge_bases } = await listKBs(user.id);
  return { summaries: knowledge_bases };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();

  if (!name) {
    return { createError: "A name is required." };
  }

  try {
    await createKB(user.id, name);
  } catch (error) {
    // The API's message is written for a person and carries no internals.
    // Anything else becomes a generic sentence rather than a leaked stack.
    const message = error instanceof ApiError ? error.message : undefined;
    return { createError: message ?? "The knowledge base could not be created." };
  }
  // No redirect: this route IS the destination, and returning null lets React
  // Router revalidate the loader in place.
  return null;
}

export default function KnowledgeIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("knowledge");
  const navigation = useNavigation();
  const [creating, setCreating] = useState(false);

  const submitting = navigation.formMethod === "POST";

  return (
    <div className="lp-measure">
      <div className="lp-prose">
        <h1>{t("index.title")}</h1>
        <p>{t("index.lead")}</p>
      </div>

      <div className="mt-8">
        {creating ? (
          <Form
            method="post"
            className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
            onSubmit={() => setCreating(false)}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="lp-kb-name" className="block text-sm font-medium">
                {t("index.nameLabel")}
              </label>
              <input
                id="lp-kb-name"
                name="name"
                required
                maxLength={200}
                autoFocus
                placeholder={t("index.namePlaceholder")}
                className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {t("index.submit")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                {t("index.cancel")}
              </Button>
            </div>
          </Form>
        ) : (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("index.create")}
          </Button>
        )}

        {actionData?.createError ? (
          <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
            {actionData.createError}
          </p>
        ) : null}
      </div>

      {loaderData.summaries.length === 0 ? (
        <p className="mt-8 text-sm leading-prose text-muted-foreground">{t("index.empty")}</p>
      ) : (
        <ul className="mt-8 border-t">
          {loaderData.summaries.map((summary) => (
            <KBCard key={summary.kb.id} summary={summary} />
          ))}
        </ul>
      )}
    </div>
  );
}
