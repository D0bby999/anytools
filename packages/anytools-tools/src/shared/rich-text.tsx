import { Fragment, type ReactNode } from 'react';

/**
 * Fill `{name}` slots in a localized template with React nodes.
 *
 * Strings tables hold plain text; some sentences wrap a word in <code>, <em> or a link. The
 * template keeps the sentence in one piece so translators can reorder it, and the UI supplies
 * the nodes: `richText(s.note, { xls: <code>.xls</code>, link: <a …>…</a> })`. A slot with no
 * node is left as-is.
 */
export function richText(template: string, slots: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/\{(\w+)\}/g);
  return parts.map((part, i) => {
    // Odd indexes are the captured slot names; even indexes are literal text between them.
    const node = i % 2 === 1 ? (slots[part] ?? `{${part}}`) : part;
    // biome-ignore lint/suspicious/noArrayIndexKey: static template, order never changes
    return <Fragment key={i}>{node}</Fragment>;
  });
}
