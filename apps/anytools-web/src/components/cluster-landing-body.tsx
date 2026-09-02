type Props = {
  heading: string;
  paragraphs: string[];
};

/**
 * Editorial section under a cluster's tool grid.
 *
 * Cluster landing pages used to be a hero plus a grid of cards — 119 words on
 * /en/web3, 155 on /en/design. That is a navigation page, not a page, and it was
 * part of why the site was turned down for AdSense on 2026-09-02 for insufficient
 * content. This section carries the part a grid cannot: which tool to pick for
 * which job, and the mistakes each cluster's formats invite.
 *
 * Pure RSC — the text is static per locale, so nothing ships to the client.
 * Renders nothing when a cluster has no copy yet rather than showing an empty
 * heading, so adding a cluster does not require writing prose in the same commit.
 */
export function ClusterLandingBody({ heading, paragraphs }: Props) {
  if (!paragraphs.length) return null;

  return (
    <section className="border-t bg-muted/20">
      <div className="container mx-auto max-w-6xl px-4 py-12 md:py-14">
        <div className="max-w-3xl">
          <h2 className="text-xl md:text-2xl font-bold mb-4">{heading}</h2>
          <div className="space-y-4">
            {paragraphs.map((p) => (
              // The copy is authored per locale and never reordered, so the text
              // itself is a stable key.
              <p key={p} className="text-base leading-relaxed text-foreground/90">
                {p}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
