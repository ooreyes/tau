/**
 * Model libraries: where Tau looks for device models, and what it found.
 *
 * Justification: "M1: model IRF540 was not found" is the single most common way
 * a real LTspice circuit fails to run in Tau, and until now there was nowhere
 * to look up why. This page answers the two questions that failure raises -
 * which folders were searched, and which standard databases were actually
 * loaded - from live state rather than from a hardcoded list.
 *
 * The search roots are fixed in the native build and are shown read-only. That
 * is the honest presentation: an editable field that Tau's discovery code would
 * ignore is worse than a list that says it is fixed.
 */
import { useEffect, useState } from "react";
import { useRuntimeModelLibraries } from "../../store/useRuntimeModelLibraries";
import { keychainAvailable } from "../settingsSurface";
import { SettingsGroup, SettingsNotice, SettingsPage, SettingsRow } from "../SettingsPrimitives";

/** Mirrors `ltspice_library.rs`'s `library_roots`. Shown, not used, so the two
 *  can only disagree visibly rather than silently. */
const SEARCH_ROOTS: readonly string[] = [
  "~/Library/Application Support/LTspice/lib",
  "~/Documents/LTspice/lib",
  "/Applications/LTspice.app/Contents/Resources/lib",
];

const STATUS_COPY: Record<string, string> = {
  idle: "Not searched yet",
  loading: "Searching",
  ready: "Searched",
  unavailable: "No LTspice installation found",
};

export function LibrariesPage() {
  const installed = useRuntimeModelLibraries((state) => state.installedLtspice);
  const status = useRuntimeModelLibraries((state) => state.status);
  const native = keychainAvailable();
  const [now, setNow] = useState(status);

  useEffect(() => setNow(status), [status]);

  return (
    <SettingsPage
      title="Model libraries"
      summary="Where Tau looks for device models, and which standard databases it loaded."
    >
      <SettingsGroup
        title="Standard LTspice databases"
        note="LTspice resolves common diode, BJT, MOSFET and JFET names without a .include. Tau loads the same four databases from your LTspice installation at launch so those names resolve the same way."
      >
        <SettingsRow label="Discovery" hint="Runs once at launch">
          <span className="tau-settings-value">
            {native ? (STATUS_COPY[now] ?? now) : "Not available in a browser preview"}
          </span>
        </SettingsRow>
        {installed.length === 0 ? (
          <p className="tau-empty">
            {native
              ? "No standard databases loaded. Circuits that rely on implicit LTspice model names will refuse rather than substitute a generic part."
              : "The browser preview has no filesystem access, so no databases are loaded."}
          </p>
        ) : (
          <div className="tau-usage-table" role="table" aria-label="Loaded standard databases">
            <div className="tau-usage-head tau-library-head" role="row">
              <span role="columnheader">Database</span>
              <span role="columnheader">Models</span>
            </div>
            {installed.map((library) => (
              <div className="tau-usage-row tau-library-row" role="row" key={library.name}>
                <span role="cell">{library.name}</span>
                <span role="cell" className="tau-num">
                  {library.text.split("\n").filter((line) => /^\s*\.model\b/i.test(line)).length ||
                    "included"}
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Search locations"
        note="Fixed in this build. Tau reads these folders and nothing outside them, and refuses paths that try to escape the tree."
      >
        {SEARCH_ROOTS.map((root) => (
          <SettingsRow key={root} label={root} hint="Read only, searched at launch" />
        ))}
      </SettingsGroup>

      <SettingsNotice title="Attaching a vendor model to one schematic">
        <p>
          A model library you attach for a specific circuit is stored in that schematic, not
          here, so the file still simulates when you send it to someone else. Use Model
          libraries in the schematic window to attach one.
        </p>
        <p>
          Tau will not substitute a generic device for a vendor part it cannot find. A missing
          model is reported by name so the result never quietly stops matching the real
          component.
        </p>
      </SettingsNotice>
    </SettingsPage>
  );
}
