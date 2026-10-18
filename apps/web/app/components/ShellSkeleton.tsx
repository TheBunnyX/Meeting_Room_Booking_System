/** Placeholder shown while the session is checked, shaped like the signed-in page so nothing jumps. */
export function ShellSkeleton() {
  return <main className="shell app-shell route-loading" aria-busy="true">
    <aside className="sidebar skeleton-sidebar" aria-hidden="true">
      <div className="skeleton skeleton-line" style={{ width: "55%", height: 28, marginBottom: 32 }} />
      {[0, 1, 2, 3].map((item) => <div className="skeleton skeleton-line" style={{ height: 36 }} key={item} />)}
    </aside>
    <div className="workspace">
      <p className="sr-only" role="status">Loading your workspace…</p>
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="skeleton skeleton-line" style={{ width: "40%" }} aria-hidden="true" />
      <div className="room-grid" aria-hidden="true">{[0, 1, 2].map((item) => <div className="room-card skeleton skeleton-card" key={item} />)}</div>
    </div>
  </main>;
}
