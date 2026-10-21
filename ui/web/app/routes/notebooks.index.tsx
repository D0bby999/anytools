/**
 * notebooks.index.tsx
 * The learner's notebooks, and the form that makes another.
 *
 * Saving from the reader, a tutor answer or the chat's `write_note` tool lands
 * in the default notebook when none is named, so that one always exists once
 * anything has been saved.
 */
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/notebooks.index";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { createNotebook, listNotebooks } from "~/lib/notebook.server";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { DateText } from "~/components/ui/date-text";
import { QuickStart } from "~/components/doc/quick-start";
import { DocSection, Prose } from "~/components/reading/doc-section";
import { useNewForm } from "~/components/reading/use-new-form";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Notebook") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const { notebooks } = await listNotebooks(user.id);
  return { notebooks };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { errorKey: "errors.nameRequired", errorDetail: "" };
  try {
    await createNotebook(user.id, name);
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return null;
}

export default function NotebooksIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("reading");
  const navigation = useNavigation();
  const { open: creating } = useNewForm(Boolean(actionData?.errorKey));

  return (
    <div>
      <PageHeader title={t("notebook.title")} lede={t("notebook.lead")} />

      <QuickStart
        kicker={t("notebook.up.kicker")}
        title={t("notebook.up.title")}
        description={t("notebook.up.description")}
        primary={{ label: t("notebook.newName"), to: "?new#lp-nb-new" }}
      />

      {creating ? (
        <Form id="lp-nb-new" method="post" className="mt-8 flex scroll-mt-20 flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          <div className="min-w-0 flex-1">
            <label htmlFor="lp-nb-name" className="block text-sm font-medium">
              {t("notebook.newName")}
            </label>
            <input
              id="lp-nb-name"
              name="name"
              required
              maxLength={200}
              autoFocus
              className="mt-1 h-10 w-full rounded-sm border border-control-border bg-card px-3 text-sm hover:border-primary focus-visible:border-primary focus-visible:outline-none"
            />
          </div>
          <Button type="submit" disabled={navigation.formMethod === "POST"}>
            {t("notebook.create")}
          </Button>
        </Form>
      ) : null}
      {actionData?.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(actionData.errorKey)}
          {actionData.errorDetail ? ` ${actionData.errorDetail}` : ""}
        </p>
      ) : null}

      <DocSection title={t("notebook.up.yours")} id="your-notebooks">
        <Prose>
          {loaderData.notebooks.length === 0 ? (
            <p>{t("notebook.empty")}</p>
          ) : (
            // A dated list (P4): **name** · notes · updated.
            <ul aria-label={t("notebook.up.yours")}>
              {loaderData.notebooks.map((nb) => (
                <li key={nb.id}>
                  <strong>
                    <Link to={`/notebooks/${nb.id}`}>{nb.name}</Link>
                  </strong>
                  {nb.is_default ? <span className="text-muted-foreground"> ({t("notebook.default")})</span> : null}
                  {" · "}
                  {t("notebook.count", { count: nb.note_count })}
                  {" · "}
                  {t("notebook.up.updated")} <DateText iso={nb.updated_at} />
                </li>
              ))}
            </ul>
          )}
        </Prose>
      </DocSection>
    </div>
  );
}
