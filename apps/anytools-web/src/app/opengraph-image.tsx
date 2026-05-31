import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AnyTools — Dev tools that respect your time, your data, your language';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        background: '#F8FAFC',
        color: '#0F172A',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '80px 96px',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Brand mark + name top */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            background: '#047857',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Morphing-module glyph (white cells on emerald box) */}
          <svg width="36" height="36" viewBox="0 0 128 128" aria-hidden="true">
            <rect x="20" y="44" width="44" height="44" rx="5" fill="#FFFFFF" opacity="0.5" />
            <rect x="34" y="34" width="44" height="44" rx="14" fill="#FFFFFF" opacity="0.78" />
            <rect x="48" y="24" width="44" height="44" rx="22" fill="#FFFFFF" />
          </svg>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#1E293B' }}>AnyTools</div>
      </div>

      {/* Main tagline */}
      <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
            color: '#0F172A',
          }}
        >
          Dev tools that respect
          <br />
          your time, your data,
          <br />
          your <span style={{ color: '#047857' }}>language.</span>
        </div>
      </div>

      {/* Footer strip */}
      <div
        style={{
          display: 'flex',
          gap: 32,
          fontSize: 22,
          color: '#475569',
          fontWeight: 500,
        }}
      >
        <div>34+ tools</div>
        <div style={{ color: '#CBD5E1' }}>·</div>
        <div>EN · VN · ES · PT</div>
        <div style={{ color: '#CBD5E1' }}>·</div>
        <div>Offline-first PWA</div>
        <div style={{ color: '#CBD5E1' }}>·</div>
        <div>MIT</div>
      </div>
    </div>,
    size,
  );
}
