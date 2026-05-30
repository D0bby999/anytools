import { MdxContent } from './mdx-content';

export interface TutorialSectionProps {
  source: string;
  heading?: string;
}

export function TutorialSection({ source, heading = 'How it works' }: TutorialSectionProps) {
  return (
    <section className="mt-12 border-t pt-8">
      <h2 className="text-3xl font-bold mb-6">{heading}</h2>
      <MdxContent source={source} />
    </section>
  );
}
