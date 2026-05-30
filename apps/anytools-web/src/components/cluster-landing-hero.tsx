import { CLUSTER_CONFIG } from '@/lib/cluster-config';
import { CLUSTER_ICON } from '@/lib/cluster-icon-map';
import type { ClusterId } from '@anytools/tools/types';

type Props = {
  cluster: ClusterId;
  label: string;
  tagline: string;
  intro: string;
  toolCount: string;
};

/**
 * Server component cluster hero. Pure RSC — no client JS shipped.
 * Renders icon + label + tagline + intro + tool count badge.
 */
export function ClusterLandingHero({ cluster, label, tagline, intro, toolCount }: Props) {
  const config = CLUSTER_CONFIG[cluster];
  const Icon = CLUSTER_ICON[cluster];

  return (
    <section className={`border-b ${config.bgClass}`}>
      <div className="container mx-auto max-w-6xl px-4 py-12 md:py-16">
        <div className="flex flex-col gap-4 max-w-3xl">
          <div
            className={`inline-flex h-12 w-12 items-center justify-center rounded-lg bg-background ring-1 ${config.ringClass}`}
          >
            <Icon className="h-6 w-6 text-foreground" />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{label}</h1>
            <p className="text-base text-muted-foreground mt-1">{tagline}</p>
          </div>
          <p className="text-base leading-relaxed text-foreground/90 max-w-2xl">{intro}</p>
          <div>
            <span className="inline-flex items-center rounded-full bg-background border px-3 py-1 text-xs font-medium text-muted-foreground">
              {toolCount}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
