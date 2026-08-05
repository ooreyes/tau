import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { nanoid } from "nanoid";
import { Check, FilePlus2, History, MessageSquarePlus, Pencil, RefreshCw, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSchematic } from "../store/useSchematic";
import { useRuntimeModelLibraries } from "../store/useRuntimeModelLibraries";
import type { NetLabel, Probe, SchematicComponent, SchematicWire } from "../schematic/types";
import type { ParamScope } from "../simulation/paramScope";
import type { AnalysisResult } from "../simulation/linearTransient";
import type { ComponentMeasurement } from "../simulation/measurementModel";
import type { MeasResult } from "../simulation/measure";
import type { OperatingPointResult } from "../simulation/operatingPoint";
import type { AcResult } from "../simulation/acSweep";
import type { DcSweepResult } from "../simulation/dcSweep";
import type { FourierResult } from "../simulation/fourier";
import { assistantRequestNeedsCurrentAsc, buildAssistantContext, buildAssistantSuggestions } from "../lib/assistantContext";
import type {
  AssistantApplyCurrentAscAction,
  AssistantAscAction,
  AssistantCreateAscAction,
} from "../lib/assistantActions";
import {
  ASSISTANT_MODEL_LABEL,
  compactAssistantHistory,
  streamAssistantReply,
  useAssistantApiKey,
  type AssistantChatMessage,
  type AssistantError,
  type AssistantProgressPhase,
  type AssistantStreamHandle,
} from "../lib/assistant";
import { saveAssistantPreferences, useAssistantPreferences } from "../lib/assistantPreferences";
import { AssistantProviderError, type AssistantProvider, type AssistantProviderReply } from "../lib/assistantProvider";
import type { AssistantRunMetrics } from "../lib/assistantProvider";
import { LocalMlxAssistant, LOCAL_MLX_MODEL_PRESETS } from "../lib/localMlxAssistant";
import { GeminiAssistant, GEMINI_MODEL_PRESETS } from "../lib/geminiAssistant";
import { useGeminiApiKey } from "../lib/providerApiKey";
import { getLocalAiStatus, LOCAL_AI_PRESETS, type LocalAiStatus } from "../lib/localAiRuntime";
import {
  ensureLocalAi,
  studentFacingLocalAiDetail,
} from "../lib/localAiEnsure";
import { loadCustomLocalAiModels } from "../lib/localAiModels";
import { hasCloudAiConsent, cloudAiConsentRefusal } from "../lib/cloudAiConsent";
import { useCloudAiConsent } from "../lib/cloudAiConsentHooks";
import { renderMiniMarkdown } from "../lib/miniMarkdown";
import {
  clearAssistantRecovery,
  createConversation,
  deleteConversation as deleteStoredConversation,
  getActiveConversationId,
  listConversations,
  loadAssistantRecovery,
  renameConversation,
  mergeConversationHistory,
  saveAssistantRecovery,
  saveConversationMessages,
  setActiveConversationId as persistActiveConversationId,
  ASSISTANT_PROMPT_CHAR_LIMIT,
  type AssistantConversation,
} from "../lib/assistantMemory";
import { PanelResizeHandle, usePanelWidth, type PanelWidthConfig } from "./panelResize";
import { BodeMascot } from "./BodeMascot";

/** Docked at the far right of the simulator shell, same "edge=left widens"
 *  convention as the Components rail (panelResize.tsx). App.tsx calls
 *  usePanelWidth(this) itself and lifts the result up (not self-contained
 *  like TelemetryDock) - the responsive-floor effect needs to read the
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
    // Quota exceeded / private mode - the session keeps its in-memory state.
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

function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function tokenLabel(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

/** Coarse "last active" label for a past-chats row - precision beyond
 *  minutes/hours/days isn't useful for picking a conversation back up. */
