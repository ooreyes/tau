import type { AssistantAscAction } from "./assistantActions";
import type { AssistantOperationContext } from "./assistantOperations";

/** Provider-neutral conversation input. Tool payloads deliberately never enter history. */
export interface AssistantProviderMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantProviderRequest {
  /** Fresh Tau-owned circuit/netlist/simulation context for this turn. */
  contextText: string;
  /** Visible prose history only, including the newest user turn. */
  history: readonly AssistantProviderMessage[];
  /** Omit current-document replacement when Tau could not serialize it losslessly. */
  allowCurrentApply?: boolean;
  /** Snapshot a provider may query via read-only inspection operations. Omit
   *  when no simulation snapshot is available for this turn. */
  operationContext?: AssistantOperationContext;
}

export interface AssistantProviderReply {
  /** User-visible prose only. Tool arguments and ASC payloads are excluded. */
  text: string;
  /** Strictly validated proposals. Callers must still ask the user to confirm. */
  actions: AssistantAscAction[];
  /** Count only; validation details and raw tool arguments stay private. */
  rejectedActionCount: number;
  /** Optional provider-reported footprint for a completed turn. Kept out of
   *  persisted chat history; the UI uses it as a compact speed/cost receipt. */
  metrics?: AssistantRunMetrics;
}

export interface AssistantRunMetrics {
  durationMs: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export type AssistantProviderErrorKind = "aborted" | "offline" | "server" | "invalid_response" | "unknown";

export class AssistantProviderError extends Error {
  readonly kind: AssistantProviderErrorKind;
  readonly cause?: unknown;

  constructor(kind: AssistantProviderErrorKind, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AssistantProviderError";
    this.kind = kind;
    this.cause = options?.cause;
  }
}

/** A provider may execute read-only inspection operations against `operationContext`
 *  and return pending proposals, but owns no Tau mutation callbacks. */
export interface AssistantProvider {
  readonly id: string;
  complete(request: AssistantProviderRequest, signal?: AbortSignal): Promise<AssistantProviderReply>;
}
