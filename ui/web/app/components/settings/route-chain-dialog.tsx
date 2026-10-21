/**
 * One function's fallback chain, shown as a line and edited in a dialog (plan
 * 261021-1100 phase 4, after postclaw's route-chain-modal).
 *
 * In the dialog the chain is a list: drag a row by its handle, or focus the
 * handle and press Alt+↑ or Alt+↓ (the arrow buttons do the same), and a
 * polite live region says where the row went. Each row names a connection and
 * a model, picked from the connection's own list. Save submits the whole
 * chain as one form, the shape the action has always read (connection_N,
 * model_N in order), because the API replaces a chain atomically: moving
 * single positions would cross the (user, function, position) unique index.
 */
import { useId, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import { Dialog } from "~/components/doc/dialog";
import { Button } from "~/components/ui/button";
import type { CatalogEntry, Connection, RouteEntry } from "~/lib/byok.types";
import { cn } from "~/lib/utils";
import { ModelPicker } from "./model-picker";

type Row = { key: number; connection_id: string; model: string };

/** A row moved from one place to another: the reorder behind drag and the keys. */
export function moveRow<T>(rows: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

export function RouteChainDialog({
  fn,
  entries,
  connections,
  catalog,
  maxEntries,
}: {
  fn: string;
  entries: RouteEntry[];
  connections: Connection[];
  catalog: CatalogEntry[];
  maxEntries: number;
}) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const title = t(`settings.functions.${fn}` as never, { defaultValue: fn });
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const fresh = (e?: RouteEntry): Row => ({
    key: seq.current++,
    connection_id: e?.connection_id ?? "",
    model: e?.model ?? "",
  });
  const [rows, setRows] = useState<Row[]>(() => entries.map((e) => fresh(e)));
  const [said, setSaid] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const listId = useId();

  const byId = new Map(connections.map((c) => [c.id, c]));
  const needsModel = (connectionId: string) =>
    !!catalog.find((p) => p.type === byId.get(connectionId)?.provider)?.needs_model;

  const openEditor = () => {
    setRows(entries.length ? entries.map((e) => fresh(e)) : [fresh()]);
    setSaid("");
    setOpen(true);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    setRows((r) => moveRow(r, from, to));
    setSaid(t("settings.routes.moved", { from: from + 1, to: to + 1 }));
    // Keep the moved row's handle focused, so Alt+arrow can go on.
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`#${CSS.escape(listId)} [data-row="${to}"] [data-handle]`)?.focus(),
    );
  };
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const summary = entries.length
    ? entries
        .map((e) => {
          const c = byId.get(e.connection_id);
          return `${c?.name ?? "?"}${e.model ? ` · ${e.model}` : ""}`;
        })
        .join(" → ")
    : t("settings.routes.empty");

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b py-4">
      <div className="min-w-0 flex-1">
        <h3 className="font-sans text-base font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-prose break-words text-muted-foreground">{summary}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={openEditor} aria-label={t("settings.routes.editFor", { fn: title })}>
        {t("settings.routes.edit")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={t(`settings.functionHelp.${fn}` as never, { defaultValue: t("settings.routes.dialogHelp") })}
      >
        <Form method="post" onSubmit={() => setOpen(false)}>
          <input type="hidden" name="function" value={fn} />
          <p className="mt-2 text-xs leading-prose text-muted-foreground">{t("settings.routes.reorderHelp")}</p>
          <ol id={listId} className="mt-3 grid list-none gap-2 p-0">
            {rows.map((row, i) => (
              <li
                key={row.key}
                data-row={i}
                onDragOver={(e) => {
                  if (dragging === null) return;
                  e.preventDefault();
                  if (dragging !== i) {
                    setRows((r) => moveRow(r, dragging, i));
                    setDragging(i);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging !== null) setSaid(t("settings.routes.movedTo", { to: i + 1 }));
                  setDragging(null);
                }}
                className={cn(
                  "grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-md border bg-card p-2",
                  dragging === i && "border-control-border bg-selected",
                )}
              >
                <button
                  type="button"
                  data-handle=""
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                    setDragging(i);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                    e.preventDefault();
                    move(i, e.key === "ArrowUp" ? i - 1 : i + 1);
                  }}
                  aria-label={t("settings.routes.handle", { n: i + 1 })}
                  className="flex size-10 cursor-grab items-center justify-center rounded-md text-deco hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                >
                  <GripVertical aria-hidden="true" className="size-4" />
                </button>

                <div className="grid min-w-0 gap-2">
                  <select
                    aria-label={t("settings.routes.connectionAt", { position: i + 1 })}
                    name={`connection_${i}`}
                    value={row.connection_id}
                    onChange={(e) => update(i, { connection_id: e.target.value, model: "" })}
                    className="h-10 min-w-0 rounded-md border border-control-border bg-card px-2 text-sm"
                  >
                    <option value="">{t("settings.routes.none")}</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <ModelPicker
                    name={`model_${i}`}
                    connectionId={row.connection_id || null}
                    value={row.model}
                    onChange={(model) => update(i, { model })}
                    label={t("settings.routes.modelAt", { position: i + 1 })}
                    required={!!row.connection_id && needsModel(row.connection_id)}
                    placeholder={t("settings.routes.modelPlaceholder")}
                  />
                </div>

                <div className="flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("settings.up.moveUp", { n: i + 1 })}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("settings.up.moveDown", { n: i + 1 })}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("settings.routes.removeAt", { n: i + 1 })}
                    onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <p role="status" aria-live="polite" className="sr-only">
            {said}
          </p>
          {rows.length < maxEntries ? (
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setRows((r) => [...r, fresh()])}>
              <Plus aria-hidden="true" />
              {t("settings.routes.addFallback")}
            </Button>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("settings.up.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("settings.routes.save")}
            </Button>
          </div>
        </Form>
      </Dialog>
    </div>
  );
}
