'use client';
// Catches errors thrown ABOVE the locale layout (e.g., in root layout, theme provider).
// Must include its own <html> + <body> since it replaces the entire root layout.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '4rem 1rem' }}>
        <main style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: '2rem', margin: '0 0 0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#64748b', margin: '0 0 2rem' }}>
            A critical error occurred. Try reloading the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              padding: '0.625rem 1.25rem',
              borderRadius: 6,
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              Ref: <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
