import { signal } from "@preact/signals";
import { parse } from "partial-json";
import { ApiError, type ChatStream, chatUrl, streamChat } from "./api";
import { collectContext } from "./extract";
import { loadImages } from "./images";
import { selectMark } from "./page";
import { buildRequest } from "./prompt";
import type { Settings } from "./settings";

export interface Criterion {
  criterion?: string;
  status?: string;
  comment?: string;
}

export interface MarkingJson {
  criteria?: Criterion[];
  improvement?: string | null;
  mark?: number;
}

/** The reply as asked for, or Markdown from a model that ignored the response format */
export type Reply = { json: MarkingJson } | { markdown: string } | null;

export function readReply(text: string): Reply {
  if (/^\s*(\{|```)/.test(text)) {
    const start = text.indexOf("{");
    if (start === -1) return null;
    // Models without structured outputs sometimes leave LaTeX unescaped, e.g. "\leq", which would drop the whole
    // string, so escape any backslash that doesn't start a valid JSON escape.
    const json = text
      .slice(start)
      .replace(/\\(.?)/gs, (m, c: string) => (!c || '"\\/bfnrtu'.includes(c) ? m : `\\${m}`));
    let data: unknown;
    try {
      data = parse(json);
    } catch {
      return null;
    }
    return data && typeof data === "object" && !Array.isArray(data) ? { json: data } : null;
  }
  return text ? { markdown: text } : null;
}

// e.g. "Mark: 3/4" or "marks 3 out of 4" in a Markdown reply
function parseMark(text: string): number | null {
  const matches = [...text.matchAll(/\bmarks?\W{0,4}(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*\d+/gi)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

export function replyMark(reply: Reply): number | null {
  if (!reply) return null;
  const mark = "json" in reply ? reply.json.mark : parseMark(reply.markdown);
  return typeof mark === "number" && Number.isFinite(mark) ? Math.round(mark) : null;
}

export interface MarkingState {
  /** the guidelines link of the question being marked, or null if none is */
  key: string | null;
  phase: "working" | "done" | "stopped" | "error";
  /** the reply so far */
  text: string;
  model: string;
  max: number | null;
  error: string | null;
}

const IDLE: MarkingState = { key: null, phase: "done", text: "", model: "", max: null, error: null };
export const marking = signal<MarkingState>(IDLE);

interface Run {
  aborted: boolean;
  request: ChatStream | null;
}
let current: Run | null = null;

export function stopMarking() {
  if (!current) return;
  current.aborted = true;
  current.request?.abort();
}

export function resetMarking() {
  stopMarking();
  current = null;
  marking.value = IDLE;
}

export async function markAnswer(link: HTMLAnchorElement, settings: Settings) {
  stopMarking();
  const run: Run = { aborted: false, request: null };
  current = run;
  const update = (patch: Partial<MarkingState>) => {
    if (current === run) marking.value = { ...marking.value, ...patch };
  };
  update({ key: link.href, phase: "working", text: "", model: settings.model, max: null, error: null });

  let received = ""; // everything streamed so far
  const stopped = () => new DOMException("Stopped", "AbortError");

  try {
    const ctx = collectContext(link);
    update({ max: ctx.max });
    const images = await loadImages(ctx.images);
    if (run.aborted) throw stopped();
    const body = buildRequest(ctx, images, settings.model, settings.effort);

    for (;;) {
      console.debug("[Atomi AI marking] request", body);
      run.request = streamChat({
        url: chatUrl(settings.endpoint),
        apiKey: settings.apiKey ?? "",
        body,
        onDelta(delta) {
          received += delta;
          update({ text: received });
        },
      });
      try {
        await run.request.done;
        break;
      } catch (err) {
        // Some APIs reject structured outputs. The prompt describes the JSON too, so try again without it.
        if (
          !body.response_format ||
          received ||
          run.aborted ||
          !(err instanceof ApiError) ||
          ![400, 422].includes(err.status)
        )
          throw err;
        console.warn("[Atomi AI marking] Retrying without response_format:", err.message);
        delete body.response_format;
      }
    }
    if (run.aborted) throw stopped();
    update({ phase: "done" });

    const mark = replyMark(readReply(received));
    if (mark !== null && current === run) await selectMark(mark);
  } catch (err) {
    if (run.aborted) {
      update({ phase: "stopped" });
    } else {
      console.error("[Atomi AI marking]", err);
      update({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    if (current === run) current = null;
  }
}
