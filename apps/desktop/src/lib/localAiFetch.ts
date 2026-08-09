/**
 * On-device AI HTTP seam. The MLX provider talks directly to a loopback
 * server (see localMlxAssistant.ts) rather than going through the native
 * cloud proxy, so nothing else records that traffic for the Usage page.
 *
 * This mirrors the "one chokepoint" pattern in cloudAiFetch.ts: wrap the
 * fetch the assistant is given so every on-device round-trip is counted
 * without the provider module having to remember to report it.
 */
import { recordAiRequest, tokensFromResponseBody } from "./aiUsage";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Fetch implementation that counts on-device requests for the Usage page. */
export function createLocalAiFetch(base: FetchLike = globalThis.fetch.bind(globalThis)): FetchLike {
  return async (input, init) => {
    const response = await base(input, init);
    // Recorded regardless of HTTP status - a 500 is still a request Tau sent.
    // Only a thrown fetch (network failure, abort) skips this entirely.
    let tokens: { input?: number; output?: number } = {};
    try {
      const body = await response.clone().text();
      tokens = tokensFromResponseBody(body);
    } catch {
      // Some test stubs / exotic Response-likes do not implement clone().
      // Still record the request, just without token counts.
    }
    recordAiRequest("local-mlx", tokens);
    return response;
  };
}
