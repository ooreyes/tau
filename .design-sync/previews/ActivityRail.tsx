import { ActivityRail } from '@tau/desktop';

const noop = () => {};

const props = {
  onFocusExplorer: noop,
  onModeChange: noop,
  onSearch: noop,
  onFocusComponents: noop,
  onOpenSettings: noop,
};

/** The left-edge workspace rail, Explorer active. */
export function ExplorerActive() {
  return <ActivityRail mode="schematic" explorerOpen partsOpen={false} {...props} />;
}

export function PartsActive() {
  return <ActivityRail mode="schematic" explorerOpen={false} partsOpen {...props} />;
}

/** No project open — actions that need one are disabled. */
export function NoProject() {
  return (
    <ActivityRail
      mode="schematic"
      explorerOpen={false}
      partsOpen={false}
      projectOpen={false}
      schematicOpen={false}
      {...props}
    />
  );
}
