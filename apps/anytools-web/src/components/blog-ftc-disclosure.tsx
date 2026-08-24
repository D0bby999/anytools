import type { BlogDisclosureType } from '@/lib/load-blog-content';

const COPY: Record<BlogDisclosureType, { title: string; body: string }> = {
  affiliate: {
    title: 'Affiliate disclosure',
    body: 'Some links below are affiliate links. I may earn a commission from qualifying purchases at no extra cost to you. Recommendations come from published specifications and independent reviews, not hands-on testing.',
  },
  amazon: {
    title: 'Amazon Associates disclosure',
    body: 'As an Amazon Associate, I earn from qualifying purchases. The price you pay is the same. This guide is based on manufacturer specifications, published independent reviews, and verified-buyer feedback, not hands-on testing.',
  },
  ymyl: {
    title: 'Not professional advice',
    body: 'This article is informational only. Calculators and tools give estimates; financial, medical, and legal decisions involve your specific circumstances. Consult a licensed professional before acting on anything you read here.',
  },
  both: {
    title: 'Disclosures',
    body: 'Some links below are affiliate links — I may earn a commission from qualifying purchases at no extra cost to you. This article is informational only and is not financial, medical, or legal advice; consult a licensed professional for decisions specific to your situation.',
  },
};

export function BlogFtcDisclosure({ type }: { type: BlogDisclosureType }) {
  const { title, body } = COPY[type] ?? COPY.affiliate;
  return (
    <div
      role="note"
      aria-label={title}
      className="not-prose my-6 border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm rounded-r text-amber-900 dark:text-amber-100"
    >
      <p className="font-semibold mb-1">{title}</p>
      <p className="leading-relaxed">{body}</p>
    </div>
  );
}
