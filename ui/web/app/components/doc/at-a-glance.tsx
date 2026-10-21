import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * "At a glance": the short list up opens a long chapter with, under its own
 * h2 so the outline lists it. Pattern P1 in reports/feature-ui-spec.md.
 */
export function AtAGlance({ items, title, id }: { items: ReactNode[]; title?: ReactNode; id?: string }) {
  const { t } = useTranslation("common");
  const fallbackId = useId();
  const headingId = id ?? `at-a-glance-${fallbackId.replace(/:/g, "")}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{title ?? t("doc.atAGlance")}</h2>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
