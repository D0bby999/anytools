/**
 * knowledge.index.tsx
 * The Knowledge Center's list screen: every knowledge base, and the form that
 * makes another one.
 *
 * Its loader runs inside app-layout's guard, so the session is already proven;
 * what it must still do is pass the session's user id to every API call, which
 * is the assertion the Go API's RequireUser trusts this process to make.
 */
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/knowledge.index";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { createKB, listKBs } from "~/lib/kb.server";
import { ApiError } from "~/lib/api.server";
import { Button } from "~/components/ui/button";
import { KBCard } from "~/components/knowledge/kb-card";
import { PageHeader } from "~/components/ui/page-header";
import { QuickStart } from "~/components/doc/quick-start";
import { DocSection, Prose } from "~/components/reading/doc-section";
import { useNewForm } from "~/components/reading/use-new-form";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Knowledge") },
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
  const { open: creating, close } = useNewForm(Boolean(actionData?.createError));

  const submitting = navigation.formMethod === "POST";
  const first = loaderData.summaries[0]?.kb;

  return (
    <div>
      <PageHeader title={t("index.title")} lede={t("index.lead")} />

      <QuickStart
        kicker={t("index.up.kicker")}
        title={t("index.up.title")}
        description={t("index.up.description")}
        primary={{ label: t("index.create"), to: "?new#lp-kb-new" }}
        secondary={
          // Highlights land in a knowledge base, so the shortcut needs one;
          // it opens the first one at its "Add sources" tab.
          first ? [{ label: t("index.up.importHighlights"), to: `/knowledge/${first.id}?add=highlights#lp-kb-add` }] : []
        }
      />

      {creating ? (
        <Form
          id="lp-kb-new"
          method="post"
          className="mt-8 flex scroll-mt-20 flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
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
              className="mt-1 h-10 w-full rounded-sm border bg-card px-3 text-sm focus-visible:border-primary focus-visible:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {t("index.submit")}
            </Button>
            <Button type="button" variant="outline" onClick={close}>
              {t("index.cancel")}
            </Button>
          </div>
        </Form>
      ) : null}

      {actionData?.createError ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {actionData.createError}
        </p>
      ) : null}

      <DocSection title={t("index.up.yours")} id="your-knowledge-bases">
        {loaderData.summaries.length === 0 ? (
          <Prose>
            <p>
              {t("index.empty")} <Link to="?new#lp-kb-new">{t("index.create")}</Link>
            </p>
          </Prose>
        ) : (
          <Prose>
            <ul aria-label={t("index.up.yours")}>
              {loaderData.summaries.map((summary) => (
                <KBCard key={summary.kb.id} summary={summary} />
              ))}
            </ul>
          </Prose>
        )}
      </DocSection>
    </div>
  );
}
