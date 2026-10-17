import { createParser } from "eventsource-parser";
import { GM_xmlhttpRequest } from "$";
import type { ChatRequest } from "./prompt";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export function chatUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, "");
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

function errorMessage(raw: string, status: number): string {
  const body = raw.trim();
  try {
    const json = JSON.parse(body);
    const err = json.error ?? json;
    const message = typeof err === "string" ? err : err.message || err.detail;
    if (message) return status ? `${message} (HTTP ${status})` : message;
  } catch {
    // not JSON
  }
  if (status && (status < 200 || status >= 300))
    return `Request failed with HTTP ${status}${body ? `: ${body.slice(0, 300)}` : ""}`;
  return body ? body.slice(0, 300) : "The model returned an empty response.";
}

export interface Usage {
  prompt: number;
  cached: number;
  completion: number;
}

export interface ChatStream {
  /** the reply's text, once it has all arrived */
  done: Promise<string>;
  abort(): void;
}

// Streams a chat completion as server-sent events, calling onDelta with each piece of the reply's text
export function streamChat({
  url,
  apiKey,
  body,
  onDelta,
  onUsage,
}: {
  url: string;
  apiKey: string;
  body: ChatRequest;
  onDelta: (delta: string) => void;
  onUsage: (usage: Usage) => void;
}): ChatStream {
  const { promise: done, resolve, reject } = Promise.withResolvers<string>();
  let raw = ""; // the body so far
  let sse = false; // the body is SSE, rather than e.g. a JSON error
  let text = "";
  let status = 0;
  let ended = false; // saw [DONE]
  let settled = false;
  let request: { abort(): void } | undefined; // unset if the request fails at once, e.g. Violentmonkey with a bad URL

  const parser = createParser({
    onEvent({ data }) {
      sse = true;
      if (data === "[DONE]") ended = true;
      if (ended) return;
      let chunk: {
        error?: { message?: string };
        choices?: { delta?: { content?: string } }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      if (chunk.error) throw new ApiError(chunk.error.message || JSON.stringify(chunk.error), status);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      // In the last chunk
      const { usage } = chunk;
      if (usage)
        onUsage({
          prompt: usage.prompt_tokens ?? 0,
          cached: usage.prompt_tokens_details?.cached_tokens ?? 0,
          completion: usage.completion_tokens ?? 0,
        });
    },
    onComment: () => (sse = true),
  });

  const finish = (error?: unknown) => {
    if (settled) return;
    settled = true;
    if (!error && !text) error = new ApiError(errorMessage(sse ? "" : raw, status), status);
    if (error) {
      request?.abort();
      reject(error);
    } else {
      resolve(text);
    }
  };

  // responseText is the whole body so far, so feed in what's new since last time
  const read = (r: { status: number; responseText: string }, last = false) => {
    if (settled) return;
    status = r.status || status;
    try {
      const body = typeof r.responseText === "string" ? r.responseText : "";
      if (body.length > raw.length) {
        parser.feed(body.slice(raw.length));
        raw = body;
      }
      if (last) parser.feed("\n\n"); // in case the body didn't end with a blank line
      if (ended || last) finish();
    } catch (err) {
      finish(err);
    }
  };

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  request = GM_xmlhttpRequest({
    method: "POST",
    url,
    headers,
    data: JSON.stringify(body),
    // No responseType: Violentmonkey has no 'stream', and with 'stream' or 'text' its responseText in progress events
    // is only the latest part of the body (as of Violentmonkey 2.49). Without one it's the whole body so far.
    onprogress: read,
    onload: (r) => read(r, true),
    onerror: (r) =>
      finish(
        new ApiError(
          raw
            ? "The connection closed before the reply finished."
            : `Network error${r.error ? `: ${r.error}` : ""}. Check the API endpoint.`,
        ),
      ),
    ontimeout: () => finish(new ApiError("The request timed out.")),
  });

  return {
    done,
    abort: () => finish(new DOMException("Stopped", "AbortError")),
  };
}
