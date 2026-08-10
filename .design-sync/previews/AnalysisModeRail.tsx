import * as React from 'react';
import { AnalysisModeRail } from '@tau/desktop';

/** SPICE abbreviations kept dense; full names go to assistive tech. */
export function Modes() {
  const [mode, setMode] = React.useState('tran');
  return <AnalysisModeRail value={mode} onValueChange={setMode} />;
}

export function OnAcSweep() {
  const [mode, setMode] = React.useState('ac');
  return <AnalysisModeRail value={mode} onValueChange={setMode} />;
}

/** Disabled while a run is in flight. */
export function Disabled() {
  const [mode, setMode] = React.useState('tran');
  return <AnalysisModeRail value={mode} onValueChange={setMode} disabled />;
}
