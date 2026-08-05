import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAssistantPreferences, saveAssistantPreferences } from "../lib/assistantPreferences";
import {
  dismissLocalAiSetup,
  loadLocalAiSetupPreferences,
  shouldOfferLocalAiSetup,
} from "../lib/localAiSetup";
import {
  getLocalAiStatus,
  isNativeDesktopApp,
  type LocalAiPresetInfo,
  type LocalAiStatus,
} from "../lib/localAiRuntime";
import {
  ensureLocalAi,
  studentFacingLocalAiDetail,
} from "../lib/localAiEnsure";

interface LocalAiSetupDialogProps {
  onReady?: () => void;
}

export function LocalAiSetupDialog({ onReady }: LocalAiSetupDialogProps) {
  const preferences = useAssistantPreferences();
  const [isNative, setIsNative] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LocalAiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isNativeDesktopApp().then((native) => {
      if (cancelled) return;
      setIsNative(native);
      if (!native) return;
      void getLocalAiStatus().then((next) => {
        if (cancelled) return;
        setStatus(next);
        const dismissed = loadLocalAiSetupPreferences().dismissed;
        setOpen(shouldOfferLocalAiSetup({ isNative: true, dismissed, status: next }));
      }).catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not check on-device AI.");
        const dismissed = loadLocalAiSetupPreferences().dismissed;
        setOpen(shouldOfferLocalAiSetup({ isNative: true, dismissed, status: null }));
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open || !status) return;
    const noneDownloaded = status.presets.every((preset) => !preset.downloaded);
    if (noneDownloaded && preferences.localModel !== "qwen3-1.7b-4bit") {
      saveAssistantPreferences({ ...preferences, localModel: "qwen3-1.7b-4bit" });
    }
  }, [open, preferences, status]);

  useEffect(() => {
    if (!open || status?.state !== "starting") return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getLocalAiStatus().then((next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.state === "ready") {
          dismissLocalAiSetup();
          setOpen(false);
          onReady?.();
        }
      });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, onReady, status?.state]);

  const presets = status?.presets.length ? status.presets : [];
  const selected = presets.find((preset) => preset.id === preferences.localModel)
    ?? presets[0]
    ?? null;

  const onPrimary = () => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await ensureLocalAi({
          modelId: (selected?.id ?? preferences.localModel) as LocalAiPresetInfo["id"],
          downloaded: selected?.downloaded ?? false,
          allowDownload: true,
        });
        setStatus(result.status);
        if (result.decision.type === "refuse" || result.decision.type === "unavailable") {
          setError(result.decision.detail);
        } else if (result.status.state === "ready") {
          dismissLocalAiSetup();
          setOpen(false);
          onReady?.();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "On-device AI setup failed.");
      } finally {
        setBusy(false);
      }
    })();
  };

  if (!isNative) return null;

  const detail = error
    ?? studentFacingLocalAiDetail(status, undefined, {
      modelId: preferences.localModel,
      downloading: busy && !(selected?.downloaded ?? false),
    });

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) {
        dismissLocalAiSetup();
        setOpen(false);
      }
    }}>
      <DialogContent className="max-w-[440px]" showCloseButton={false} aria-describedby="local-ai-setup-desc">
        <DialogHeader>
          <DialogTitle>Use on-device AI</DialogTitle>
          <DialogDescription id="local-ai-setup-desc">
            One click sets up a small model on this Mac. After that, open Assistant and describe a
            circuit — Tau lays it out and can simulate once you confirm. No account required.
          </DialogDescription>
        </DialogHeader>

        <div className="settings-local-runtime" data-state={status?.state ?? "checking"}>
          <div className="settings-local-runtime-head">
            <span className="settings-local-state-dot" aria-hidden="true" />
            <strong>
              {status?.state === "ready"
                ? "Ready"
                : status?.state === "starting"
                  ? "Loading…"
                  : status?.installed
                    ? "Ready to turn on"
                    : "Needs a quick setup"}
            </strong>
          </div>
          <p role="status">{detail}</p>
          {selected && status?.installed && !selected.downloaded && status.state !== "ready" && (
            <span className="settings-local-download">
              Download: {selected.downloadMb.toLocaleString("en-US")} MB
            </span>
          )}
          {error && <span className="settings-local-notice" role="status">{error}</span>}
        </div>

        {status?.installed && (
          <label className="settings-field" htmlFor="setup-local-model">
            <span>Model</span>
            <select
              id="setup-local-model"
              className="settings-select"
              aria-label="Setup local model"
              value={preferences.localModel}
              disabled={busy || status.state === "starting"}
              onChange={(event) => saveAssistantPreferences({
                ...preferences,
                localModel: event.currentTarget.value as LocalAiPresetInfo["id"],
              })}
            >
              {(presets.length ? presets : [{
                id: preferences.localModel,
                label: preferences.localModel,
              } as LocalAiPresetInfo]).map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
            <span className="settings-field-hint">
              Start with 1.7B (~900 MB) for a quick try; switch to 4B for better circuit proposals if you have 8 GB+ memory.
            </span>
          </label>
        )}

        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              dismissLocalAiSetup();
              setOpen(false);
            }}
          >
            Skip for now
          </Button>
          <Button
            size="sm"
            disabled={busy || status?.state === "starting" || status?.state === "ready"}
            onClick={onPrimary}
          >
            {busy ? "Working…" : "Turn on"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
