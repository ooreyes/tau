import React from "react";
import ReactDOM from "react-dom/client";
// Design-system token/utility layers (§10) — loaded before App.css (imported
// by App) so the existing hand-written rules keep final say while panels migrate.
import "./styles/tokens.css";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
