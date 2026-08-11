/**
 * Settings: a left nav of pages and one page at a time, filling the schematic
 * window rather than a window of its own. Tau is one Mac app with one window;
 * see `settingsSurface.ts` for why the second window was removed and what it
 * was silently breaking.
 *
 * Pages are chosen, not accumulated. Each one is justified in its own file
 * header; a page that cannot say who needs it and what real state backs it does
 * not belong here.
 */
import { useEffect, useState } from "react";
import {
  Keyboard,
  Gauge,
  Settings2,
  Sparkles,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GeneralPage } from "./pages/GeneralPage";
import { ModelConfigurationPage } from "./pages/ModelConfigurationPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import { SimulationPage } from "./pages/SimulationPage";
import { UsagePage } from "./pages/UsagePage";

export type SettingsPageId =
  | "general"
  | "profile"
  | "models"
  | "usage"
  | "simulation"
  | "shortcuts";

interface NavEntry {
  id: SettingsPageId;
  label: string;
  icon: typeof Settings2;
  /** Nav grouping: the everyday pages, then the ones an engineer goes looking for. */
  section: "You" | "Engine";
}

const NAV: readonly NavEntry[] = [
  { id: "general", label: "General", icon: Settings2, section: "You" },
  { id: "profile", label: "Profile", icon: UserRound, section: "You" },
  { id: "models", label: "Model configuration", icon: Sparkles, section: "You" },
  { id: "usage", label: "Usage", icon: Wallet, section: "You" },
  { id: "simulation", label: "Simulation", icon: Gauge, section: "Engine" },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard, section: "Engine" },
];

const SECTIONS: readonly NavEntry["section"][] = ["You", "Engine"];

export function SettingsWindow({
  initialPage = "general",
  onClose,
}: {
  initialPage?: SettingsPageId;
  /** Omitted only in tests that render one page in isolation. */
  onClose?: () => void;
}) {
  const [page, setPage] = useState<SettingsPageId>(initialPage);
  const [notice, setNotice] = useState<string | null>(null);

  // A notice is a confirmation, not a log: it says what just happened and gets
  // out of the way. It stays local to this surface rather than going to the
  // app's toaster, which sits behind Settings and would confirm underneath it.
  useEffect(() => {
    if (!notice) return;
    const timer = globalThis.setTimeout(() => setNotice(null), 4200);
    return () => globalThis.clearTimeout(timer);
  }, [notice]);

  // Escape-to-close used to be handled here with a raw window keydown
  // listener. Settings is now always mounted inside the app's Radix Dialog
  // (App.tsx), which already owns Escape (focus trap + dismissable layer);
  // a second handler here would double-fire the same onClose on every
  // Escape press. There is no other mount site - `<SettingsWindow />` in
  // the test files always renders without `onClose`, so nothing depended on
  // this effect.
  const onNotice = (message: string) => setNotice(message);

  return (
    <div className="tau-settings">
      <nav className="tau-settings-nav" aria-label="Settings pages">
        <div className="tau-settings-nav-head">
          <span className="tau-settings-nav-title">Settings</span>
        </div>
        {SECTIONS.map((section) => (
          <div className="tau-settings-nav-section" key={section}>
            <span className="tau-settings-nav-kicker">{section}</span>
            {NAV.filter((entry) => entry.section === section).map((entry) => {
              const Icon = entry.icon;
              const active = entry.id === page;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`tau-settings-nav-item${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setPage(entry.id)}
                >
                  <Icon size={14} strokeWidth={1.7} aria-hidden="true" />
                  <span>{entry.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <main className="tau-settings-main">
        {onClose && (
          <div className="tau-settings-close-bar">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Close settings"
              onClick={onClose}
            >
              <X size={14} strokeWidth={1.8} aria-hidden="true" />
              Close
            </Button>
          </div>
        )}
        <div className="tau-settings-scroll">
          {page === "general" && <GeneralPage onNotice={onNotice} />}
          {page === "profile" && <ProfilePage />}
          {page === "models" && <ModelConfigurationPage onNotice={onNotice} />}
          {page === "usage" && <UsagePage onNotice={onNotice} />}
          {page === "simulation" && <SimulationPage onNotice={onNotice} />}
          {page === "shortcuts" && <ShortcutsPage />}
        </div>
        {notice && (
          <div className="tau-settings-notice-bar" role="status">
            {notice}
          </div>
        )}
      </main>
    </div>
  );
}
