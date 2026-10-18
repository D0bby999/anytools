import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { NoRemoteImage } from "~/components/no-remote-image";

/**
 * A tool's article or FAQ: Markdown with GFM tables. The files are named
 * `.mdx` but use no components (the corpus was checked when it was ported),
 * so no MDX compiler runs here and nothing in them executes:
 *
 * - raw HTML is never rendered: `rehype-raw` is off, so the `<script>` and
 *   `<textarea>` samples in the HTML tools' articles arrive as text;
 * - react-markdown's URL transform drops `javascript:` and similar schemes;
 * - images are links, never loaded, as everywhere else in the app.
 *
 * Under a tool, the page already has an h1 and the section its own h2, so the
 * article's headings step down one level. A guide or a legal page is the
 * whole page (`standalone`): its sections are h2, under the page's own h1.
 */
const COMPONENTS: Components = {
  h1: ({ node: _node, ...props }) => <h3 {...props} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} />,
  h4: ({ node: _node, ...props }) => <h5 {...props} />,
  a: ({ node: _node, href, children, ...props }) => {
    const external = typeof href === "string" && /^https?:\/\//i.test(href);
    return (
      <a href={href} {...props} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  },
  img: NoRemoteImage,
};

const STANDALONE: Components = {
  ...COMPONENTS,
  h1: ({ node: _node, ...props }) => <h2 {...props} />,
  h2: ({ node: _node, ...props }) => <h2 {...props} />,
  h3: ({ node: _node, ...props }) => <h3 {...props} />,
  h4: ({ node: _node, ...props }) => <h4 {...props} />,
};

export function Article({ source, standalone = false }: { source: string; standalone?: boolean }) {
  return (
    <div className="lp-prose lp-rich">
      <Markdown remarkPlugins={[remarkGfm]} components={standalone ? STANDALONE : COMPONENTS}>
        {source}
      </Markdown>
    </div>
  );
}
