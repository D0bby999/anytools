import type { Source } from "~/hooks/use-turn-stream";
import { RichText } from "~/components/rich-text";

/**
 * A solution or report body: the model's Markdown and LaTeX, rendered, with
 * citation markers as chips inline where the claim was made.
 *
 * The rendering and its safety rules (no raw HTML, no loaded images, KaTeX
 * without trust) live in components/rich-text.tsx, the one renderer every
 * answer surface shares.
 */
export function CitedBody({
  text,
  sources,
  streaming = false,
}: {
  text: string;
  sources: Source[];
  streaming?: boolean;
}) {
  return <RichText text={text} sources={sources} streaming={streaming} />;
}
