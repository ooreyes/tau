export function EmptyState() {
  return (
    <section className="empty-state" aria-label="Empty schematic">
      <div className="empty-panel">
        <div className="empty-kicker">
          <i aria-hidden="true" />
          Tau
        </div>
        <h1>Open, create, or ask AI</h1>
        <p>
          Choose a Schematics folder in Explorer, import an LTspice .asc, or open
          Assistant and describe the circuit. Tau lays out parts, routes wires,
          and can run the analysis after you confirm.
        </p>
      </div>
    </section>
  );
}
