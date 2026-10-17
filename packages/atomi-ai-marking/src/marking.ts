import { signal } from "@preact/signals";
import { parse } from "partial-json";
import { ApiError, type ChatStream, chatUrl, streamChat, type Usage } from "./api";
import { collectContext } from "./extract";
import { loadImages, loadPdfs } from "./images";
import { selectMark } from "./page";
import { buildFollowUp, buildRequest, type ChatRequest } from "./prompt";
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

type Phase = "working" | "done" | "stopped" | "error";

export interface Turn {
  question: string;
  /** the reply so far */
  reply: string;
  phase: Phase;
  error: string | null;
  usage: Usage | null;
}

export interface MarkingState {
  /** the guidelines link of the question being marked, or null if none is */
  key: string | null;
  phase: Phase;
  /** the reply so far */
  text: string;
  model: string;
  max: number | null;
  error: string | null;
  usage: Usage | null;
  /** follow-up questions, all done but the last */
  chat: Turn[];
}

const IDLE: MarkingState = {
  key: null,
  phase: "done",
  text: "",
  model: "",
  max: null,
  error: null,
  usage: null,
  chat: [],
};
export const marking = signal<MarkingState>(IDLE);
/** the follow-up question being written */
export const draft = signal("");

// The finished marking's request and reply, which follow-ups resend exactly
let conversation: { url: string; apiKey: string; body: ChatRequest; reply: string } | null = null;

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
  conversation = null;
  marking.value = IDLE;
  draft.value = "";
}

const stopped = () => new DOMException("Stopped", "AbortError");

const logUsage = (u: Usage) =>
  console.info(`[Atomi AI marking] tokens: ${u.prompt} prompt (${u.cached} cached), ${u.completion} completion`);

export async function markAnswer(link: HTMLAnchorElement, settings: Settings) {
  stopMarking();
  const run: Run = { aborted: false, request: null };
  current = run;
  const update = (patch: Partial<MarkingState>) => {
    if (current === run) marking.value = { ...marking.value, ...patch };
  };
  conversation = null;
  update({ ...IDLE, key: link.href, phase: "working", model: settings.model });

  let received = ""; // everything streamed so far

  try {
    const ctx = collectContext(link);
    update({ max: ctx.max });
    const [images, pdfs] = await Promise.all([loadImages(ctx.images), loadPdfs(ctx.pdfs)]);
    if (run.aborted) throw stopped();
    let body = buildRequest(ctx, images, pdfs, settings.model, settings.effort);
    const url = chatUrl(settings.endpoint);
    const apiKey = settings.apiKey ?? "";

    for (;;) {
      console.debug("[Atomi AI marking] request", body);
      run.request = streamChat({
        url,
        apiKey,
        body,
        onDelta(delta) {
          received += delta;
          update({ text: received });
        },
        onUsage(usage) {
          logUsage(usage);
          update({ usage });
        },
      });
      try {
        await run.request.done;
        break;
      } catch (err) {
        // Some APIs reject structured outputs or PDFs. The prompt describes the JSON too, so try again without
        // structured outputs, then without the PDFs.
        if (received || run.aborted || !(err instanceof ApiError) || ![400, 422].includes(err.status)) throw err;
        if (body.response_format) {
          console.warn("[Atomi AI marking] Retrying without response_format:", err.message);
          delete body.response_format;
        } else if (pdfs.length) {
          console.warn("[Atomi AI marking] Retrying without PDFs:", err.message);
          pdfs.length = 0;
          body = buildRequest(ctx, images, pdfs, settings.model, settings.effort);
          delete body.response_format;
        } else {
          throw err;
        }
      }
    }
    if (run.aborted) throw stopped();
    if (current === run) conversation = { url, apiKey, body, reply: received };
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

export async function askFollowUp(text: string) {
  const sent = conversation;
  const question = text.trim();
  if (!sent || !question || current) return;
  const run: Run = { aborted: false, request: null };
  current = run;
  const update = (patch: Partial<Turn>) => {
    if (current !== run) return;
    const { chat } = marking.value;
    marking.value = { ...marking.value, chat: [...chat.slice(0, -1), { ...chat[chat.length - 1], ...patch }] };
  };
  // An earlier one that was stopped or failed isn't sent, and is replaced
  const turns = marking.value.chat.filter((t) => t.phase === "done");
  marking.value = {
    ...marking.value,
    chat: [...turns, { question, reply: "", phase: "working", error: null, usage: null }],
  };
  draft.value = "";

  let received = "";
  try {
    const body = buildFollowUp(sent.body, sent.reply, turns, question);
    console.debug("[Atomi AI marking] request", body);
    run.request = streamChat({
      url: sent.url,
      apiKey: sent.apiKey,
      body,
      onDelta(delta) {
        received += delta;
        update({ reply: received });
      },
      onUsage(usage) {
        logUsage(usage);
        update({ usage });
      },
    });
    await run.request.done;
    if (run.aborted) throw stopped();
    update({ phase: "done" });
  } catch (err) {
    if (current === run && !draft.value) draft.value = question;
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
