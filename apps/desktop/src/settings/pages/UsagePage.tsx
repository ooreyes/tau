/**
 * Usage: what this Mac has consumed, and whose bill it lands on.
 *
 * The billing statement is the point of the page, so it is the first thing on
 * it, at heading size, before any number. Tau does not proxy anyone's spending
 * and takes no cut, which means it also genuinely cannot know what a request
 * cost. Presenting a local request count next to a currency figure Tau invented
 * would be the dishonest version of this page.
 *
 * Every count here is what Tau observed leaving this Mac. Token counts are the
 * provider's own numbers, lifted from its response when it reported them, and
 * are shown as "not reported" when it did not. The authoritative figure is the
 * provider's dashboard, which each row links to.
 */
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  USAGE_PROVIDER_LABELS,
  clearAiUsage,
  useAiUsage,
  type UsageProvider,
} from "../../lib/aiUsage";
import { clearRunRecordHistory, loadRunRecordHistory } from "../../lib/runRecord";
import { userFacingErrorMessage } from "../../lib/errorMessage";
import { PROVIDERS, providerInfo, type ProviderId } from "../providerCatalog";
import { openProviderPage } from "../settingsSurface";
import {
  Readout,
  SettingsGroup,
  SettingsNotice,
  SettingsPage,
  SettingsRow,
} from "../SettingsPrimitives";

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatWhen(at: number | null): string {
  if (!at) return "Never";
  return new Date(at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function UsagePage({ onNotice }: { onNotice: (message: string) => void }) {
  const usage = useAiUsage();
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useMemo(
    // historyVersion is the dependency that re-reads after a clear.
    () => (historyVersion >= 0 ? loadRunRecordHistory() : []),
    [historyVersion],
  );

  const totalRequests = Object.values(usage.providers).reduce(
    (sum, entry) => sum + entry.requests,
    0,
  );
  const cloudProviders = PROVIDERS.map((entry) => entry.id);

  const openUsagePage = (id: ProviderId) => {
    void openProviderPage(providerInfo(id).usagePageUrl).catch((error: unknown) => {
      onNotice(userFacingErrorMessage(error, "That page could not be opened."));
    });
  };

  return (
    <SettingsPage
      title="Usage"
      summary="What this Mac has sent, and where the authoritative numbers live."
    >
      {/* Deliberately the first element on the page, at notice weight rather
          than as a footnote. This is the single most important sentence in
          Settings for anyone about to paste a key. */}
      <SettingsNotice tone="warning" title="You pay your provider directly. Tau does not bill you.">
        <p className="tau-billing-lead">
          Tau charges nothing and takes no percentage. It does not resell provider access, does
          not proxy your spending, and never sees your account.
        </p>
        <p>
          Every cloud assistant request is billed by the provider whose key you saved, to the
          payment method on that account, at that provider's published rates. Tau cannot see
          your balance, cannot cap your spend, and cannot refund a charge. If you want a limit,
          set it in your provider's own billing settings, where spend caps and alerts live.
        </p>
        <p>
          The on-device assistant costs nothing at all: it runs on this Mac and makes no
          network requests once its model is downloaded.
        </p>
      </SettingsNotice>

      <SettingsGroup
        title="Requests from this Mac"
        note="Counted locally by Tau since the date below. This is a record of what was sent, not a bill."
      >
        <div className="tau-readout-strip">
          <Readout value={formatCount(totalRequests)} label="Assistant requests" />
          <Readout value={formatCount(history.length)} label="Simulation runs kept" />
          <Readout value={formatWhen(usage.since).split(",")[0]} label="Counting since" />
        </div>

        <div className="tau-usage-table" role="table" aria-label="Assistant usage by provider">
          <div className="tau-usage-head" role="row">
            <span role="columnheader">Provider</span>
            <span role="columnheader">Requests</span>
            <span role="columnheader">Input tokens</span>
            <span role="columnheader">Output tokens</span>
            <span role="columnheader">Last used</span>
          </div>
          {(Object.keys(USAGE_PROVIDER_LABELS) as UsageProvider[]).map((id) => {
            const entry = usage.providers[id];
            const reported = entry.inputTokens > 0 || entry.outputTokens > 0;
            return (
              <div className="tau-usage-row" role="row" key={id}>
                <span role="cell">{USAGE_PROVIDER_LABELS[id]}</span>
                <span role="cell" className="tau-num">
                  {formatCount(entry.requests)}
                </span>
                <span role="cell" className="tau-num">
                  {reported ? formatCount(entry.inputTokens) : "not reported"}
                </span>
                <span role="cell" className="tau-num">
                  {reported ? formatCount(entry.outputTokens) : "not reported"}
                </span>
                <span role="cell" className="tau-usage-when">
                  {formatWhen(entry.lastUsedAt)}
                </span>
              </div>
            );
          })}
        </div>

        <p className="tau-settings-group-note">
          Token counts appear only when a provider reports them in its reply. A blank count
          means Tau was not told, not that the request was free.
        </p>

        <SettingsRow label="Local counters" hint="Clears Tau's tally. Your provider's records are unaffected.">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              clearAiUsage();
              onNotice("Local usage counters cleared.");
            }}
          >
            Reset counters
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Your provider's own numbers"
        note="These are authoritative. Tau's counts above are a local convenience and can drift from them, for example if you use the same key somewhere else."
      >
        {cloudProviders.map((id) => (
          <SettingsRow
            key={id}
            label={providerInfo(id).label}
            hint={providerInfo(id).usagePageUrl}
          >
            <Button size="sm" variant="outline" onClick={() => openUsagePage(id)}>
              <ExternalLink size={13} strokeWidth={1.7} aria-hidden="true" />
              Open usage
            </Button>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Simulation history"
        note={`Tau keeps the last ${history.length === 0 ? "few" : formatCount(history.length)} runs on this Mac so a result can be traced back to the deck that produced it. Simulations are free and run locally.`}
      >
        {history.length === 0 ? (
          <p className="tau-empty">No runs recorded yet. Run a simulation and it will appear here.</p>
        ) : (
          <div className="tau-usage-table" role="table" aria-label="Recent simulation runs">
            <div className="tau-usage-head tau-run-head" role="row">
              <span role="columnheader">Circuit</span>
              <span role="columnheader">Analysis</span>
              <span role="columnheader">Engine</span>
              <span role="columnheader">Result</span>
              <span role="columnheader">When</span>
            </div>
            {history.slice(0, 10).map((run) => (
              <div className="tau-usage-row tau-run-row" role="row" key={`${run.createdAt}-${run.circuit.title}`}>
                <span role="cell">{run.circuit.title}</span>
                <span role="cell">{run.analysis.kind}</span>
                <span role="cell">{run.analysis.engine}</span>
                <span role="cell" data-status={run.status}>
                  {run.status}
                </span>
                <span role="cell" className="tau-usage-when">
                  {formatWhen(run.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
        <SettingsRow label="Run history" hint="Removes the local record. Your schematics are untouched.">
          <Button
            size="sm"
            variant="outline"
            disabled={history.length === 0}
            onClick={() => {
              clearRunRecordHistory();
              setHistoryVersion((version) => version + 1);
              onNotice("Simulation run history cleared.");
            }}
          >
            Clear history
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
