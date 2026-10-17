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

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatRequest {
  model: string;
  messages: { role: "system" | "user"; content: string | Part[] }[];
  stream: true;
  response_format?: typeof RESPONSE_FORMAT;
  reasoning_effort?: string;
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
  return request;
}
