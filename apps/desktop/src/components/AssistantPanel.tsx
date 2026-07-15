import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { nanoid } from "nanoid";
import { Check, FilePlus2, LoaderCircle, RefreshCw, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import type { ParamScope } from "../simulation/paramScope";
import type { AnalysisResult } from "../simulation/linearTransient";
import type { ComponentMeasurement } from "../simulation/measurementModel";
import type { MeasResult } from "../simulation/measure";
import { assistantRequestNeedsCurrentAsc, buildAssistantContext } from "../lib/assistantContext";
import type {
  AssistantApplyCurrentAscAction,
  AssistantAscAction,
  AssistantCreateAscAction,
} from "../lib/assistantActions";
import {
  ASSISTANT_MODEL_LABEL,
  ASSISTANT_REQUEST_TIMEOUT_MS,
  assistantRequestTimeoutMs,
  streamAssistantReply,
  useAssistantApiKey,
  type AssistantChatMessage,
  type AssistantError,
  type AssistantProgressPhase,
  type AssistantStreamHandle,
} from "../lib/assistant";
import { useAssistantPreferences } from "../lib/assistantPreferences";
import { AssistantProviderError, type AssistantProviderReply } from "../lib/assistantProvider";
import type { AssistantRunMetrics } from "../lib/assistantProvider";
import { LocalMlxAssistant, LOCAL_MLX_MODEL_PRESETS } from "../lib/localMlxAssistant";
import { getLocalAiStatus, startLocalAi, LOCAL_AI_PRESETS, type LocalAiStatus } from "../lib/localAiRuntime";
import { renderMiniMarkdown } from "../lib/miniMarkdown";
import {
  clearAssistantRecovery,
  loadAssistantHistory,
  loadAssistantRecovery,
  saveAssistantHistory,
  saveAssistantRecovery,
} from "../lib/assistantMemory";
import { PanelResizeHandle, usePanelWidth, type PanelWidthConfig } from "./panelResize";

/** Docked at the far right of the simulator shell, same "edge=left widens"
 *  convention as the Components rail (panelResize.tsx). App.tsx calls
 *  usePanelWidth(this) itself and lifts the result up (not self-contained
 *  like TelemetryDock) — the responsive-floor effect needs to read the
 *  current width to keep the schematic/scope columns from being starved. */
export const ASSISTANT_PANEL_WIDTH: PanelWidthConfig = {
  storageKey: "tau.assistant.width",
  defaultWidth: 340,
  minWidth: 280,
  maxWidth: 520,
  edge: "left",
};

const OPEN_STORAGE_KEY = "tau.assistant.open";

export function loadAssistantOpen(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAssistantOpen(open: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // Quota exceeded / private mode — the session keeps its in-memory state.
  }
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AssistantAscAction[];
  metrics?: AssistantRunMetrics;
}

type AssistantActionState = "idle" | "working" | "done";

const PROGRESS_LABELS: Record<AssistantProgressPhase, string> = {
  connecting: "Connecting to Sonnet 5",
  reasoning: "Designing the circuit",
  drafting: "Building a compact circuit plan",
  inspecting: "Inspecting simulation data",
  validating: "Laying out and checking the circuit",
  repairing: "Correcting the circuit plan",
  responding: "Preparing the response",
};

const PROGRESS_STEPS = ["Plan", "Validate", "Ready"] as const;

function progressStep(phase: AssistantProgressPhase): number {
  if (phase === "inspecting" || phase === "validating" || phase === "repairing") return 1;
  if (phase === "responding") return 2;
  return 0;
}

function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function tokenLabel(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

function localProviderError(error: unknown): AssistantError {
  if (error instanceof AssistantProviderError) {
    return {
      kind: error.kind === "offline" ? "network" : "unknown",
      message: error.message,
    };
  }
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : "The local assistant request failed.",
  };
}

export type AssistantCreateAscHandler = (action: AssistantCreateAscAction) => void | Promise<void>;
export type AssistantApplyCurrentHandler = (action: AssistantApplyCurrentAscAction) => void | Promise<void>;

type ResizeState = ReturnType<typeof usePanelWidth>;

export interface AssistantPanelProps {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  directives: string[];
  params: ParamScope;
  analysis: AnalysisResult | null;
  componentRows: readonly ComponentMeasurement[];
  measurements: readonly MeasResult[];
  selectedId: string | null;
  resize: ResizeState;
  onOpenSettings: () => void;
  onClose: () => void;
  /** Preferred native boundary: create this validated source in the active project. */
  onCreateAsc?: AssistantCreateAscHandler;
  /** Undoable document boundary for a validated replacement of the current circuit. */
  onApplyCurrent?: AssistantApplyCurrentHandler;
  /** When inside the shared right dock, the dock owns width and the resize handle. */
  embedded?: boolean;
  /** Stable document identity used to keep each schematic's transcript separate. */
  memoryKey?: string;
}

export function AssistantPanel({
  components,
  wires,
  netLabels,
  directives,
  params,
  analysis,
  componentRows,
  measurements,
  selectedId,
  resize,
  onOpenSettings,
  onClose,
  onCreateAsc,
  onApplyCurrent,
  embedded = false,
  memoryKey = "untitled.asc",
}: AssistantPanelProps) {
  const apiKey = useAssistantApiKey();
  const preferences = useAssistantPreferences();
  const restoredRecovery = useMemo(() => loadAssistantRecovery(memoryKey), [memoryKey]);
  const localAssistant = useMemo(
    () => new LocalMlxAssistant({ model: preferences.localModel }),
    [preferences.localModel],
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() => (
    loadAssistantHistory(memoryKey).map((message) => ({ ...message, id: nanoid() }))
  ));
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [progressPhase, setProgressPhase] = useState<AssistantProgressPhase>("connecting");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(ASSISTANT_REQUEST_TIMEOUT_MS);
  const [error, setError] = useState<AssistantError | null>(() => (
    restoredRecovery
      ? {
          kind: restoredRecovery.status === "running" ? "network" : restoredRecovery.kind ?? "unknown",
          message: restoredRecovery.status === "running"
            ? "The previous assistant run was interrupted. No file was created."
            : restoredRecovery.message ?? "The previous assistant run did not complete. No file was created.",
        }
      : null
  ));
  const [retryPrompt, setRetryPrompt] = useState<string | null>(() => restoredRecovery?.prompt ?? null);
  const [actionStates, setActionStates] = useState<Record<string, AssistantActionState>>({});
  const streamRef = useRef<AssistantStreamHandle | null>(null);
  const localAbortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestStartedAtRef = useRef(0);

  // First-run local AI onboarding: proactively surface setup instead of
  // letting the first send() fail. Only tracked for the local-mlx provider —
  // switching to Anthropic drops the status so the card never lingers.
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiStatus | null>(null);
  const [localAiBusy, setLocalAiBusy] = useState(false);

  useEffect(() => {
    if (preferences.provider !== "local-mlx") {
      setLocalAiStatus(null);
      return;
    }
    let cancelled = false;
    void getLocalAiStatus().then((next) => {
      if (!cancelled) setLocalAiStatus(next);
    }).catch(() => {
      if (!cancelled) setLocalAiStatus(null);
    });
    return () => { cancelled = true; };
  }, [preferences.provider, preferences.localModel]);

  // Weights load asynchronously in native code — poll only while starting,
  // matching the Settings sheet's own local-runtime polling (ShellPanels.tsx).
  useEffect(() => {
    if (preferences.provider !== "local-mlx" || localAiStatus?.state !== "starting") return;
    let cancelled = false;
    const timer = globalThis.setInterval(() => {
      void getLocalAiStatus().then((next) => {
        if (!cancelled) setLocalAiStatus(next);
      }).catch(() => {});
    }, 1500);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [preferences.provider, localAiStatus?.state]);

  const localAiPresets = localAiStatus?.presets.length ? localAiStatus.presets : LOCAL_AI_PRESETS;
  const selectedLocalAiPreset = localAiPresets.find((preset) => preset.id === preferences.localModel)
    ?? LOCAL_AI_PRESETS.find((preset) => preset.id === preferences.localModel)!;
  // Native start/download can fail synchronously (e.g. a non-Tauri browser
  // runtime — see localAiRuntime.startLocalAi) as well as via a returned
  // "error" status; installed stays false in both the browser fallback and a
  // native Mac without the MLX runtime present, so gate the button on it
  // rather than only on state to avoid offering a button that can only throw.
  const showLocalAiSetup = preferences.provider === "local-mlx" && localAiStatus !== null && localAiStatus.state !== "ready";
  const showLocalAiStartButton = showLocalAiSetup
    && localAiStatus!.installed
    && (localAiStatus!.state === "stopped" || localAiStatus!.state === "error");

  const startLocalAiSetup = useCallback(async () => {
    setLocalAiBusy(true);
    try {
      const next = await startLocalAi(preferences.localModel, !selectedLocalAiPreset.downloaded);
      setLocalAiStatus(next);
    } catch (error) {
      setLocalAiStatus((prev) => (prev ? {
        ...prev,
        state: "error",
        detail: error instanceof Error ? error.message : "Could not start the local MLX runtime.",
      } : prev));
    } finally {
      setLocalAiBusy(false);
    }
  }, [preferences.localModel, selectedLocalAiPreset]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      saveAssistantHistory(memoryKey, messages.map(({ role, content, actions, metrics }) => ({
        role,
        content,
        actions,
        metrics,
      })));
    }, 250);
    return () => globalThis.clearTimeout(timer);
  }, [memoryKey, messages]);

  useEffect(() => {
    if (!streaming) return;
    const update = () => setElapsedSeconds(Math.floor((Date.now() - requestStartedAtRef.current) / 1000));
    update();
    const timer = globalThis.setInterval(update, 1000);
    return () => globalThis.clearInterval(timer);
  }, [streaming]);

  // Neither provider request may outlive its panel. Anthropic owns a stream
  // handle; the local OpenAI-compatible request uses the platform-standard
  // AbortController passed through LocalMlxAssistant.complete().
  useEffect(() => () => {
    streamRef.current?.abort();
    localAbortRef.current?.abort();
  }, []);

  const send = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text || streaming || (preferences.provider === "anthropic" && !apiKey)) return;
    setError(null);
    setRetryPrompt(null);

    const userMessage: ChatMessage = { id: nanoid(), role: "user", content: text };
    const assistantMessage: ChatMessage = { id: nanoid(), role: "assistant", content: "" };
    const history: AssistantChatMessage[] = [...messages, userMessage].map(({ role, content }) => ({ role, content }));

    setMessages((list) => [...list, userMessage, assistantMessage]);
    setInput("");
    requestStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setRequestTimeoutMs(assistantRequestTimeoutMs(text));
    setProgressPhase(preferences.provider === "anthropic" ? "connecting" : "reasoning");
    setStreaming(true);
    saveAssistantRecovery(memoryKey, { status: "running", prompt: text });

    const { text: contextText, canApplyCurrent } = buildAssistantContext({
      components,
      wires,
      netLabels,
      directives,
      params,
      analysis,
      componentRows,
      measurements,
      selectedId,
    }, {
      includeCurrentAsc: components.length > 0 && assistantRequestNeedsCurrentAsc(text),
    });

    const completeTurn = (reply: AssistantProviderReply) => {
      setMessages((list) => list.map((message) => (
        message.id === assistantMessage.id
          ? {
              ...message,
              content: reply.text || message.content,
              ...(reply.actions.length > 0 ? { actions: reply.actions } : {}),
              ...(reply.metrics ? { metrics: reply.metrics } : {}),
            }
          : message
      )));
      if (reply.rejectedActionCount > 0) {
        const message = preferences.provider === "anthropic"
          ? "Tau rejected Sonnet's circuit plan after one automatic correction. No file was created."
          : "Tau rejected the local model's circuit plan. No file was created.";
        setRetryPrompt(text);
        setError({
          kind: "invalid_action",
          message,
        });
        saveAssistantRecovery(memoryKey, { status: "failed", prompt: text, kind: "invalid_action", message });
      } else {
        setRetryPrompt(null);
        clearAssistantRecovery(memoryKey);
      }
      setStreaming(false);
    };

    const failTurn = (err: AssistantError) => {
      setStreaming(false);
      setError(err);
      setRetryPrompt(text);
      saveAssistantRecovery(memoryKey, { status: "failed", prompt: text, kind: err.kind, message: err.message });
      // Drop the placeholder bubble if nothing ever reached it — an empty
      // assistant turn would otherwise sit invisibly in the transcript.
      setMessages((list) => list.filter((message) => (
        message.id !== assistantMessage.id || message.content !== "" || Boolean(message.actions?.length)
      )));
    };

    if (preferences.provider === "local-mlx") {
      const controller = new AbortController();
      localAbortRef.current = controller;
      void localAssistant.complete({
        contextText,
        history,
        allowCurrentApply: canApplyCurrent,
        operationContext: { analysis, params },
      }, controller.signal).then((reply) => {
        if (controller.signal.aborted || localAbortRef.current !== controller) return;
        localAbortRef.current = null;
        completeTurn(reply);
        // A completion proves the runtime is alive. If the setup card is
        // still showing a stale "stopped" (the server was started elsewhere,
        // e.g. the first-run dialog), reconcile so the card retires.
        setLocalAiStatus((current) => {
          if (current && current.state !== "ready") {
            void getLocalAiStatus().then(setLocalAiStatus).catch(() => {});
          }
          return current;
        });
      }).catch((localError: unknown) => {
        if (controller.signal.aborted
          || (localError instanceof AssistantProviderError && localError.kind === "aborted")
          || localAbortRef.current !== controller) return;
        localAbortRef.current = null;
        failTurn(localProviderError(localError));
        // The server can die between the mount-time status check and this
        // send; refresh so the setup card reappears instead of stranding the
        // user on an error with no start button.
        if (localError instanceof AssistantProviderError && localError.kind === "offline") {
          void getLocalAiStatus().then(setLocalAiStatus).catch(() => {});
        }
      });
      return;
    }

    streamRef.current = streamAssistantReply(apiKey, contextText, history, {
      onDelta: (snapshot) => {
        setMessages((list) => list.map((m) => (m.id === assistantMessage.id ? { ...m, content: snapshot } : m)));
      },
      onDone: (reply) => {
        completeTurn(reply);
        streamRef.current = null;
      },
      onError: (err) => {
        streamRef.current = null;
        failTurn(err);
      },
      onProgress: setProgressPhase,
    }, { analysis, params }, { allowCurrentApply: canApplyCurrent });
  }, [messages, streaming, preferences.provider, apiKey, components, wires, netLabels, directives, params, analysis, componentRows, measurements, selectedId, localAssistant, memoryKey]);

  const stop = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    localAbortRef.current?.abort();
    localAbortRef.current = null;
    setStreaming(false);
    clearAssistantRecovery(memoryKey);
  }, [memoryKey]);

  const clearConversation = useCallback(() => {
    stop();
    setMessages([]);
    setActionStates({});
    setError(null);
    setRetryPrompt(null);
  }, [stop]);

  const confirmAction = useCallback(async (action: AssistantAscAction) => {
    if (actionStates[action.id] === "working" || actionStates[action.id] === "done") return;
    const handler = action.type === "create_asc" ? onCreateAsc : onApplyCurrent;
    if (!handler) {
      setError({
        kind: "invalid_action",
        message: action.type === "create_asc"
          ? "Circuit creation is not connected to the active project."
          : "Current-circuit editing is not connected to the active document.",
      });
      return;
    }
    setError(null);
    setActionStates((states) => ({ ...states, [action.id]: "working" }));
    try {
      if (action.type === "create_asc") await onCreateAsc?.(action);
      else await onApplyCurrent?.(action);
      setActionStates((states) => ({ ...states, [action.id]: "done" }));
    } catch {
      setActionStates((states) => ({ ...states, [action.id]: "idle" }));
      setError({
        kind: "unknown",
        message: action.type === "create_asc"
          ? `Couldn't create ${action.filename}. Check the active Schematics folder and try again.`
          : "Couldn't apply the proposed changes to the current circuit. Try asking for a revised proposal.",
      });
    }
  }, [actionStates, onApplyCurrent, onCreateAsc]);

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  };

  const selectedComponent = selectedId ? components.find((c) => c.id === selectedId) ?? null : null;
  const selectedRef = selectedComponent ? (selectedComponent.label || selectedComponent.id) : null;
  const hasContent = messages.length > 0 || error;
  const modelBadge = preferences.provider === "local-mlx"
    ? `Local · ${LOCAL_MLX_MODEL_PRESETS[preferences.localModel].label}`
    : `Claude · ${ASSISTANT_MODEL_LABEL}`;
  const needsCloudKey = preferences.provider === "anthropic" && !apiKey;

  return (
    <aside
      className={cn("assistant-panel", embedded && "assistant-panel--embedded")}
      aria-label="Assistant"
      style={embedded ? undefined : { "--assistant-w": `${resize.width}px` } as CSSProperties}
    >
      {!embedded && (
        <PanelResizeHandle
          edge="left"
          label="Resize assistant panel"
          width={resize.width}
          minWidth={ASSISTANT_PANEL_WIDTH.minWidth}
          maxWidth={ASSISTANT_PANEL_WIDTH.maxWidth}
          dragging={resize.dragging}
          onPointerDown={resize.onPointerDown}
          onKeyDown={resize.onKeyDown}
        />
      )}
      <header className="assistant-header">
        <div>
          <div className="assistant-kicker">Assistant</div>
          <div className="assistant-title-row">
            <span className="assistant-title">Ask Tau</span>
            <span className="assistant-model-badge">{modelBadge}</span>
          </div>
        </div>
        <div className="assistant-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={clearConversation}
                disabled={!hasContent}
                aria-label="Clear conversation"
              >
                <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear conversation</TooltipContent>
          </Tooltip>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close assistant">
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      {needsCloudKey ? (
        <div className="assistant-body">
          <div className="panel-empty">
            <div className="panel-empty-glyph" aria-hidden="true" />
            <strong>No API Key</strong>
            <span>Add an Anthropic API key in Settings to ask questions about this circuit.</span>
            <Button size="sm" variant="outline" onClick={onOpenSettings}>Open Settings</Button>
          </div>
        </div>
      ) : (
        <>
          {showLocalAiSetup && localAiStatus && (
            <div className="assistant-setup-card" data-state={localAiStatus.state}>
              <div className="assistant-setup-head">
                <Sparkles size={14} strokeWidth={1.7} aria-hidden="true" />
                <div className="assistant-setup-copy">
                  <strong>{selectedLocalAiPreset.label}</strong>
                  <span>{selectedLocalAiPreset.downloadMb.toLocaleString("en-US")} MB</span>
                </div>
              </div>
              <p className="assistant-setup-detail" role="status">{localAiStatus.detail}</p>
              {showLocalAiStartButton && (
                <div className="assistant-setup-actions">
                  <Button
                    type="button"
                    size="sm"
                    disabled={localAiBusy}
                    onClick={() => void startLocalAiSetup()}
                  >
                    {selectedLocalAiPreset.downloaded ? "Start" : "Download & start"}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && !error && (
              <div className="assistant-intro">
                <Sparkles size={16} strokeWidth={1.6} aria-hidden="true" />
                <p>Ask about this circuit or describe one to create — I can see the schematic and latest simulation results.</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={message.id} className={cn("assistant-message", `assistant-message--${message.role}`)}>
                <div className="assistant-bubble">
                  {message.role === "assistant"
                    ? message.content ? renderMiniMarkdown(message.content) : null
                    : <p>{message.content}</p>}
                  {message.role === "assistant" && message.actions?.map((action) => {
                    const status = actionStates[action.id] ?? "idle";
                    const isCreate = action.type === "create_asc";
                    const handlerAvailable = isCreate ? Boolean(onCreateAsc) : Boolean(onApplyCurrent);
                    const actionLabel = isCreate ? action.filename : "Current circuit";
                    return (
                      <div className="assistant-action" key={action.id} data-status={status}>
                        {isCreate
                          ? <FilePlus2 size={17} strokeWidth={1.7} aria-hidden="true" />
                          : <RefreshCw size={17} strokeWidth={1.7} aria-hidden="true" />}
                        <div className="assistant-action-copy">
                          <strong>{actionLabel}</strong>
                          <span>{action.componentCount} components · {action.wireCount} wires</span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={status === "done" ? "outline" : "default"}
                          disabled={status !== "idle" || !handlerAvailable}
                          onClick={() => void confirmAction(action)}
                          aria-label={isCreate ? `Create ${action.filename}` : "Apply to current circuit"}
                        >
                          {status === "done" ? <Check size={12} aria-hidden="true" /> : null}
                          {status === "working"
                            ? isCreate ? "Creating…" : "Applying…"
                            : status === "done"
                              ? isCreate ? "Created" : "Applied"
                              : isCreate ? "Create" : "Apply to current"}
                        </Button>
                      </div>
                    );
                  })}
                  {message.role === "assistant" && message.metrics && (
                    <div className="assistant-run-meta" aria-label="Assistant request usage">
                      <span>{elapsedLabel(Math.max(1, Math.round(message.metrics.durationMs / 1000)))}</span>
                      <span>{message.metrics.attempts === 1 ? "1 pass" : `${message.metrics.attempts} passes`}</span>
                      <span>{tokenLabel(message.metrics.inputTokens)} in</span>
                      <span>{tokenLabel(message.metrics.outputTokens)} out</span>
                      {message.metrics.cacheCreationInputTokens > 0 && (
                        <span>{tokenLabel(message.metrics.cacheCreationInputTokens)} cache write</span>
                      )}
                      {message.metrics.cacheReadInputTokens > 0 && (
                        <span>{tokenLabel(message.metrics.cacheReadInputTokens)} cache hit</span>
                      )}
                    </div>
                  )}
                  {streaming && message.role === "assistant" && index === messages.length - 1 && (
                    <div className="assistant-progress" role="status" aria-live="polite">
                      <div className="assistant-progress-head">
                        <LoaderCircle size={15} strokeWidth={1.8} aria-hidden="true" />
                        <div className="assistant-progress-copy">
                          <strong>{preferences.provider === "anthropic" ? PROGRESS_LABELS[progressPhase] : "Planning on this Mac"}</strong>
                          <span>
                            {elapsedLabel(elapsedSeconds)}
                            {preferences.provider === "anthropic"
                              ? ` · ${Math.max(0, Math.ceil(requestTimeoutMs / 1000) - elapsedSeconds)}s safety limit`
                              : " · Running locally"}
                          </span>
                        </div>
                      </div>
                      <div className="assistant-progress-track" aria-hidden="true">
                        <span />
                      </div>
                      <div className="assistant-progress-steps" aria-hidden="true">
                        {PROGRESS_STEPS.map((step, stepIndex) => (
                          <span
                            key={step}
                            className={cn(
                              stepIndex < progressStep(progressPhase) && "complete",
                              stepIndex === progressStep(progressPhase) && "current",
                            )}
                          >
                            <i />{step}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {error && (
              <div className="assistant-error" role="alert">
                <span>{error.message}</span>
                <div className="assistant-error-actions">
                  {error.kind === "auth" && (
                    <Button size="sm" variant="outline" onClick={onOpenSettings}>Open Settings</Button>
                  )}
                  {error.kind !== "auth" && retryPrompt && !streaming && (
                    <Button size="sm" variant="outline" onClick={() => send(retryPrompt)}>
                      <RefreshCw size={12} aria-hidden="true" /> Retry
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="assistant-chips" role="group" aria-label="Quick actions">
            <button
              type="button"
              className="assistant-chip"
              disabled={streaming}
              onClick={() => send("Summarize my circuit: what does it do, and what are the key stages?")}
            >
              Summarize my circuit
            </button>
            <button
              type="button"
              className="assistant-chip"
              disabled={streaming}
              onClick={() => send("Explain the current simulation results — what do they show, and is anything notable or unexpected?")}
            >
              Explain the current results
            </button>
            {selectedRef && (
              <button
                type="button"
                className="assistant-chip"
                disabled={streaming}
                onClick={() => send(`Why does ${selectedRef} behave this way, based on the current circuit and results?`)}
              >
                Why does {selectedRef} behave this way?
              </button>
            )}
          </div>

          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <textarea
              className="assistant-textarea"
              value={input}
              placeholder="Ask a question or describe a circuit…"
              disabled={streaming}
              rows={2}
              spellCheck={false}
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={onComposerKeyDown}
              aria-label="Message the assistant"
            />
            {streaming ? (
              <Button type="button" variant="outline" size="sm" onClick={stop} className="gap-1.5">
                <Square size={11} strokeWidth={2} aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!input.trim()}>Send</Button>
            )}
          </form>
        </>
      )}
    </aside>
  );
}

export default AssistantPanel;
