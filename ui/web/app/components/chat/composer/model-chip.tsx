/**
 * model-chip.tsx — which model this conversation asks (after postclaw's
 * composer model chip, docs/chat-surface.md).
 *
 * One rule on both surfaces, the chip and its menu: an option reads as the
 * name the learner gave the connection, then the model it will call in the
 * caption ink, on one line that truncates the model before the name. The
 * route's own order is "Default", with its head named. While a switch is
 * being saved the chip already names the pick, its label sweeps and it is
 * busy; a refused switch falls back to what the conversation really uses and
 * says so. One connection is named without a menu, since there is nothing
 * to choose; with none on the chat route there is no chip at all, never a
 * raw model id.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { LiveLabel } from "~/components/chat/shared/live-label";
import { fold } from "~/lib/chat-search";
import { cn } from "~/lib/utils";

export type ModelOption = { id: string; name: string; model: string };

/** An entry's value: a route may hold one connection twice. */
export function modelKey(m: { id: string; model: string }): string {
  return `${m.id}::${m.model}`;
}

/** A search box appears in the menu past this many options. */
const SEARCH_FROM = 6;

function Name({ name, model }: { name: string; model?: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="max-w-[60%] shrink-0 truncate">{name}</span>
      {model ? <span className="min-w-0 truncate font-normal text-muted-foreground">{model}</span> : null}
    </span>
  );
}

export function ModelChip({
  models,
  value,
  onChange,
  pending = false,
  failed = false,
  disabled = false,
}: {
  /** The chat route's entries, in route order. */
  models: ModelOption[];
  /** The pinned entry's modelKey, or "" for the route's order. */
  value: string;
  onChange: (key: string) => void;
  /** A switch is being saved; `value` is already the pick. */
  pending?: boolean;
  /** The last switch was refused; `value` is what the conversation uses. */
  failed?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const head = models[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return q === "" ? models : models.filter((m) => fold(`${m.name} ${m.model}`).includes(q));
  }, [models, query]);

  if (!head) return null;
  const current = models.find((m) => modelKey(m) === value);
  const label = current ?? head;

  // One connection is no choice: the model in use, named, without a menu.
  if (models.length === 1) {
    return (
      <span className="flex h-8 max-w-72 min-w-0 items-center px-2 text-xs font-medium text-foreground">
        <span className="sr-only">{t("chat.model.chip", { name: head.name, model: head.model })}</span>
        <span aria-hidden="true" className="min-w-0">
          <Name name={head.name} model={head.model} />
        </span>
      </span>
    );
  }

  function pick(key: string) {
    setOpen(false);
    button.current?.focus();
    if (key !== value) onChange(key);
  }

  const option = (key: string, m: ModelOption, isDefault: boolean) => {
    const checked = key === value;
    return (
      <button
        key={key || "default"}
        type="button"
        role="menuitemradio"
        aria-checked={checked}
        onClick={() => pick(key)}
        className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
      >
        <Check aria-hidden="true" className={cn("size-3.5 shrink-0", checked ? "text-primary" : "invisible")} />
        <span className="min-w-0 flex-1">
          <Name name={m.name} model={m.model} />
        </span>
        {isDefault ? (
          <span className="shrink-0 rounded-sm border px-1.5 text-xs leading-5 text-muted-foreground">{t("chat.model.badge")}</span>
        ) : null}
      </button>
    );
  };

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={pending || undefined}
        aria-label={t("chat.model.chip", { name: label.name, model: label.model })}
        disabled={disabled || pending}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 max-w-72 min-w-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground transition-colors",
          "hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60",
        )}
      >
        {pending ? (
          <LiveLabel live className="truncate">
            {label.name}
          </LiveLabel>
        ) : (
          <Name name={label.name} model={label.model} />
        )}
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-deco" />
      </button>
      {failed ? (
        <p role="status" className="absolute bottom-full left-2 mb-1 text-xs whitespace-nowrap text-destructive">
          {t("chat.model.failed")}
        </p>
      ) : null}
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("chat.model.label")}
          className="absolute bottom-full left-0 z-dropdown mb-1 flex max-h-80 w-80 max-w-[calc(100vw-2rem)] flex-col rounded-xl border bg-card p-2 shadow-md"
        >
          {models.length >= SEARCH_FROM ? (
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("chat.model.search")}
              placeholder={t("chat.model.search")}
              className="mb-2 h-8 rounded-md border border-control-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          ) : null}
          <div className="min-h-0 overflow-y-auto">
            {query.trim() === "" ? option("", head, true) : null}
            {shown.map((m) => option(modelKey(m), m, false))}
            {shown.length === 0 ? <p className="px-2 py-1 text-sm text-muted-foreground">{t("chat.model.none")}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
