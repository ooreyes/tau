import { Tabs, TabsList, TabsTrigger, TabsContent } from '@tau/desktop';

const body: React.CSSProperties = { fontSize: 12, color: 'var(--muted)', paddingTop: 4 };

/** The results drawer's tab strip — the canonical use. */
export function ResultTabs() {
  return (
    <Tabs defaultValue="waveforms" style={{ width: 420 }}>
      <TabsList>
        <TabsTrigger value="waveforms">Waveforms</TabsTrigger>
        <TabsTrigger value="netlist">Netlist</TabsTrigger>
        <TabsTrigger value="log">Solver log</TabsTrigger>
      </TabsList>
      <TabsContent value="waveforms">
        <p style={body}>4 traces · 20 ms transient · 2001 points</p>
      </TabsContent>
      <TabsContent value="netlist">
        <p style={body}>32 devices · 18 nodes</p>
      </TabsContent>
      <TabsContent value="log">
        <p style={body}>Converged in 41 Newton iterations.</p>
      </TabsContent>
    </Tabs>
  );
}

export function TwoUp() {
  return (
    <Tabs defaultValue="mag" style={{ width: 260 }}>
      <TabsList>
        <TabsTrigger value="mag">Magnitude</TabsTrigger>
        <TabsTrigger value="phase">Phase</TabsTrigger>
      </TabsList>
      <TabsContent value="mag">
        <p style={body}>−3 dB at 1.59 kHz</p>
      </TabsContent>
      <TabsContent value="phase">
        <p style={body}>−45° at 1.59 kHz</p>
      </TabsContent>
    </Tabs>
  );
}

export function WithDisabledTab() {
  return (
    <Tabs defaultValue="waveforms" style={{ width: 380 }}>
      <TabsList>
        <TabsTrigger value="waveforms">Waveforms</TabsTrigger>
        <TabsTrigger value="fft" disabled>
          FFT
        </TabsTrigger>
        <TabsTrigger value="log">Solver log</TabsTrigger>
      </TabsList>
      <TabsContent value="waveforms">
        <p style={body}>Run an AC analysis to enable FFT.</p>
      </TabsContent>
    </Tabs>
  );
}
