import type { MDXComponents } from 'mdx/types';
import { MDXRemote } from 'next-mdx-remote/rsc';
import type { AnchorHTMLAttributes, HTMLAttributes, PropsWithChildren } from 'react';

const components: MDXComponents = {
  h1: ({ children }: PropsWithChildren) => (
    <h1 className="text-3xl font-bold mt-8 mb-4">{children}</h1>
  ),
  h2: ({ children }: PropsWithChildren) => (
    <h2 className="text-2xl font-semibold mt-8 mb-3">{children}</h2>
  ),
  h3: ({ children }: PropsWithChildren) => (
    <h3 className="text-xl font-semibold mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }: PropsWithChildren) => <p className="leading-7 mb-4">{children}</p>,
  ul: ({ children }: PropsWithChildren) => (
    <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>
  ),
  ol: ({ children }: PropsWithChildren) => (
    <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>
  ),
  li: ({ children }: PropsWithChildren) => <li>{children}</li>,
  a: ({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      className="text-primary underline underline-offset-4 hover:opacity-80"
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  ),
  code: ({ children }: PropsWithChildren) => (
    <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">{children}</code>
  ),
  pre: ({ children }: PropsWithChildren) => (
    <pre className="rounded-lg bg-muted p-4 overflow-x-auto text-sm font-mono mb-4">{children}</pre>
  ),
  blockquote: ({ children }: PropsWithChildren) => (
    <blockquote className="border-l-4 border-primary pl-4 italic text-muted-foreground my-4">
      {children}
    </blockquote>
  ),
  hr: (_: HTMLAttributes<HTMLHRElement>) => <hr className="my-8 border-border" />,
  table: ({ children }: PropsWithChildren) => (
    <table className="w-full border-collapse my-4 text-sm">{children}</table>
  ),
  th: ({ children }: PropsWithChildren) => (
    <th className="border border-border px-3 py-2 text-left bg-muted font-medium">{children}</th>
  ),
  td: ({ children }: PropsWithChildren) => (
    <td className="border border-border px-3 py-2">{children}</td>
  ),
};

export interface MdxContentProps {
  source: string;
}

export function MdxContent({ source }: MdxContentProps) {
  return (
    <div className="max-w-3xl">
      <MDXRemote source={source} components={components} />
    </div>
  );
}
