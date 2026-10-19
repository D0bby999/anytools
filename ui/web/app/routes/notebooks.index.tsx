/**
 * notebooks.index.tsx
 * The learner's notebooks, and the form that makes another.
 *
 * Saving from the reader, a tutor answer or the chat's `write_note` tool lands
 * in the default notebook when none is named, so that one always exists once
 * anything has been saved.
 */
import { PlateEmpty } from "~/components/ui/plate";
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/notebooks.index";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { createNotebook, listNotebooks } from "~/lib/notebook.server";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

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

  return (
    <div className="lp-measure">
      <PageHeader title={t("notebook.title")} lede={t("notebook.lead")} />

      <Form method="post" className="mt-8 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="lp-nb-name" className="block text-sm font-medium">
            {t("notebook.newName")}
          </label>
          <input
            id="lp-nb-name"
            name="name"
            required
            maxLength={200}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
          />
        </div>
        <Button type="submit" disabled={navigation.formMethod === "POST"}>
          {t("notebook.create")}
        </Button>
      </Form>
      {actionData?.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(actionData.errorKey)}
          {actionData.errorDetail ? ` ${actionData.errorDetail}` : ""}
        </p>
      ) : null}

      {loaderData.notebooks.length === 0 ? (
        <PlateEmpty name="part-read" className="mt-8">
          {t("notebook.empty")}
        </PlateEmpty>
      ) : (
        <ul className="mt-8 border-t">
          {loaderData.notebooks.map((nb) => (
            <li key={nb.id} className="border-b">
              <Link
                to={`/notebooks/${nb.id}`}
                className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              >
                <span className="font-sans text-base font-medium">
                  {nb.name}
                  {nb.is_default ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{t("notebook.default")}</span>
                  ) : null}
                </span>
                <span className="text-sm text-muted-foreground">{t("notebook.count", { count: nb.note_count })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
