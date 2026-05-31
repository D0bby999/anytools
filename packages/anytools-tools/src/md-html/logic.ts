import { marked } from 'marked';
import TurndownService from 'turndown';

export type MdToHtmlOptions = {
  gfm?: boolean;
  breaks?: boolean;
};

export function markdownToHtml(md: string, options: MdToHtmlOptions = {}): string {
  marked.setOptions({
    gfm: options.gfm ?? true,
    breaks: options.breaks ?? false,
  });
  return marked.parse(md, { async: false }) as string;
}

export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  return turndown.turndown(html);
}
