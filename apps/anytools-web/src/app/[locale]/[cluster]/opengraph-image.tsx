import { getMessages } from 'next-intl/server';
import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AnyTools cluster';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type PageParams = { locale: string; cluster: string };

// Per-cluster accent (matches design system tokens in packages/ui/src/styles/globals.css).
const CLUSTER_ACCENT: Record<string, string> = {
  finance: '#059669',
  health: '#E11D48',
  lifestyle: '#B45309',
  design: '#7C3AED',
};
const DEFAULT_ACCENT = '#047857'; // emerald-700 brand accent (AA on light OG bg)

export default async function Image({ params }: { params: PageParams }) {
  const { locale, cluster } = params;
  const messages = (await getMessages({ locale })) as Record<string, unknown>;
  const cl =
    (messages.clusterLanding as Record<string, { tagline?: string; intro?: string }>) ?? {};
  const cn = (messages.tools as { cluster?: Record<string, string> })?.cluster ?? {};

  const title = cn[cluster] ?? cluster;
  const tagline = cl[cluster]?.tagline ?? '';
  const intro = cl[cluster]?.intro ?? '';
  const accent = CLUSTER_ACCENT[cluster] ?? DEFAULT_ACCENT;

  return new ImageResponse(
    <div
      style={{
        background: '#F8FAFC',
        color: '#0F172A',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '64px 80px',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Brand + cluster chip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              background: accent,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Morphing-module glyph (white cells on accent box) */}
            <svg width="30" height="30" viewBox="0 0 128 128" aria-hidden="true">
              <rect x="20" y="44" width="44" height="44" rx="5" fill="#FFFFFF" opacity="0.5" />
              <rect x="34" y="34" width="44" height="44" rx="14" fill="#FFFFFF" opacity="0.78" />
              <rect x="48" y="24" width="44" height="44" rx="22" fill="#FFFFFF" />
            </svg>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1E293B' }}>AnyTools</div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 16px',
            background: `${accent}1A`,
            color: accent,
            borderRadius: 999,
            fontSize: 20,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          {cluster}
        </div>
      </div>

      {/* Title + tagline */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          gap: 24,
        }}
      >
        <div
          style={{
            fontSize: 84,
            fontWeight: 800,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
            color: '#0F172A',
          }}
        >
          {title}
        </div>
        {tagline ? (
          <div
            style={{
              fontSize: 32,
              color: accent,
              fontWeight: 600,
              lineHeight: 1.3,
            }}
          >
            {tagline}
          </div>
        ) : null}
        {intro ? (
          <div
            style={{
              fontSize: 24,
              color: '#475569',
              lineHeight: 1.45,
              maxWidth: 1040,
            }}
          >
            {intro.length > 180 ? `${intro.slice(0, 177)}...` : intro}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          gap: 28,
          fontSize: 20,
          color: '#64748B',
          fontWeight: 500,
        }}
      >
        <div>{locale.toUpperCase()}</div>
        <div style={{ color: '#CBD5E1' }}>·</div>
        <div>Free · No tracking</div>
        <div style={{ color: '#CBD5E1' }}>·</div>
        <div>Runs in your browser</div>
      </div>
    </div>,
    size,
  );
}
