'use client';

import dynamic from 'next/dynamic';

// The map is a client-only, WebGL-heavy component: `ssr: false` keeps MapLibre
// and Deck.gl out of the server render. In the App Router this dynamic import
// must live in a client component (a Server Component cannot use ssr: false).
const AqiForecastMap = dynamic(() => import('@/components/AqiForecastMap'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 'calc(100vh - 96px)',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 14,
        border: '1px solid rgba(148,163,184,0.16)',
        background: '#05070d',
        color: '#94a3b8',
        fontSize: 13,
      }}
    >
      Loading forecast map…
    </div>
  ),
});

// The GRAP panel is plain React and SVG with no browser-only APIs, so it can be
// server-rendered; it fetches its first scenario on mount.
const GrapSimulator = dynamic(() => import('@/components/GrapSimulator'), {
  loading: () => (
    <div
      style={{
        minHeight: 320,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 14,
        border: '1px solid rgba(148,163,184,0.16)',
        background: '#05070d',
        color: '#94a3b8',
        fontSize: 13,
      }}
    >
      Loading GRAP simulator…
    </div>
  ),
});

export default function Page() {
  return (
    <main style={{ padding: 16, minHeight: '100vh' }}>
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: 0.2 }}>
          Delhi NCR · PM2.5 forecast
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#94a3b8' }}>
          Coupled aerosol–meteorology model · 50 × 50 grid over 28.2–28.9° N, 76.8–77.5° E · 72 h horizon
        </p>
      </header>
      <AqiForecastMap height="calc(100vh - 132px)" gridStride={2} horizonHours={72} />
      <div style={{ marginTop: 16 }}>
        <GrapSimulator horizonHours={72} windowHours={48} />
      </div>
      <footer style={{ marginTop: 22, fontSize: 11, color: '#7c8ba1', lineHeight: 1.6 }}>
        GRAP grading follows CAQM&apos;s revised schedule (November 2025). Intervention effects are
        model estimates, not measurements; the panel reports the surrogate&apos;s measured error
        against the full coupled run it was derived from.
      </footer>
    </main>
  );
}
