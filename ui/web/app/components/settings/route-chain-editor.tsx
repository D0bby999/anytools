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
import { RefTable } from "~/components/doc/ref-table";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { Connection, RouteEntry } from "~/lib/byok.types";

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
  const [rows, setRows] = useState(() =>
    Array.from({ length: maxEntries }, (_, i) => ({ connection_id: entries[i]?.connection_id ?? "", model: entries[i]?.model ?? "" })),
  );
  const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((previous) => previous.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const move = (index: number, direction: number) =>
    setRows((previous) => {
      const next = [...previous];
      [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
      return next;
    });

  return (
    <Form method="post" className="border-b py-5">
      <input type="hidden" name="function" value={fn} />

      <h3 className="font-sans text-base font-medium">{t(`settings.functions.${fn}` as never, { defaultValue: fn })}</h3>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">{t(`settings.functionHelp.${fn}` as never, { defaultValue: "" })}</p>

      <div className="lp-field-table">
        <RefTable
          caption={t(`settings.functions.${fn}` as never, { defaultValue: fn })}
          columns={[t("settings.up.position"), t("settings.connections.connectedTitle"), t("settings.up.model"), t("settings.up.order")]}
          rows={rows.map((entry, index) => [
            index + 1,
            <select
              aria-label={t("settings.routes.connectionAt", { position: index + 1 })}
              name={`connection_${index}`}
              value={entry.connection_id}
              onChange={(event) => update(index, { connection_id: event.target.value })}
            >
              <option value="">{t("settings.routes.none")}</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>,
            <input
              aria-label={t("settings.routes.modelAt", { position: index + 1 })}
              name={`model_${index}`}
              value={entry.model}
              onChange={(event) => update(index, { model: event.target.value })}
              placeholder={t("settings.routes.modelPlaceholder")}
            />,
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("settings.up.moveUp", { n: index + 1 })}
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("settings.up.moveDown", { n: index + 1 })}
                disabled={busy || index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
            </div>,
          ])}
        />
      </div>

      <div className="mt-3">
        <Button type="submit" variant="outline" size="sm" disabled={busy}>
          {t("settings.routes.save")}
        </Button>
      </div>
    </Form>
  );
}
