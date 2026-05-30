'use client';
import { useEffect, useState } from 'react';

type Demo = {
  slug: string;
  cluster: string;
  label: string;
  input: string;
  output: string;
};

const DEMOS: Demo[] = [
  {
    slug: 'json-formatter',
    cluster: 'formatters',
    label: 'JSON Formatter',
    input: '{"name":"Alice","items":[1,2,3],"active":true}',
    output: `{
  "name": "Alice",
  "items": [1, 2, 3],
  "active": true
}`,
  },
  {
    slug: 'base64-encode',
    cluster: 'encoding',
    label: 'Base64',
    input: 'Hello 🌏 cà phê!',
    output: 'SGVsbG8g8J+MjyBjw6AgcGjDqiE=',
  },
  {
    slug: 'uuid-generator',
    cluster: 'generators',
    label: 'UUID v7',
    input: '— generate —',
    output: '01913d2c-9f0b-7000-8b3a-d4f8e2c1a9b7',
  },
  {
    slug: 'qr-code-generator',
    cluster: 'generators',
    label: 'QR Code',
    input: 'https://anytools.world',
    output: '▢▢▢ ▢ ▢▢▢\n▢ ▢ ▢ ▢ ▢\n▢▢▢ ▢ ▢▢▢\n   ▢ ▢ ▢  \n▢▢▢ ▢ ▢▢▢',
  },
];

export function HeroDemo() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % DEMOS.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  const demo = DEMOS[index];
  if (!demo) return null;

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {/* Tab strip */}
        <div className="flex items-center gap-1 border-b bg-muted/30 px-3 py-2">
          {DEMOS.map((d, i) => (
            <button
              key={d.slug}
              type="button"
              onClick={() => setIndex(i)}
              className={`px-2 py-1 text-xs rounded transition-colors duration-150 ${
                i === index
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-current={i === index ? 'true' : undefined}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Input + output */}
        <div className="grid grid-rows-2 divide-y">
          <div className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Input</div>
            <pre className="font-mono text-sm text-foreground whitespace-pre-wrap break-all min-h-[3rem]">
              {demo.input}
            </pre>
          </div>
          <div className="p-4 bg-muted/20">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Output</div>
            <pre className="font-mono text-sm text-foreground whitespace-pre-wrap break-all min-h-[3rem]">
              {demo.output}
            </pre>
          </div>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-1.5 mt-3">
        {DEMOS.map((d, i) => (
          <span
            key={d.slug}
            className={`h-1.5 rounded-full transition-all duration-220 ease-default ${
              i === index ? 'w-6 bg-accent' : 'w-1.5 bg-muted-foreground/30'
            }`}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}
