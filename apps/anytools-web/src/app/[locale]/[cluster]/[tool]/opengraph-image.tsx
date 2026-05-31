import { getToolMeta } from '@anytools/tools/meta';
import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AnyTools tool';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type PageParams = { locale: string; cluster: string; tool: string };

export default async function Image({ params }: { params: PageParams }) {
  const { locale, cluster, tool } = params;
  const m = getToolMeta(cluster, tool);
  if (!m) {
    return new ImageResponse(
      <div
        style={{
          background: '#F8FAFC',
          color: '#0F172A',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          fontSize: 48,
        }}
      >
        AnyTools
      </div>,
      size,
    );
  }

  const title = m.title[locale] ?? m.title.en ?? m.slug;
  const description = m.description[locale] ?? m.description.en ?? '';

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
      {/* Brand + category */}
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
              background: '#047857',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Morphing-module glyph (white cells on emerald box) */}
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
            background: 'rgba(4, 120, 87, 0.1)',
            color: '#047857',
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

      {/* Tool title + description */}
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
            fontSize: 76,
            fontWeight: 800,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
            color: '#0F172A',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 28,
            color: '#475569',
            lineHeight: 1.4,
            maxWidth: 1040,
          }}
        >
          {description.length > 140 ? `${description.slice(0, 137)}...` : description}
        </div>
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
        <div>Free · No tracking</div>
        <div style={{ color: '#CBD5E1' }}>·</div>
        <div>4 languages</div>
        <div style={{ color: '#CBD5E1' }}>·</div>
        <div>Offline-first</div>
      </div>
    </div>,
    size,
  );
}
