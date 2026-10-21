/**
 * A model field with the connection's own models under it (plan 261021-1100
 * phase 4, after postclaw's model-select-modal): type to filter what the
 * provider lists for the learner's key and what they added, ↑ ↓ to choose,
 * Enter to take one, Escape to close. Any id can still be typed, because an
 * OpenAI-compatible server may serve a model it does not list.
 *
 * The list is fetched once per connection, when the field is first opened.
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriggerMenu, optionId, type TriggerItem } from "~/components/chat/composer/trigger-menu";
import { useConnectionModels } from "~/hooks/use-connection-models";
import { fold } from "~/lib/chat-search";
import { modelKind } from "~/lib/provider-catalog";

/** Most options drawn; the search reaches the rest. */
const SHOWN = 60;

export function ModelPicker({
  connectionId,
  value,
  onChange,
  label,
  name,
  required,
  placeholder,
}: {
  connectionId: string | null;
  value: string;
  onChange: (model: string) => void;
  label: string;
  name?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation("common");
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const { data, loading } = useConnectionModels(connectionId, open || touched);

  const items: TriggerItem[] = useMemo(() => {
    if (!data?.ok) return [];
    const query = fold(value.trim());
    const custom = new Set(data.custom);
    const all = [...data.custom, ...data.models.filter((m) => !custom.has(m))];
    return all
      .filter((m) => !query || fold(m).includes(query))
      .slice(0, SHOWN)
      .map((m) => ({
        key: m,
        label: m,
        detail: custom.has(m)
          ? t("settings.models.added")
          : modelKind(m) === "chat"
            ? undefined
            : t(`settings.models.kinds.${modelKind(m)}`),
      }));
  }, [data, value, t]);

  const pick = (i: number) => {
    const item = items[i];
    if (!item) return;
    onChange(item.key);
    setOpen(false);
  };
  const empty = loading
    ? t("settings.models.loading")
    : data && !data.ok
      ? data.error || t("settings.models.unavailable")
      : data?.ok && data.list_error && items.length === 0
        ? data.list_error
        : t("settings.models.none");

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        name={name}
        aria-label={label}
        aria-expanded={open}
        aria-controls={menuId}
        aria-autocomplete="list"
        aria-activedescendant={open && items.length > 0 ? optionId(menuId, active) : undefined}
        autoComplete="off"
        spellCheck={false}
        required={required}
        value={value}
        placeholder={placeholder}
        disabled={!connectionId}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setTouched(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return setOpen(true);
            const n = items.length;
            if (n) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter" && open && items.length > 0) {
            e.preventDefault();
            pick(active);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="h-10 w-full min-w-0 rounded-md border border-control-border bg-card px-3 font-mono text-sm disabled:opacity-60"
      />
      {open ? (
        <TriggerMenu
          id={menuId}
          label={t("settings.models.title")}
          items={items}
          active={active}
          empty={empty}
          onPick={pick}
          onHover={setActive}
          placement="below"
        />
      ) : null}
    </div>
  );
}
