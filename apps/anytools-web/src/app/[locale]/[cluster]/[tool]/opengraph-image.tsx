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
              background: '#2563EB',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 30,
              fontWeight: 900,
            }}
          >
            A
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1E293B' }}>AnyTools</div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 16px',
            background: 'rgba(37, 99, 235, 0.1)',
            color: '#2563EB',
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
