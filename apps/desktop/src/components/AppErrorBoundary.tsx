import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

/** Keeps an unexpected editor render error recoverable instead of blanking Tau. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Tau application error", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app-recovery" role="alert">
          <div>
            <p>Tau encountered an unexpected editor error.</p>
            <button onClick={() => window.location.reload()}>Restart Tau</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
