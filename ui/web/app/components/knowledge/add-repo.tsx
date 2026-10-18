import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { GitBranch } from "lucide-react";
import { Button } from "~/components/ui/button";
import { DriveFileNotice } from "~/components/storage/drive-file-notice";
import type { RepoDefaults, SourceActionData } from "~/lib/sources-types";

/**
 * add-repo.tsx
 * "Add a repository" (up-methods phase 18): a GitHub repository, or one folder
 * of it, imported from one download of its latest commit.
 *
 * Documentation types are ticked by default, as DeepTutor imports; code types
 * are offered unticked (gitingest's mode), because every file is embedded on
 * the learner's own key. Ignore paths use .gitignore syntax, on top of the
 * built-in list. A private repository needs the learner's GitHub token, saved
 * under Settings → Search keys.
 */
const fieldClass =
  "min-h-11 w-full min-w-0 rounded-md border border-control-border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

export function AddRepo({ kbId, defaults }: { kbId: string; defaults: RepoDefaults }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<SourceActionData>();
  const form = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  useEffect(() => {
    if (data?.ok) form.current?.reset();
  }, [data]);

  return (
    <fetcher.Form ref={form} method="post" action="/app/api/sources" className="space-y-3">
      <input type="hidden" name="intent" value="add-repo" />
      <input type="hidden" name="kb" value={kbId} />
      <label htmlFor="lp-repo-url" className="block text-sm font-medium">
        {t("repo.urlLabel")}
      </label>
      <input
        id="lp-repo-url"
        name="url"
        type="url"
        inputMode="url"
        required
        autoComplete="off"
        placeholder="https://github.com/owner/repository"
        aria-describedby="lp-repo-hint"
        className={fieldClass}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("repo.branch")}</span>
          <input name="branch" autoComplete="off" placeholder={t("repo.branchPlaceholder")} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("repo.path")}</span>
          <input name="path" autoComplete="off" placeholder={t("repo.pathPlaceholder")} className={fieldClass} />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm">{t("repo.types")}</legend>
        <ExtensionGroup label={t("repo.docTypes")} extensions={defaults.doc_extensions} checked />
        <ExtensionGroup label={t("repo.codeTypes")} extensions={defaults.code_extensions} checked={false} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">{t("repo.moreTypes")}</span>
          <input name="more_ext" autoComplete="off" placeholder=".proto, .graphql" className={fieldClass} />
        </label>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("repo.ignore")}</span>
        <textarea
          name="ignore"
          rows={3}
          placeholder={"drafts/\n*.generated.md"}
          className="w-full min-w-0 rounded-md border border-control-border bg-card px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          <GitBranch aria-hidden="true" />
          {busy ? t("repo.adding") : t("repo.submit")}
        </Button>
      </div>
      <p id="lp-repo-hint" className="text-xs leading-snug text-muted-foreground">
        {t("repo.hint", {
          files: defaults.max_files.toLocaleString("en"),
          fileMB: Math.round(defaults.max_file_bytes / (1 << 20)),
          repoMB: Math.round(defaults.max_repo_bytes / (1 << 20)),
        })}
      </p>
      {data?.ok ? (
        <p role="status" className="text-sm leading-snug text-muted-foreground">
          {t("repo.added", { title: data.title ?? "" })}
        </p>
      ) : null}
      {data && !data.ok && data.driveReason ? (
        <DriveFileNotice reason={data.driveReason} />
      ) : data && !data.ok ? (
        <p role="alert" className="text-sm leading-snug text-destructive">
          {t("sources.errors.repoFailed")}
          {data.error ? ` ${data.error}` : ""}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

function ExtensionGroup({ label, extensions, checked }: { label: string; extensions: string[]; checked: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-faint">{label}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {extensions.map((ext) => (
          <label key={ext} className="inline-flex min-h-11 items-center gap-1.5 font-mono text-xs">
            <input type="checkbox" name="ext" value={ext} defaultChecked={checked} className="size-4 accent-primary" />
            {ext}
          </label>
        ))}
      </div>
    </div>
  );
}
