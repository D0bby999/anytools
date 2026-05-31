'use client';

import { useEffect, useId, useState } from 'react';

type MermaidDiagramProps = {
  code: string;
};

export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const reactId = useId();
  const domId = `mermaid-${reactId.replace(/[^a-z0-9]/gi, '')}`;
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    let mounted = true;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'strict',
          fontFamily: 'inherit',
        });
        const { svg: rendered } = await mermaid.render(domId, code);
        if (!cancelled && mounted) setSvg(rendered);
      } catch (err) {
        if (!cancelled && mounted) {
          setError(err instanceof Error ? err.message : 'Mermaid render failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      mounted = false;
    };
  }, [code, domId]);

  if (error) {
    return (
      <div className="my-6 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        <p className="font-semibold mb-1">Diagram failed to render</p>
        <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div
      className="my-6 flex justify-center overflow-x-auto [&_svg]:max-w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid output is SVG from trusted lib
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
