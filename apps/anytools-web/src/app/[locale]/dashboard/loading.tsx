export default function DashboardLoading() {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />
          <div className="h-4 w-64 rounded bg-muted/60 animate-pulse" />
        </div>
        <div className="h-9 w-24 rounded-md bg-muted animate-pulse" />
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-lg border bg-card p-6 space-y-3">
            <div className="h-5 w-24 rounded bg-muted animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-muted/60 animate-pulse" />
              <div className="h-4 w-3/4 rounded bg-muted/60 animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-muted/60 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
