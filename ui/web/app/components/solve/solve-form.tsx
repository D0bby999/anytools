import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { OwnVersionFields } from "~/components/chat/own-version-fields";
import { emptyOwnVersion, ownVersionComplete, type OwnVersion } from "~/lib/own-version";

/**
 * The solve form: a typed problem, a photo, or both; optionally "check my
 * answer" with the learner's own working.
 *
 * It posts multipart through the route's action, which reads the file on the
 * server and forwards it to the API as base64. The browser never encodes the
 * image itself, and never talks to the API.
 *
 * With "write my own version first" on (up-methods phase 11), the three lines
 * come first and the submit button waits for them; the API refuses the solve
 * without them anyway.
 */
export function SolveForm<T>({
  fetcher,
  kbs,
  busy,
  onStop,
  ownVersionFirst = false,
  onOwnVersion,
}: {
  fetcher: FetcherWithComponents<T>;
  kbs: { id: string; name: string }[];
  busy: boolean;
  onStop: () => void;
  /** The learner's "write my own version first" switch. */
  ownVersionFirst?: boolean;
  /** Told the lines a solve was sent with, so its answer can offer a retell. */
  onOwnVersion?: (own: OwnVersion | undefined) => void;
}) {
  const { t } = useTranslation("solve");
  const { t: tOwn } = useTranslation("ownversion");
  const [variant, setVariant] = useState<"solve" | "check">("solve");
  const [own, setOwn] = useState<OwnVersion>(emptyOwnVersion);
  const ownReady = !ownVersionFirst || ownVersionComplete(own);
  const submitting = fetcher.state !== "idle";
  const field =
    "mt-1 w-full rounded-md border border-control-border bg-card px-3 text-sm";

  return (
    <fetcher.Form
      method="post"
      encType="multipart/form-data"
      className="space-y-4 rounded-lg border bg-card p-4"
      onSubmit={() => onOwnVersion?.(ownVersionFirst ? own : undefined)}
    >
      <input type="hidden" name="intent" value="solve" />
      {ownVersionFirst && <OwnVersionFields value={own} onChange={setOwn} idPrefix="lp-solve-own" />}
      <div>
        <label htmlFor="lp-solve-problem" className="block text-sm font-medium">
          {t("form.problem")}
        </label>
        <textarea
          id="lp-solve-problem"
          name="problem"
          rows={4}
          maxLength={32000}
          placeholder={t("form.problemPlaceholder")}
          className={field + " py-2 leading-prose"}
        />
      </div>

      <div>
        <label htmlFor="lp-solve-photo" className="block text-sm font-medium">
          {t("form.photo")}
        </label>
        <input
          id="lp-solve-photo"
          name="photo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-describedby="lp-solve-photo-hint"
          className="mt-1 block min-h-11 w-full text-sm"
        />
        <p id="lp-solve-photo-hint" className="mt-1 text-xs leading-snug text-muted-foreground">
          {t("form.photoHint")}
        </p>
      </div>

      {kbs.length > 0 && (
        <div>
          <label htmlFor="lp-solve-kb" className="block text-sm font-medium">
            {t("form.kb")}
          </label>
          <select id="lp-solve-kb" name="kb_id" defaultValue="" className={field + " min-h-11"}>
            <option value="">{t("form.kbNone")}</option>
            {kbs.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset>
        <legend className="text-sm font-medium">{t("form.variant")}</legend>
        <div className="mt-1 flex flex-wrap gap-x-5">
          {(["solve", "check"] as const).map((v) => (
            <label key={v} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name="variant"
                value={v}
                checked={variant === v}
                onChange={() => setVariant(v)}
              />
              {v === "solve" ? t("form.variantSolve") : t("form.variantCheck")}
            </label>
          ))}
        </div>
      </fieldset>

      {variant === "check" && (
        <div>
          <label htmlFor="lp-solve-answer" className="block text-sm font-medium">
            {t("form.userAnswer")}
          </label>
          <textarea
            id="lp-solve-answer"
            name="user_answer"
            rows={3}
            required
            maxLength={32000}
            placeholder={t("form.userAnswerPlaceholder")}
            className={field + " py-2 leading-prose"}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {busy ? (
          <Button type="button" variant="outline" onClick={onStop}>
            {t("form.stop")}
          </Button>
        ) : (
          <Button type="submit" disabled={submitting || !ownReady}>
            {submitting
              ? t("form.starting")
              : variant === "check"
                ? t("form.submitCheck")
                : t("form.submit")}
          </Button>
        )}
        <p className="text-xs leading-snug text-muted-foreground">
          {ownReady ? t("form.cost") : tOwn("fields.required")}
        </p>
      </div>
    </fetcher.Form>
  );
}
