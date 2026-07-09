export function EmptyState() {
  return (
    <section className="empty-state" aria-label="Empty schematic">
      <div className="empty-panel">
        <div className="empty-kicker">
          <i aria-hidden="true" />
          Powerboard
        </div>
        <h1>Open a circuit from Project</h1>
        <p>
          Pick a folder like LED Board or Charging Circuit, or import an LTspice
          .asc file. Place parts with the Components rail, then wire and run.
        </p>
      </div>
    </section>
  );
}