function relativeTime(timestampMs: number): string {
  const diffSeconds = Math.round((Date.now() - timestampMs) / 1000);
  if (diffSeconds < 45) return "Just now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestampMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Strips the client-only `id` field ChatMessage adds on top of
 *  PersistedAssistantMessage - the shape every save path writes. */
function toPersistedMessages(list: readonly ChatMessage[]) {
  return list.map(({ role, content, actions, metrics }) => ({ role, content, actions, metrics }));
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

/** Mount-time seed for the active conversation: resolves (and, via
 *  listConversations, migrates) the stored active id against the real
 *  conversation list, falling back to the newest thread or a fresh empty one.
 *  Pure read - the resolved active-id pointer is written durably by the
 *  debounced save effect and by the explicit switch/new-chat/delete handlers,
 *  never here, so this stays safe to call from a lazy useState initializer
 *  (React 18 StrictMode invokes those twice in dev). */
function seedConversationState(memoryKey: string, legacyMemoryKey?: string): {
  activeId: string;
  messages: ChatMessage[];
  conversations: AssistantConversation[];
} {
  if (legacyMemoryKey) mergeConversationHistory(legacyMemoryKey, memoryKey);
  const conversations = listConversations(memoryKey);
  const storedActiveId = getActiveConversationId(memoryKey);
  const active = conversations.find((conversation) => conversation.id === storedActiveId) ?? conversations[0] ?? null;
  return {
    activeId: active?.id ?? nanoid(),
    messages: active ? active.messages.map((message) => ({ ...message, id: nanoid() })) : [],
    conversations,
  };
}

type ResizeState = ReturnType<typeof usePanelWidth>;

export interface AssistantPanelProps {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  probes?: readonly Probe[];
  directives: string[];
  params: ParamScope;
  analysis: AnalysisResult | null;
  opResult?: OperatingPointResult | null;
  acResult?: AcResult | null;
  dcResult?: DcSweepResult | null;
  fourier?: readonly FourierResult[];
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
  /** Stable project identity. One active chat follows the user across files. */
  memoryKey?: string;
  /** Previous file-scoped key, read only to migrate older Tau chat storage. */
  legacyMemoryKey?: string;
}

export function AssistantPanel({
  components,
  wires,
  netLabels,
  probes = [],
  directives,
  params,
  analysis,
  opResult = null,
  acResult = null,
  dcResult = null,
  fourier = [],
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
  legacyMemoryKey,
}: AssistantPanelProps) {
  const apiKey = useAssistantApiKey();
  const geminiKey = useGeminiApiKey();
  const preferences = useAssistantPreferences();
  const userModelLibraries = useSchematic((s) => s.userModelLibraries);
  const installedLtspiceModelLibraries = useRuntimeModelLibraries((s) => s.installedLtspice);
  const userModelLibraryTexts = useMemo(
    () => [...userModelLibraries, ...installedLtspiceModelLibraries].map((library) => library.text),
    [installedLtspiceModelLibraries, userModelLibraries],
  );
  const restoredRecovery = useMemo(() => loadAssistantRecovery(memoryKey), [memoryKey]);
  const localAssistant = useMemo(
    () => new LocalMlxAssistant({ model: preferences.localModel }),
    [preferences.localModel],
  );
  const geminiAssistant = useMemo(
    () => (geminiKey ? new GeminiAssistant({ apiKey: geminiKey, model: preferences.geminiModel }) : null),
    [geminiKey, preferences.geminiModel],
  );
  /** Both non-Anthropic providers implement the same non-streaming
   *  AssistantProvider contract, so the send path below branches once. */
  const directAssistant: AssistantProvider | null = preferences.provider === "gemini"
    ? geminiAssistant
    : preferences.provider === "local-mlx" ? localAssistant : null;
  // One seed call - StrictMode double-invokes lazy initializers, and three
  // separate seedConversationState() calls would mint three different ids for
  // an empty circuit.
  const [seed] = useState(() => seedConversationState(memoryKey, legacyMemoryKey));
  const [activeConversationId, setActiveConversationId] = useState(seed.activeId);
  const [messages, setMessages] = useState<ChatMessage[]>(seed.messages);
  const [conversations, setConversations] = useState<AssistantConversation[]>(seed.conversations);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [progressPhase, setProgressPhase] = useState<AssistantProgressPhase>("connecting");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
  // Latest transcript identity for synchronous flush on unmount / memoryKey
  // change - the debounced save below would otherwise drop up to 250ms of
  // turns when the panel closes or remounts onto a new circuit key.
  const persistRef = useRef({ memoryKey, activeConversationId, messages });
  persistRef.current = { memoryKey, activeConversationId, messages };
  const memoryKeyRef = useRef(memoryKey);

  // First-run local AI: auto install → download → load so chat just works.
  const cloudConsent = useCloudAiConsent();
  const [localAiStatus, setLocalAiStatus] = useState<LocalAiStatus | null>(null);
  const [localAiBusy, setLocalAiBusy] = useState(false);
  const [localAiNotice, setLocalAiNotice] = useState<string | null>(null);
  const autoEnsureKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (preferences.provider !== "local-mlx") {
      setLocalAiStatus(null);
      setLocalAiNotice(null);
      autoEnsureKeyRef.current = null;
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

  const customLocalAiModels = loadCustomLocalAiModels();
  const localAiPresets = [
    ...(localAiStatus?.presets.length ? localAiStatus.presets : LOCAL_AI_PRESETS),
    ...customLocalAiModels,
  ];
  const selectedLocalAiPreset = localAiPresets.find((preset) => preset.id === preferences.localModel)
    ?? LOCAL_AI_PRESETS.find((preset) => preset.id === preferences.localModel)
    ?? LOCAL_AI_PRESETS[1];
  const localAiCanSend = preferences.provider !== "local-mlx"
    || (localAiStatus?.state === "ready" && localAiStatus.managed);
  const showLocalAiSetup = preferences.provider === "local-mlx" && localAiStatus !== null && localAiStatus.state !== "ready";
  const showLocalAiStartButton = showLocalAiSetup
    && !localAiBusy
    && localAiStatus!.state !== "starting"
    && (localAiStatus!.installed || localAiStatus!.state === "error" || localAiStatus!.state === "stopped");
  const localSetupDetail = localAiNotice
    ?? studentFacingLocalAiDetail(localAiStatus, undefined, {
      modelId: preferences.localModel,
      downloading: localAiBusy && !selectedLocalAiPreset.downloaded,
    });

  const startLocalAiSetup = useCallback(async () => {
    setLocalAiBusy(true);
    setLocalAiNotice(null);
    try {
      const result = await ensureLocalAi({
        modelId: preferences.localModel,
        downloaded: selectedLocalAiPreset.downloaded,
        repository: "custom" in selectedLocalAiPreset ? selectedLocalAiPreset.repository : undefined,
        allowDownload: true,
      });
      setLocalAiStatus(result.status);
      if (result.decision.type === "refuse" || result.decision.type === "unavailable") {
        setLocalAiNotice(result.decision.detail);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start on-device AI.";
      setLocalAiStatus((prev) => (prev ? { ...prev, state: "error", detail: message } : prev));
      setLocalAiNotice(message);
    } finally {
      setLocalAiBusy(false);
    }
  }, [preferences.localModel, selectedLocalAiPreset]);

  useEffect(() => {
    if (preferences.provider !== "local-mlx" || !localAiStatus || localAiBusy) return;
    if (localAiStatus.state === "ready" || localAiStatus.state === "starting") return;
    if (!localAiStatus.installed && !localAiStatus.managed && localAiStatus.state === "stopped") {
      const key = `unavailable:${preferences.localModel}`;
      if (autoEnsureKeyRef.current === key) return;
      autoEnsureKeyRef.current = key;
      setLocalAiNotice("Open the Tau Mac app to use on-device AI. No account or API key needed.");
      return;
    }
    const key = `${preferences.localModel}:${localAiStatus.state}:${localAiStatus.installed}`;
    if (autoEnsureKeyRef.current === key) return;
    autoEnsureKeyRef.current = key;
    void startLocalAiSetup();
  }, [preferences.provider, preferences.localModel, localAiStatus, localAiBusy, startLocalAiSetup]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      saveConversationMessages(memoryKey, activeConversationId, toPersistedMessages(messages));
      // Keeps the reload pointer in sync with whichever thread just actually
      // persisted - cheaper than writing it on every switch of an empty,
      // never-saved conversation (see seedConversationState).
      persistActiveConversationId(memoryKey, activeConversationId);
      setConversations(listConversations(memoryKey));
    }, 250);
    return () => globalThis.clearTimeout(timer);
  }, [memoryKey, activeConversationId, messages]);

  // Visiting another schematic may expose chat rows written by an older
  // file-scoped Tau build. Merge them into the project list without changing
  // the conversation currently in progress.
  useEffect(() => {
    if (!legacyMemoryKey || legacyMemoryKey === memoryKey) return;
    mergeConversationHistory(legacyMemoryKey, memoryKey);
    setConversations(listConversations(memoryKey));
  }, [legacyMemoryKey, memoryKey]);

  // Flush the latest transcript synchronously on unmount. Declared after the
  // debounce effect so this cleanup runs first (React reverse order) and the
  // cancelled timer cannot race a late write.
  useEffect(() => () => {
    const { memoryKey: key, activeConversationId: id, messages: msgs } = persistRef.current;
    saveConversationMessages(key, id, toPersistedMessages(msgs));
    persistActiveConversationId(key, id);
  }, []);

  // Closes the past-chats popover on Escape or a click/tap outside it -
  // there's no Radix Popover in play here (see AssistantPanel's header
  // markup below), so both need to be wired up by hand.
  useEffect(() => {
    if (!historyMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!historyMenuRef.current?.contains(event.target as Node)) setHistoryMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [historyMenuOpen]);

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

  // Shared tail of every conversation switch: action/error/draft state is
  // scoped to "whatever's on screen right now", not persisted per thread, so
  // it's reset any time the displayed thread changes.
  const resetComposerState = useCallback(() => {
    setActionStates({});
    setError(null);
    setRetryPrompt(null);
    setInput("");
    setEditingMessageId(null);
    setEditDraft("");
  }, []);

  // Belt-and-suspenders when memoryKey changes without a remount (App usually
  // keys the panel). Flush the outgoing key, then re-seed from storage so a
  // migrateConversation write that landed just before this effect is visible.
  useEffect(() => {
    if (memoryKeyRef.current === memoryKey) return;
    const prev = persistRef.current;
    saveConversationMessages(prev.memoryKey, prev.activeConversationId, toPersistedMessages(prev.messages));
    persistActiveConversationId(prev.memoryKey, prev.activeConversationId);
    memoryKeyRef.current = memoryKey;
    const seeded = seedConversationState(memoryKey);
    setActiveConversationId(seeded.activeId);
    setMessages(seeded.messages);
    setConversations(seeded.conversations);
    resetComposerState();
  }, [memoryKey, resetComposerState]);

  const send = useCallback((raw: string, baseMessages: readonly ChatMessage[] = messages) => {
    const text = raw.trim();
    if (text.length > ASSISTANT_PROMPT_CHAR_LIMIT) {
      setError({
        kind: "unknown",
        message: `Messages are limited to ${ASSISTANT_PROMPT_CHAR_LIMIT.toLocaleString("en-US")} characters. Shorten this prompt before sending.`,
      });
      setRetryPrompt(null);
      return;
    }
    if (!text || streaming || !localAiCanSend
      || (preferences.provider === "anthropic" && (!apiKey || !hasCloudAiConsent()))
      || (preferences.provider === "gemini" && (!geminiAssistant || !hasCloudAiConsent()))) return;
    setError(null);
    setRetryPrompt(null);

    const userMessage: ChatMessage = { id: nanoid(), role: "user", content: text };
    const assistantMessage: ChatMessage = { id: nanoid(), role: "assistant", content: "" };
    // Apply the same tight history budget before either provider sees it.
    // Cloud applies this defensively again; doing it here keeps local MLX from
    // paying for a circuit's entire persisted transcript on every follow-up.
    const history: AssistantChatMessage[] = compactAssistantHistory(
      [...baseMessages, userMessage].map(({ role, content }) => ({ role, content })),
    );

    const pendingMessages = [...baseMessages, userMessage, assistantMessage];
    setMessages(pendingMessages);
    // Create the history row before network/local inference starts. Closing
    // the panel, changing files, or a provider crash can no longer leave a
    // visible prompt absent from Past chats during the debounce window.
    saveConversationMessages(memoryKey, activeConversationId, toPersistedMessages(pendingMessages));
    persistActiveConversationId(memoryKey, activeConversationId);
    setConversations(listConversations(memoryKey));
    setInput("");
    requestStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setProgressPhase(preferences.provider === "anthropic" ? "connecting" : "reasoning");
    setStreaming(true);
    saveAssistantRecovery(memoryKey, { status: "running", prompt: text });

    const { text: contextText, canApplyCurrent } = buildAssistantContext({
      components,
      wires,
      netLabels,
      probes,
      directives,
      userModelLibraries: userModelLibraryTexts,
      params,
      analysis,
      opResult,
      acResult,
      dcResult,
      fourier,
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
        // Which model produced the plan is an implementation detail; the user
        // needs to know the plan was rejected and that nothing was written.
        const message = preferences.provider === "anthropic"
          ? "Bode rejected the proposed circuit after one automatic correction. No file was created."
          : "Bode rejected the proposed circuit. No file was created.";
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
      // Drop the placeholder bubble if nothing ever reached it - an empty
      // assistant turn would otherwise sit invisibly in the transcript.
      setMessages((list) => list.filter((message) => (
        message.id !== assistantMessage.id || message.content !== "" || Boolean(message.actions?.length)
      )));
    };

    if (directAssistant) {
      const isLocal = preferences.provider === "local-mlx";
      const controller = new AbortController();
      localAbortRef.current = controller;
      void directAssistant.complete({
        contextText,
        history,
        allowCurrentApply: canApplyCurrent,
        operationContext: { analysis, params },
      }, controller.signal).then((reply) => {
        if (controller.signal.aborted || localAbortRef.current !== controller) return;
        localAbortRef.current = null;
        completeTurn(reply);
        if (!isLocal) return;
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
        if (isLocal && localError instanceof AssistantProviderError && localError.kind === "offline") {
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
  }, [messages, streaming, localAiCanSend, preferences.provider, apiKey, components, wires, netLabels, probes, directives, userModelLibraryTexts, params, analysis, opResult, acResult, dcResult, fourier, componentRows, measurements, selectedId, localAssistant, geminiAssistant, directAssistant, memoryKey]);

  const beginMessageEdit = useCallback((message: ChatMessage) => {
    if (streaming || message.role !== "user") return;
    setEditingMessageId(message.id);
    setEditDraft(message.content);
  }, [streaming]);

  const cancelMessageEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft("");
  }, []);

  const resendEditedMessage = useCallback((messageId: string) => {
    const text = editDraft.trim();
    const index = messages.findIndex((message) => message.id === messageId && message.role === "user");
    if (!text || index < 0 || streaming) return;
    const baseMessages = messages.slice(0, index);
    const isOpeningPrompt = !baseMessages.some((message) => message.role === "user");
    // Flush before retitling so a very fast edit after the first reply cannot
    // race the 250ms persistence debounce and leave the old title behind.
    saveConversationMessages(memoryKey, activeConversationId, toPersistedMessages(messages));
    if (isOpeningPrompt) renameConversation(memoryKey, activeConversationId, text);
    setConversations(listConversations(memoryKey));
    cancelMessageEdit();
    send(text, baseMessages);
  }, [activeConversationId, cancelMessageEdit, editDraft, memoryKey, messages, send, streaming]);

  const stop = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    localAbortRef.current?.abort();
    localAbortRef.current = null;
    setStreaming(false);
    clearAssistantRecovery(memoryKey);
  }, [memoryKey]);

  const switchConversation = useCallback((id: string) => {
    setHistoryMenuOpen(false);
    if (id === activeConversationId) return;
    stop();
    // Flushes the outgoing thread's exact latest state synchronously - the
    // debounced save above would otherwise drop up to 250ms of edits if a
    // switch lands mid-window - then re-reads so both the target thread's
    // messages and the menu's own listing are never stale by that same
    // window (not the possibly-stale `conversations` state).
    saveConversationMessages(memoryKey, activeConversationId, toPersistedMessages(messages));
    const refreshed = listConversations(memoryKey);
    setConversations(refreshed);
    const target = refreshed.find((conversation) => conversation.id === id);
    setActiveConversationId(id);
    setMessages(target ? target.messages.map((message) => ({ ...message, id: nanoid() })) : []);
    resetComposerState();
    persistActiveConversationId(memoryKey, id);
  }, [activeConversationId, memoryKey, messages, resetComposerState, stop]);

  // Archiving is implicit: the outgoing conversation is flushed (see
  // switchConversation) and already durably saved, so "new chat" only has to
  // point the active id at a fresh, still-empty thread.
  const startNewChat = useCallback(() => {
    setHistoryMenuOpen(false);
    stop();
    saveConversationMessages(memoryKey, activeConversationId, toPersistedMessages(messages));
    setConversations(listConversations(memoryKey));
    const id = createConversation();
    setActiveConversationId(id);
    setMessages([]);
    resetComposerState();
    persistActiveConversationId(memoryKey, id);
  }, [activeConversationId, memoryKey, messages, resetComposerState, stop]);

  // Used both for the header's "delete current conversation" affordance and
  // the past-chats menu's per-row delete. Deleting a conversation that isn't
  // the active one only has to prune the list; deleting the active one also
  // has to pick something else to display (newest remaining, or a fresh
  // empty thread when that was the last one).
  const deleteConversationById = useCallback((id: string) => {
    deleteStoredConversation(memoryKey, id);
    const remaining = listConversations(memoryKey);
    setConversations(remaining);
    if (id !== activeConversationId) return;
    stop();
    const next = remaining[0] ?? null;
    const nextId = next?.id ?? createConversation();
    setActiveConversationId(nextId);
    setMessages(next ? next.messages.map((message) => ({ ...message, id: nanoid() })) : []);
    resetComposerState();
    persistActiveConversationId(memoryKey, nextId);
  }, [activeConversationId, memoryKey, resetComposerState, stop]);

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
      // Create remounts the panel under a new memoryKey - flush first so
      // migrateConversation in App can copy the complete transcript.
      if (action.type === "create_asc") {
        saveConversationMessages(memoryKey, activeConversationId, toPersistedMessages(messages));
        persistActiveConversationId(memoryKey, activeConversationId);
        await onCreateAsc?.(action);
      } else {
        await onApplyCurrent?.(action);
      }
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
  }, [actionStates, activeConversationId, memoryKey, messages, onApplyCurrent, onCreateAsc]);

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  };

  const hasContent = messages.length > 0 || error;
  const modelChoice = preferences.provider === "anthropic"
    ? "anthropic"
    : preferences.provider === "gemini" ? preferences.geminiModel : preferences.localModel;
  const suggestions = useMemo(() => buildAssistantSuggestions({
    components,
    wires,
    netLabels,
    probes,
    directives,
    params,
    analysis,
    opResult,
    acResult,
    dcResult,
    fourier,
    componentRows,
    measurements,
    selectedId,
  }), [components, wires, netLabels, probes, directives, params, analysis, opResult, acResult, dcResult, fourier, componentRows, measurements, selectedId]);
  const changeModel = (value: string) => {
    if (value === "anthropic") {
      saveAssistantPreferences({ ...preferences, provider: "anthropic" });
      return;
    }
    if (value in GEMINI_MODEL_PRESETS) {
      saveAssistantPreferences({ ...preferences, provider: "gemini", geminiModel: value });
      return;
    }
    if (localAiPresets.some((preset) => preset.id === value)) {
      saveAssistantPreferences({ ...preferences, provider: "local-mlx", localModel: value });
    }
  };
  const needsCloudKey = (preferences.provider === "anthropic" && !apiKey)
    || (preferences.provider === "gemini" && !geminiKey);
  const needsCloudConsent = (preferences.provider === "anthropic" || preferences.provider === "gemini")
    && !cloudConsent.consented;
  const missingKeyProvider = preferences.provider === "gemini" ? "Gemini" : "Anthropic";
  const cloudBlocked = needsCloudKey || needsCloudConsent;

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
        <div className="assistant-title-row">
          <span className="assistant-title">Ask <span className="empty-brand">Bode</span>…</span>
          <div className="assistant-header-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={startNewChat}
                  aria-label="New chat"
                >
                  <MessageSquarePlus size={13} strokeWidth={1.8} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New chat</TooltipContent>
            </Tooltip>
            <div className="assistant-history-menu" ref={historyMenuRef}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setHistoryMenuOpen((open) => !open)}
                    aria-label="Past chats"
                    aria-haspopup="true"
                    aria-expanded={historyMenuOpen}
                  >
                    <History size={13} strokeWidth={1.8} aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Past chats</TooltipContent>
              </Tooltip>
              {historyMenuOpen && (
                <div className="assistant-history-popover" role="group" aria-label="Past chats">
                  {conversations.length === 0 ? (
                    <p className="assistant-history-empty">No past chats yet</p>
                  ) : (
                    <ul className="assistant-history-list">
                      {conversations.map((conversation) => (
                        <li key={conversation.id} className="assistant-history-row" data-active={conversation.id === activeConversationId}>
                          <button
                            type="button"
                            className="assistant-history-item"
                            onClick={() => switchConversation(conversation.id)}
                            aria-current={conversation.id === activeConversationId ? "true" : undefined}
                          >
                            <span className="assistant-history-item-title">{conversation.title}</span>
                            <span className="assistant-history-item-time">{relativeTime(conversation.updatedAt)}</span>
                          </button>
                          <button type="button" className="assistant-history-delete" onClick={() => deleteConversationById(conversation.id)} aria-label={`Delete "${conversation.title}"`}>
                            <Trash2 size={12} strokeWidth={1.8} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setHistoryMenuOpen(false);
                    deleteConversationById(activeConversationId);
                  }}
                  disabled={!hasContent}
                  aria-label="Delete current chat"
                >
                  <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete current chat</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" size="icon-sm" className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close assistant">
                  <X size={14} strokeWidth={1.8} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close assistant</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="assistant-toolbar">
          <Select value={modelChoice} onValueChange={changeModel} disabled={streaming}>
            <SelectTrigger size="sm" className="assistant-model-select" aria-label="Assistant model"><SelectValue /></SelectTrigger>
            <SelectContent align="center">
              <SelectItem value="anthropic">{ASSISTANT_MODEL_LABEL} · Cloud</SelectItem>
              <SelectItem value="gemini-2.5-flash">{GEMINI_MODEL_PRESETS["gemini-2.5-flash"].label} · Cloud (free tier)</SelectItem>
              <SelectItem value="gemini-2.5-pro">{GEMINI_MODEL_PRESETS["gemini-2.5-pro"].label} · Cloud</SelectItem>
              <SelectItem value="qwen3-4b-4bit">{LOCAL_MLX_MODEL_PRESETS["qwen3-4b-4bit"].label} · Local</SelectItem>
              <SelectItem value="qwen3-1.7b-4bit">{LOCAL_MLX_MODEL_PRESETS["qwen3-1.7b-4bit"].label} · Local</SelectItem>
              {customLocalAiModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.label} · Imported</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </header>

      {cloudBlocked ? (
        <div className="assistant-body">
          <div className="panel-empty">
            <div className="panel-empty-glyph" aria-hidden="true" />
            <strong>{needsCloudConsent ? "Cloud consent needed" : "API key needed"}</strong>
            <span>
              {needsCloudConsent
                ? (cloudAiConsentRefusal() ?? "Open Settings, choose Cloud, and confirm you’re okay sending circuit questions to the cloud provider.")
                : `Add a${missingKeyProvider === "Anthropic" ? "n" : ""} ${missingKeyProvider} API key in Settings to ask questions about this circuit.`}
            </span>
            <Button size="sm" variant="outline" onClick={onOpenSettings}>Open Settings</Button>
          </div>
        </div>
      ) : (
        <>
          {showLocalAiSetup && localAiStatus && (
            <div className="assistant-setup-card" data-state={localAiStatus.state}>
              <div className="assistant-setup-head">
                <MessageSquarePlus size={14} strokeWidth={1.7} aria-hidden="true" />
                <div className="assistant-setup-copy">
                  <strong>{selectedLocalAiPreset.label}</strong>
                  <span>{selectedLocalAiPreset.downloadMb.toLocaleString("en-US")} MB</span>
                </div>
              </div>
              <p className="assistant-setup-detail" role="status">{localSetupDetail}</p>
              {showLocalAiStartButton && (
                <div className="assistant-setup-actions">
                  <Button
                    type="button"
                    size="sm"
                    disabled={localAiBusy}
                    onClick={() => void startLocalAiSetup()}
                  >
                    {localAiBusy ? "Working…" : "Turn on"}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && !error && (
              <div className="assistant-intro">
                <BodeMascot className="assistant-intro-mascot" aria-hidden="true" />
                <p>Ask about this circuit or describe one to create - I can see the schematic and latest simulation results.</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={message.id} className={cn("assistant-message", `assistant-message--${message.role}`)}>
                <div className="assistant-bubble">
                  {message.role === "assistant"
                    ? message.content ? renderMiniMarkdown(message.content) : null
                    : editingMessageId === message.id ? (
                      <div className="assistant-message-editor">
                        <textarea
                          className="assistant-textarea"
                          value={editDraft}
                          maxLength={ASSISTANT_PROMPT_CHAR_LIMIT}
                          rows={3}
                          autoFocus
                          aria-label="Edit message text"
                          onChange={(event) => setEditDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") cancelMessageEdit();
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              resendEditedMessage(message.id);
                            }
                          }}
                        />
                        <div className="assistant-message-editor-actions">
                          <Button type="button" size="sm" variant="ghost" onClick={cancelMessageEdit}>Cancel</Button>
                          <Button type="button" size="sm" disabled={!editDraft.trim()} onClick={() => resendEditedMessage(message.id)}>
                            Save & resend
                          </Button>
                        </div>
                      </div>
                    ) : <p>{message.content}</p>}
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
                      <span className="assistant-progress-orb" aria-hidden="true" />
                      <div className="assistant-progress-copy">
                        <strong>{preferences.provider === "local-mlx" ? "Planning on this Mac" : PROGRESS_LABELS[progressPhase]}</strong>
                        <span>{elapsedLabel(elapsedSeconds)}</span>
                      </div>
                    </div>
                  )}
                </div>
                {message.role === "user" && editingMessageId !== message.id && (
                  <button
                    type="button"
                    className="assistant-message-edit"
                    disabled={streaming}
                    onClick={() => beginMessageEdit(message)}
                    aria-label={`Edit message: ${message.content.slice(0, 60)}`}
                  >
                    <Pencil size={11} strokeWidth={1.8} aria-hidden="true" />
                    Edit
                  </button>
                )}
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
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                className="assistant-chip"
                disabled={streaming || !localAiCanSend}
                onClick={() => send(suggestion.prompt)}
              >
                {suggestion.label}
              </button>
            ))}
          </div>

          <div className="assistant-composer-shell">
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
                maxLength={ASSISTANT_PROMPT_CHAR_LIMIT}
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
                <Button type="submit" size="sm" disabled={!input.trim() || !localAiCanSend}>Send</Button>
              )}
            </form>
            <p className="assistant-disclaimer">Bode is an AI and can make mistakes.</p>
          </div>
        </>
      )}
    </aside>
  );
}

export default AssistantPanel;
