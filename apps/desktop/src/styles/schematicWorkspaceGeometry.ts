export interface ToolbarGeometryInput {
  viewportWidth: number;
  paddingLeft: number;
  paddingRight: number;
  modeReserve: number;
  titleWidth: number;
  actionsWidth: number;
}

export interface ToolbarGeometry {
  modeLeft: number;
  modeRight: number;
  modeMidpoint: number;
  titleLeft: number;
  titleRight: number;
  actionsLeft: number;
  actionsRight: number;
  leftTrack: number;
  rightTrack: number;
}

/**
 * Model the titlebar's border-box geometry, including the macOS overlay
 * padding. This is intentionally independent of DOM measurement: jsdom does
 * not implement CSS grid layout, while these are the dimensions the browser
 * must satisfy at the 900px packaged-app floor.
 */
export function toolbarGeometry(input: ToolbarGeometryInput): ToolbarGeometry {
  const {
    viewportWidth,
    paddingLeft,
    paddingRight,
    modeReserve,
    titleWidth,
    actionsWidth,
  } = input;
  const contentWidth = viewportWidth - paddingLeft - paddingRight;
  const bias = (paddingLeft - paddingRight) / 2;
  const leftTrack = (contentWidth - modeReserve) / 2 - bias;
  const rightTrack = (contentWidth - modeReserve) / 2 + bias;
  const modeLeft = viewportWidth / 2 - modeReserve / 2;
  const modeRight = viewportWidth / 2 + modeReserve / 2;
  const titleLeft = paddingLeft;
  const titleRight = titleLeft + titleWidth;
  const actionsRight = viewportWidth - paddingRight;
  const actionsLeft = actionsRight - actionsWidth;
  return {
    modeLeft,
    modeRight,
    modeMidpoint: (modeLeft + modeRight) / 2,
    titleLeft,
    titleRight,
    actionsLeft,
    actionsRight,
    leftTrack,
    rightTrack,
  };
}

export function sideClustersAvoidMode(
  geometry: ToolbarGeometry,
  clusterGap: number,
): boolean {
  return geometry.titleRight + clusterGap <= geometry.modeLeft
    && geometry.modeRight + clusterGap <= geometry.actionsLeft;
}
