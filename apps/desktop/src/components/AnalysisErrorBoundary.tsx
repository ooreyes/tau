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
        <aside className="plotter" aria-label="Analysis plotter">
          <div className="plotter-header">
            <div>
              <div className="plotter-kicker">Analysis</div>
              <div className="plotter-title">Panel error</div>
            </div>
            <div className="plotter-live">Error</div>
          </div>
          <div className="analysis-empty">{this.state.message}</div>
        </aside>
      );
    }

    return this.props.children;
  }
}
