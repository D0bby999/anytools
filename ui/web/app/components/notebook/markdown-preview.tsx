import { RichText } from "~/components/rich-text";

/**
 * A note's Markdown, rendered.
 *
 * Notes are written by the learner AND by the model (`write_note`, saved tutor
 * answers, research reports), so the body is untrusted. It goes through the
 * same renderer as every answer (RichText: no raw HTML, safe links, images as
 * links, KaTeX without trust), so a report saved here keeps its tables and
 * formulas. A note has no turn behind it, so citation markers resolve to
 * nothing and are not shown.
 */
export function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="text-sm">
      <RichText text={source} sources={[]} />
    </div>
  );
}
