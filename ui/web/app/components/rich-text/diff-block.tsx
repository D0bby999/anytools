import { useTranslation } from "react-i18next";
import { parseDiff } from "~/lib/diff-lines";
import { CodeFrame } from "./code-block";

/**
 * A `diff` fence as a diff (after postclaw's `render/diff-block.tsx`): an
 * added line has a + and a green tint, a removed one a − and a red tint, so
 * the sign says it where the colour cannot. Rows are React elements built from
 * parsed data, never HTML. Copy takes the diff as written.
 */
export function DiffBlock({ text }: { text: string }) {
  const { t } = useTranslation("common");
  const diff = parseDiff(text);
  return (
    <CodeFrame
      kind="diff"
      copy={text}
      label={
        <>
          {t("richText.diff")}{" "}
          <span className="lp-diff-count" data-diff="add" aria-hidden="true">
            +{diff.added}
          </span>{" "}
          <span className="lp-diff-count" data-diff="remove" aria-hidden="true">
            −{diff.removed}
          </span>
          <span className="sr-only">{t("richText.diffCount", { added: diff.added, removed: diff.removed })}</span>
        </>
      }
    >
      <code className="lp-diff">
        {diff.rows.map((row, i) => (
          <span key={i} className="lp-diff-row" data-diff={row.kind}>
            <span className="lp-diff-sign">{row.sign === "-" ? "−" : row.sign}</span>
            {row.text === "" ? "\u00a0" : row.text}
            {"\n"}
          </span>
        ))}
      </code>
      {diff.clipped ? <span className="lp-diff-note">{t("richText.diffClipped", { count: diff.rows.length })}</span> : null}
    </CodeFrame>
  );
}
