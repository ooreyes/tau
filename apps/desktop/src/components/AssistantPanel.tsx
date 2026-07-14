import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { nanoid } from "nanoid";
import { Check, FilePlus2, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NetLabel, SchematicComponent, SchematicWire } from "../schematic/types";
import type { ParamScope } from "../simulation/paramScope";
import type { AnalysisResult } from "../simulation/linearTransient";
import type { ComponentMeasurement } from "../simulation/measurementModel";
import type { MeasResult } from "../simulation/measure";
import { buildAssistantContext } from "../lib/assistantContext";
import type { AssistantCreateAscAction } from "../lib/assistantActions";
import {
  ASSISTANT_MODEL_LABEL,
  streamAssistantReply,
  useAssistantApiKey,
  type AssistantChatMessage,
  type AssistantError,
  type AssistantStreamHandle,
} from "../lib/assistant";
import { renderMiniMarkdown } from "../lib/miniMarkdown";
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
  actions?: AssistantCreateAscAction[];
}

type AssistantActionState = "idle" | "working" | "done";

export type AssistantCreateAscHandler = (action: AssistantCreateAscAction) => void | Promise<void>;
export type AssistantApplyDocumentHandler = (
  document: AssistantCreateAscAction["document"],
  action: AssistantCreateAscAction,
) => void | Promise<void>;

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
  /** In-memory fallback for hosts that do not own a project-folder file boundary. */
  onApplyDocument?: AssistantApplyDocumentHandler;
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
  onApplyDocument,
}: AssistantPanelProps) {
  const apiKey = useAssistantApiKey();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<AssistantError | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, AssistantActionState>>({});
  const streamRef = useRef<AssistantStreamHandle | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // A live stream must not outlive its panel — Stop's abort() is defensive
  // even without this, but an unmounted panel (assistant column closed
  // mid-reply) would otherwise keep calling setState on gone state.
  useEffect(() => () => streamRef.current?.abort(), []);

  const send = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text || streaming || !apiKey) return;
    setError(null);

    const userMessage: ChatMessage = { id: nanoid(), role: "user", content: text };
    const assistantMessage: ChatMessage = { id: nanoid(), role: "assistant", content: "" };
    const history: AssistantChatMessage[] = [...messages, userMessage].map(({ role, content }) => ({ role, content }));

    setMessages((list) => [...list, userMessage, assistantMessage]);
    setInput("");
    setStreaming(true);

    const { text: contextText } = buildAssistantContext({
      components,
      wires,
      netLabels,
      directives,
      params,
      analysis,
      componentRows,
      measurements,
      selectedId,
    });

    streamRef.current = streamAssistantReply(apiKey, contextText, history, {
      onDelta: (snapshot) => {
        setMessages((list) => list.map((m) => (m.id === assistantMessage.id ? { ...m, content: snapshot } : m)));
      },
      onDone: (reply) => {
        setMessages((list) => list.map((message) => (
          message.id === assistantMessage.id
            ? {
                ...message,
                content: reply.text || message.content,
                ...(reply.actions.length > 0 ? { actions: reply.actions } : {}),
              }
            : message
        )));
        if (reply.rejectedActionCount > 0) {
          setError({
            kind: "invalid_action",
            message: "I couldn't validate that circuit proposal. Ask me to revise it before creating a file.",
          });
        }
        setStreaming(false);
        streamRef.current = null;
      },
      onError: (err) => {
        setStreaming(false);
        streamRef.current = null;
        setError(err);
        // Drop the placeholder bubble if nothing ever streamed into it —
        // an empty assistant turn would otherwise sit in the transcript.
        setMessages((list) => list.filter((m) => m.id !== assistantMessage.id || m.content !== ""));
      },
    });
  }, [messages, streaming, apiKey, components, wires, netLabels, directives, params, analysis, componentRows, measurements, selectedId]);

  const stop = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setStreaming(false);
  }, []);

  const clearConversation = useCallback(() => {
    stop();
    setMessages([]);
    setActionStates({});
    setError(null);
  }, [stop]);

  const confirmAction = useCallback(async (action: AssistantCreateAscAction) => {
    if (actionStates[action.id] === "working" || actionStates[action.id] === "done") return;
    if (!onCreateAsc && !onApplyDocument) {
      setError({ kind: "invalid_action", message: "Circuit creation is not connected to the active project." });
      return;
    }
    setError(null);
    setActionStates((states) => ({ ...states, [action.id]: "working" }));
    try {
      if (onCreateAsc) await onCreateAsc(action);
      else await onApplyDocument?.(action.document, action);
      setActionStates((states) => ({ ...states, [action.id]: "done" }));
    } catch {
      setActionStates((states) => ({ ...states, [action.id]: "idle" }));
      setError({ kind: "unknown", message: `Couldn't create ${action.filename}. Check the active Schematics folder and try again.` });
    }
  }, [actionStates, onApplyDocument, onCreateAsc]);

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  };

  const selectedComponent = selectedId ? components.find((c) => c.id === selectedId) ?? null : null;
  const selectedRef = selectedComponent ? (selectedComponent.label || selectedComponent.id) : null;
  const hasContent = messages.length > 0 || error;

  return (
    <aside className="assistant-panel" aria-label="Assistant" style={{ "--assistant-w": `${resize.width}px` } as CSSProperties}>
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
      <header className="assistant-header">
        <div>
          <div className="assistant-kicker">Assistant</div>
          <div className="assistant-title-row">
            <span className="assistant-title">Ask Tau</span>
            <span className="assistant-model-badge">{ASSISTANT_MODEL_LABEL}</span>
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

      {!apiKey ? (
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
                    return (
                      <div className="assistant-action" key={action.id} data-status={status}>
                        <FilePlus2 size={17} strokeWidth={1.7} aria-hidden="true" />
                        <div className="assistant-action-copy">
                          <strong>{action.filename}</strong>
                          <span>{action.componentCount} components · {action.wireCount} wires</span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={status === "done" ? "outline" : "default"}
                          disabled={status !== "idle" || (!onCreateAsc && !onApplyDocument)}
                          onClick={() => void confirmAction(action)}
                          aria-label={`Create ${action.filename}`}
                        >
                          {status === "done" ? <Check size={12} aria-hidden="true" /> : null}
                          {status === "working" ? "Creating…" : status === "done" ? "Created" : "Create"}
                        </Button>
                      </div>
                    );
                  })}
                  {streaming && message.role === "assistant" && index === messages.length - 1 && (
                    <span className="assistant-caret" aria-hidden="true" />
                  )}
                </div>
              </div>
            ))}
            {error && (
              <div className="assistant-error" role="alert">
                <span>{error.message}</span>
                {error.kind === "auth" && (
                  <Button size="sm" variant="outline" onClick={onOpenSettings}>Open Settings</Button>
                )}
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
