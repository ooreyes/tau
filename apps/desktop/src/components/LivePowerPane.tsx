import { useEffect, useMemo, useState } from "react";

import { LiveScopePane, type LiveScopeChannel } from "./LiveScopePane";
import { LiveSampleRing, type LiveRunStatus, type TimeWindow } from "../simulation/liveRun";
import { deriveLivePower } from "../simulation/livePower";

export interface LivePowerPaneProps {
  ring: LiveSampleRing;
  positiveChannel: LiveScopeChannel;
  negativeChannel: LiveScopeChannel;
  currentChannel: LiveScopeChannel;
  timeWindow: TimeWindow;
  onWindowChange: (next: TimeWindow) => void;
  status: LiveRunStatus;
  height?: number;
}

/** A separately-scaled W pane derived only from the live V+/V-/I channels. */
export function LivePowerPane({ ring, positiveChannel, negativeChannel, currentChannel, timeWindow, onWindowChange, status, height }: LivePowerPaneProps) {
  const [frame, tick] = useState(0);
  useEffect(() => {
    if (status.phase !== "running") return;
    const id = window.setInterval(() => tick((value) => value + 1), 100);
    return () => window.clearInterval(id);
  }, [status.phase]);
  const derived = useMemo(() => {
    const view = ring.snapshot();
    const ground = new Float64Array(view.times.length);
    const values = deriveLivePower(positiveChannel.powerGround ? ground : (view.channels[positiveChannel.index] ?? []), negativeChannel.powerGround ? ground : (view.channels[negativeChannel.index] ?? []), view.channels[currentChannel.index] ?? []);
    const next = new LiveSampleRing({ channelCount: 1, capacity: Math.max(1, values.length) });
    for (let index = 0; index < values.length; index += 1) next.push(view.times[index]!, [values[index]!]);
    return next;
  }, [ring, positiveChannel.index, negativeChannel.index, currentChannel.index, status.phase, frame]);
  return (
    <section aria-label="Live component power" className="live-power-pane">
      <p className="m-0 text-[11px] leading-4 text-muted-foreground">
        Power = (V+ − V−) × I entering V+; this W pane is derived from the same live samples.
      </p>
      <LiveScopePane ring={derived} channels={[{ index: 0, label: `P(${currentChannel.label.replace(/^I\(|\)$/g, "")})`, unit: "W" }]} timeWindow={timeWindow} onWindowChange={onWindowChange} status={status} height={height} />
    </section>
  );
}
