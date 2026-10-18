import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { Connection, RouteEntry } from "~/lib/byok.types";

/**
 * One function's fallback chain.
 *
 * The editor is a plain form with one `<select>` per position and a model field
 * beside it, submitted whole. That is deliberate rather than minimal: the chain
 * IS an ordered list, the API replaces it atomically, and a drag-and-drop
 * surface that PATCHes individual positions would transiently violate the
 * (user, function, position) unique index the database enforces.
 *
 * An empty selection removes that position: the action reads every row in
 * order and skips the blanks, so the remaining entries close up. Choosing
 * "none" is how an entry is deleted.
 */
export function RouteChainEditor({
  fn,
  entries,
  connections,
  maxEntries,
}: {
  fn: string;
  entries: RouteEntry[];
  connections: Connection[];
  maxEntries: number;
}) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  // One row per possible position, pre-filled with what is configured. Showing
  // the empty rows is what makes "add a fallback" a visible affordance rather
  // than a button that grows the form.
  const rows = Array.from({ length: maxEntries }, (_, i) => entries[i]);

  return (
    <Form method="post" className="border-b py-5">
      <input type="hidden" name="function" value={fn} />

      <h3 className="font-sans text-base font-medium">
        {t(`settings.functions.${fn}` as never, { defaultValue: fn })}
      </h3>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">
        {t(`settings.functionHelp.${fn}` as never, { defaultValue: "" })}
      </p>

      <ol className="mt-3 space-y-2">
        {rows.map((entry, index) => (
          <li key={index} className="flex flex-wrap items-end gap-2">
            <span aria-hidden="true" className="pb-3 font-mono text-2xs tabular-nums text-faint">
              {String(index + 1).padStart(2, "0")}
            </span>

            <label className="flex flex-col gap-1 text-sm">
              <span className="sr-only">
                {t("settings.routes.connectionAt", { position: index + 1 })}
              </span>
              <select
                name={`connection_${index}`}
                defaultValue={entry?.connection_id ?? ""}
                className="h-10 w-56 max-w-full rounded-md border bg-card px-2 text-sm"
              >
                <option value="">{t("settings.routes.none")}</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="sr-only">
                {t("settings.routes.modelAt", { position: index + 1 })}
              </span>
              <input
                type="text"
                name={`model_${index}`}
                defaultValue={entry?.model ?? ""}
                placeholder={t("settings.routes.modelPlaceholder")}
                className="h-10 w-64 max-w-full rounded-md border bg-card px-3 font-mono text-sm"
              />
            </label>
          </li>
        ))}
      </ol>

      <div className="mt-3">
        <Button type="submit" variant="outline" size="sm" disabled={busy}>
          {t("settings.routes.save")}
        </Button>
      </div>
    </Form>
  );
}
