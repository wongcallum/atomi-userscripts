import type { MarkingContext } from "./extract";
import type { LoadedImage } from "./images";
import SYSTEM_PROMPT from "./system-prompt.md?raw";

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "marking",
    strict: true,
    schema: {
      type: "object",
      properties: {
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              criterion: { type: "string" },
              status: { type: "string", enum: ["met", "partial", "not_met"] },
              comment: { type: "string" },
            },
            required: ["criterion", "status", "comment"],
            additionalProperties: false,
          },
        },
        improvement: { type: ["string", "null"] },
        mark: { type: "integer" },
      },
      required: ["criteria", "improvement", "mark"],
      additionalProperties: false,
    },
  },
};

// Sent with the first follow-up rather than in the system prompt, so that the marking request is unchanged and stays
// cached. Some providers move a system message to the top, so it goes in the user message.
const FOLLOW_UP = `<instructions>
The student is now asking follow-up questions about your marking. Reply conversationally in Markdown (with $...$ maths), not JSON. Be helpful, but guide them rather than spoon-feed. You can't change the recorded mark, but if you now think it was wrong, you can say so.
</instructions>`;

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type Message = { role: "system" | "user"; content: string | Part[] } | { role: "assistant"; content: string };

export interface ChatRequest {
  model: string;
  messages: Message[];
  stream: true;
  response_format?: typeof RESPONSE_FORMAT;
  reasoning_effort?: string;
  cache_control?: { type: "ephemeral" };
}

export function buildRequest(ctx: MarkingContext, images: LoadedImage[], model: string, effort: string): ChatRequest {
  const text = [
    ctx.topic && `Topic: ${ctx.topic}`,
    `<question${ctx.max != null ? ` total_marks="${ctx.max}"` : ""}>\n${ctx.question}\n</question>`,
    `<marking_guidelines>\n${ctx.guidelines}\n</marking_guidelines>`,
    ctx.latex &&
      ctx.answer &&
      "The student typed their answer in a maths editor, so it is LaTeX, and words may be written in maths mode. Read it as the student intended, ignoring the formatting.",
    `<student_answer>\n${ctx.answer || "(blank)"}\n</student_answer>`,
    images.length > 0 && "The images referred to as [Image N] are attached below.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const content: string | Part[] = images.length
    ? [
        { type: "text", text },
        ...images.flatMap((img): Part[] => [
          { type: "text", text: `[Image ${img.n}]` },
          { type: "image_url", image_url: { url: img.url } },
        ]),
      ]
    : text;
  const request: ChatRequest = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      { role: "user", content },
    ],
    stream: true,
    response_format: RESPONSE_FORMAT,
  };
  if (effort) request.reasoning_effort = effort;
  // Other providers cache by themselves, and this would switch them to caching that's billed
  if (model.startsWith("anthropic/")) request.cache_control = { type: "ephemeral" };
  return request;
}

// The marking request, exactly as sent, then the conversation since. Changing anything already sent would miss the
// provider's prompt cache.
export function buildFollowUp(
  marking: ChatRequest,
  reply: string,
  turns: { question: string; reply: string }[],
  question: string,
): ChatRequest {
  const { response_format: _, ...request } = marking;
  const questions = [...turns.map((t) => t.question), question];
  return {
    ...request,
    messages: [
      ...marking.messages,
      { role: "assistant", content: reply },
      ...questions.flatMap((q, i): Message[] => [
        {
          role: "user",
          content:
            i === 0
              ? [
                  { type: "text", text: FOLLOW_UP },
                  { type: "text", text: q },
                ]
              : q,
        },
        ...(i < turns.length ? [{ role: "assistant", content: turns[i].reply } as const] : []),
      ]),
    ],
  };
}
