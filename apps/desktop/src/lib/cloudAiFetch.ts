/**
 * Native cloud-AI HTTP seam. In the packaged/Tauri app, Anthropic and Gemini
 * requests leave the renderer without an Authorization / x-api-key header; Rust
 * reads the OS keychain and attaches the credential on an allowlisted HTTPS
 * call. The raw key never hydrates into renderer module state for API use.
 *
 * Vitest / `pnpm dev:web` keep a process-local key (no keychain) so unit tests
 * and the browser preview can still exercise providers with injected fetch.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export type CloudAiProvider = "anthropic" | "gemini";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface CloudAiProxyResponse {
  status: number;
  body: string;
  headers: Array<[string, string]>;
}

async function bodyText(body: BodyInit | null | undefined): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === "string") return body;
  return new Response(body).text();
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestHeaders(init?: RequestInit): Array<[string, string]> {
  const headers: Array<[string, string]> = [];
  if (!init?.headers) return headers;
  const raw = new Headers(init.headers);
  raw.forEach((value, name) => {
    const lower = name.toLowerCase();
    // Never send secrets over IPC — Rust attaches the keychain credential.
    if (lower === "authorization" || lower === "x-api-key" || lower === "cookie") return;
    headers.push([name, value]);
  });
  return headers;
}

/** Fetch implementation that proxies through Tauri `cloud_ai_proxy`. */
export function createCloudAiFetch(provider: CloudAiProvider): FetchLike {
  return async (input, init) => {
    if (!isTauri()) {
      throw new Error("Native cloud AI proxy is only available in the Tau desktop app.");
    }
    const result = await invoke<CloudAiProxyResponse>("cloud_ai_proxy", {
      request: {
        provider,
        url: requestUrl(input),
        method: init?.method ?? "GET",
        body: await bodyText(init?.body ?? null),
        headers: requestHeaders(init),
      },
    });
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  };
}

export function isNativeCloudAiProxy(): boolean {
  return isTauri();
}
