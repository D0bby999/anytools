/**
 * Quick setup (the private design notes, phase 2): one connection for
 * every task that has none yet, instead of eleven chains set one by one.
 *
 * The learner picks one model for the chat tasks (answers, quizzes, study
 * paths, the reading tutor, solving, research, ranking) and, when the
 * provider can index, one embeddings model. Tasks that already have a chain
 * keep it; speech is left for later. The dialog ends by saying what it set
 * and what it left empty, by name.
 */
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Dialog } from "~/components/doc/dialog";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { useConnectionModels } from "~/hooks/use-connection-models";
import type { CatalogEntry, Connection, QuickSetupResult } from "~/lib/byok.types";
import { providerName } from "~/lib/provider-names";
import { ModelPicker } from "./model-picker";

export function QuickSetupDialog({
  open,
  onClose,
  connections,
  catalog,
  initialConnectionId,
}: {
  open: boolean;
  onClose: () => void;
  /** The connections to choose from; one means no choice is shown. */
  connections: Connection[];
  catalog: CatalogEntry[];
  initialConnectionId?: string;
}) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher<QuickSetupResult>();
  const usable = connections.filter((c) => c.kind === "api_key" || c.kind === "oauth_relay" || c.kind === "oauth_gemini_sub");
  const [connectionId, setConnectionId] = useState(initialConnectionId ?? usable[0]?.id ?? "");
  const [chatModel, setChatModel] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [sent, setSent] = useState(false);

  const conn = usable.find((c) => c.id === connectionId) ?? null;
  const entry = conn ? catalog.find((p) => p.type === conn.provider) : undefined;
  const needsModel = entry?.needs_model ?? false;
  const canEmbed = entry ? entry.serves.includes("embed") : false;
  const name = conn ? conn.name || providerName(t, conn.provider) : "";

  // An embeddings model is usually named so; offer the first one the
  // provider lists rather than an empty box.
  const { data } = useConnectionModels(open && canEmbed && needsModel ? connectionId : null, open);
  useEffect(() => {
    if (!open) return;
    setChatModel(conn?.verified_model ?? "");
    setSent(false);
  }, [open, connectionId, conn?.verified_model]);
  useEffect(() => {
    if (!data?.ok || embedModel) return;
    const found = [...data.custom, ...data.models].find((m) => /embed/i.test(m));
    if (found) setEmbedModel(found);
  }, [data, embedModel]);

  const result = sent && fetcher.state === "idle" ? fetcher.data : undefined;
  const busy = fetcher.state !== "idle";
  const fnName = (fn: string) => t(`settings.functions.${fn}` as never, { defaultValue: fn });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={name ? t("settings.quick.title", { name }) : t("settings.quick.fillEmpty")}
      description={t("settings.quick.lead")}
    >
      {result?.ok ? (
        <div className="mt-3 grid gap-3 text-sm leading-prose" role="status">
          <p>{result.set.length ? t("settings.quick.done", { count: result.set.length }) : t("settings.quick.nothing")}</p>
          {result.left.length ? <p className="text-muted-foreground">{t("settings.quick.left", { list: result.left.map(fnName).join(", ") })}</p> : null}
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              {t("settings.quick.close")}
            </Button>
          </div>
        </div>
      ) : (
        <fetcher.Form
          method="post"
          action="/app/api/quick-setup"
          className="mt-3 grid gap-4"
          onSubmit={() => setSent(true)}
        >
          {usable.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("settings.quick.connection")}</span>
              <select
                name="connection"
                value={connectionId}
                onChange={(e) => {
                  setConnectionId(e.target.value);
                  setEmbedModel("");
                }}
                className="h-10 rounded-md border border-control-border bg-card px-2 text-sm"
              >
                {usable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || providerName(t, c.provider)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="connection" value={connectionId} />
          )}
          <ModelPicker
            name="chat_model"
            connectionId={connectionId || null}
            value={chatModel}
            onChange={setChatModel}
            label={t("settings.quick.chatModel")}
            required={needsModel}
            placeholder={needsModel ? t("settings.routes.modelPlaceholder") : t("settings.quick.defaultModel")}
          />
          {canEmbed ? (
            <div className="grid gap-1">
              <ModelPicker
                name="embed_model"
                connectionId={connectionId || null}
                value={embedModel}
                onChange={setEmbedModel}
                label={t("settings.quick.embedModel")}
                placeholder={needsModel ? "nomic-embed-text" : t("settings.quick.defaultModel")}
              />
              <p className="text-xs leading-prose text-muted-foreground">{t("settings.quick.embedHelp")}</p>
            </div>
          ) : conn ? (
            <p className="text-sm leading-prose text-muted-foreground">
              {t("settings.quick.noEmbed", { provider: providerName(t, conn.provider) })}
            </p>
          ) : null}
          {result && !result.ok ? <Alert variant="destructive">{result.error}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("settings.up.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !connectionId}>
              {busy ? t("settings.quick.working") : t("settings.quick.submit")}
            </Button>
          </div>
        </fetcher.Form>
      )}
    </Dialog>
  );
}
