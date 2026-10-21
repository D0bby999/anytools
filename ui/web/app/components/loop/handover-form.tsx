/**
 * handover-form.tsx
 * Resume in a new chat, and bring its update back.
 *
 * The resumed chat ends with a fenced block. Pasting it here CHECKS it first —
 * the shape, the six-bullet limit, and that it was written against this exact
 * version of the state — and only a block that passes can be accepted into the
 * handover note. The same block cannot be accepted twice: accepting it changes
 * the state, and with it the version the block was written against.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { HandoverResult } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";

export function HandoverForm({ result, busy }: { result: HandoverResult | null; busy: boolean }) {
  const { t } = useTranslation("loop");
  return (
    <div>
      <Form method="post">
        <input type="hidden" name="intent" value="resume" />
        <p className="mt-0! text-muted-foreground">{t("resume.lead")}</p>
        <Button type="submit" variant="outline" disabled={busy}>
          {t("resume.open")}
        </Button>
      </Form>

      <Form method="post" className="mt-6 space-y-2">
        <input type="hidden" name="intent" value="handover" />
        <label htmlFor="lp-handover-text" className="block text-sm font-medium">
          {t("resume.paste")}
        </label>
        <textarea
          id="lp-handover-text"
          name="text"
          rows={6}
          required
          className="w-full rounded-md border border-control-border bg-card px-3 py-2 font-mono text-xs"
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="accept_next_task" value="1" />
          {t("resume.takeNextTask")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="accept" value="" variant="outline" disabled={busy}>
            {t("resume.check")}
          </Button>
          <Button type="submit" name="accept" value="1" disabled={busy}>
            {t("resume.accept")}
          </Button>
        </div>
      </Form>

      {result ? (
        <div role="status" className="mt-4 rounded-lg border bg-muted px-4 py-2 text-sm">
          {result.accepted ? (
            <p>{t("resume.accepted")}</p>
          ) : result.valid ? (
            <p>{t("resume.valid")}</p>
          ) : (
            <>
              <p className="text-destructive">{t("resume.invalid")}</p>
              <ul className="mt-1 leading-prose space-y-1">
                {result.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          {result.paste_back && !result.accepted ? (
            <ul className="mt-2 text-muted-foreground space-y-1">
              {result.paste_back.restated.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
