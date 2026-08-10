import { EmptyState } from '@tau/desktop';

const noop = () => {};

/** First launch with no project open — the four ways in. */
export function NoProject() {
  return (
    <EmptyState
      projectOpen={false}
      canCreateProject
      onOpenFolder={noop}
      onCreateProject={noop}
      onNewCircuit={noop}
      onAskBode={noop}
      onNotice={noop}
    />
  );
}

/** Project open, canvas still empty. */
export function EmptyCanvas() {
  return <EmptyState projectOpen onNewCircuit={noop} onAskBode={noop} onNotice={noop} />;
}

/** With the first-success learning-path call to action. */
export function WithLearningPath() {
  return (
    <EmptyState
      projectOpen
      offerFirstSuccess
      onTryFirstSuccess={noop}
      onNewCircuit={noop}
      onAskBode={noop}
      onNotice={noop}
    />
  );
}
