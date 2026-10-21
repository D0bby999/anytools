import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Field } from "~/components/doc/field";
import type { MineKB } from "~/lib/mine";

/**
 * Which knowledge base an upload or a link goes into, then the form for it.
 * The newest base is chosen first; with no base yet the learner is sent to
 * make one, since every document belongs to a base.
 */
export function KBTarget({ kbs, label, children }: { kbs: MineKB[]; label: string; children: (kbId: string) => ReactNode }) {
  const { t } = useTranslation("common");
  const [kbId, setKbId] = useState(kbs[0]?.id ?? "");

  if (kbs.length === 0) {
    return (
      <p className="lp-empty">
        {t("mine.noKb")}{" "}
        <Link to="/knowledge" className="font-medium text-primary underline underline-offset-4">
          {t("mine.noKbAction")}
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <Field label={label}>
          <select value={kbId} onChange={(e) => setKbId(e.target.value)}>
            {kbs.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {/* Keyed, so a form's own state (a picked file, a typed URL) starts
          over when the target base changes. */}
      <div key={kbId}>{children(kbId)}</div>
    </div>
  );
}
