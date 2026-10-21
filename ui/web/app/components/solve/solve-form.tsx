import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/doc/field";
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

  return (
    <fetcher.Form
      method="post"
      encType="multipart/form-data"
      className="flex flex-col gap-1"
      onSubmit={() => onOwnVersion?.(ownVersionFirst ? own : undefined)}
    >
      <input type="hidden" name="intent" value="solve" />
      {ownVersionFirst && <OwnVersionFields value={own} onChange={setOwn} idPrefix="lp-solve-own" />}
      {/* I4, multi-line: the search field's box round a textarea. */}
      <Field label={t("form.problem")}>
        <textarea
          id="lp-solve-problem"
          name="problem"
          rows={4}
          maxLength={32000}
          placeholder={t("form.problemPlaceholder")}
          className="resize-y py-2 leading-6"
        />
      </Field>

      <div className="my-2">
        <label htmlFor="lp-solve-photo" className="block text-sm leading-6 font-medium">
          {t("form.photo")}
        </label>
        <input
          id="lp-solve-photo"
          name="photo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-describedby="lp-solve-photo-hint"
          className="mt-2 lp-file"
        />
        <p id="lp-solve-photo-hint" className="mt-2 text-[13px] leading-5 text-muted-foreground">
          {t("form.photoHint")}
        </p>
      </div>

      {kbs.length > 0 && (
        // Grounded in the learner's own notes by default when they have some;
        // "Nothing" stays one choice away.
        <Field label={t("form.kb")}>
          <select id="lp-solve-kb" name="kb_id" defaultValue={kbs[0]?.id ?? ""}>
            <option value="">{t("form.kbNone")}</option>
            {kbs.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <fieldset className="my-2">
        <legend className="text-sm leading-6 font-medium">{t("form.variant")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["solve", "check"] as const).map((v) => (
            <label key={v} className={CHOICE}>
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
        <Field label={t("form.userAnswer")}>
          <textarea
            id="lp-solve-answer"
            name="user_answer"
            rows={3}
            required
            maxLength={32000}
            placeholder={t("form.userAnswerPlaceholder")}
            className="resize-y py-2 leading-6"
          />
        </Field>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
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
        <p className="text-sm leading-6 text-muted-foreground">
          {ownReady ? t("form.cost") : tOwn("fields.required")}
        </p>
      </div>
    </fetcher.Form>
  );
}

/**
 * A selectable row (I1), as a search result: a 2px hairline, radius 4, the
 * action ink when hovered or chosen. Shared with the research form's modes.
 */
export const CHOICE =
  "flex min-h-10 cursor-pointer items-center gap-2 rounded-[4px] border-2 border-border bg-card px-3 py-2 text-sm transition-colors " +
  "hover:border-primary has-checked:border-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary";
