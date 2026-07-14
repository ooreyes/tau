export function EmptyState() {
  return (
    <section className="empty-state" aria-label="Empty schematic">
      <div className="empty-panel">
        <div className="empty-kicker">
          <i aria-hidden="true" />
          Tau Schematics
        </div>
        <h1>Open or create a schematic</h1>
        <p>
          Choose a Schematics folder in the Explorer, import an LTspice .asc,
          or create a blank .asc file. Then place, wire, and simulate your circuit.
        </p>
      </div>
    </section>
  );
}
