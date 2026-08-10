import { Component, type ErrorInfo, type ReactNode } from "react";

interface AnalysisErrorBoundaryProps {
  children: ReactNode;
}

interface AnalysisErrorBoundaryState {
  message: string | null;
}

export class AnalysisErrorBoundary extends Component<
  AnalysisErrorBoundaryProps,
  AnalysisErrorBoundaryState
> {
  state: AnalysisErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): AnalysisErrorBoundaryState {
    return {
      message: error instanceof Error ? error.message : "Unknown analysis panel error.",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Analysis panel crashed", error, info.componentStack);
  }

  componentDidUpdate(prevProps: AnalysisErrorBoundaryProps) {
    if (this.props.children !== prevProps.children && this.state.message) {
      this.setState({ message: null });
    }
  }

  render() {
    if (this.state.message) {
      return (
        /*
         * A plain div, matching what it stands in for. This was
         * `<aside aria-label="Analysis plotter">` back when the panel was a
         * column of the shell; the panel is the results drawer's Waveforms
         * body now and the drawer owns the landmark, so an aside here nested
         * a second complementary region inside the first - under a name
         * shellContract.ts no longer declares, which meant the shell
         * inventory test could neither require nor forbid it. That blindness
         * is the exact failure App.shellContract.test.tsx exists to catch.
         *
         * `role="alert"` because this fallback only ever appears in place of
         * content the reader was already looking at.
         */
        <div className="plotter">
          <div className="analysis-empty" role="alert">{this.state.message}</div>
        </div>
      );
    }

    return this.props.children;
  }
}
