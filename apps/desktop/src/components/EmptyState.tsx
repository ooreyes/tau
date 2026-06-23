import { EXAMPLE_CIRCUITS } from "../examples/circuits";
import { useSchematic } from "../store/useSchematic";

export function EmptyState() {
  const loadCircuit = useSchematic((s) => s.loadCircuit);
  const startPlacing = useSchematic((s) => s.startPlacing);
  const startWiring = useSchematic((s) => s.startWiring);
  const firstExample = EXAMPLE_CIRCUITS[0] ?? null;

  return (
    <section className="empty-state" aria-label="Start a circuit">
      <div className="empty-panel">
        <div className="empty-kicker">Tau v0.2</div>
        <h1>Build, wire, run.</h1>
        <p>
          Start with a known-good RC transient circuit, or place parts manually.
          The scope updates after you run analysis.
        </p>
        <div className="empty-actions">
          {firstExample && (
            <button className="primary-action" onClick={() => loadCircuit(firstExample)}>
              Open RC example
            </button>
          )}
          <button onClick={() => startPlacing("resistor")}>Place resistor</button>
          <button onClick={startWiring}>Wire</button>
        </div>
      </div>
    </section>
  );
}
