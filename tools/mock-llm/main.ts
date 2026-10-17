// A mock LLM API for testing userscripts on the real site, using aimock (https://github.com/CopilotKit/llmock).
// Set the userscript's API endpoint to http://127.0.0.1:4010/api/v1, where it behaves like OpenRouter.
//
//   pnpm mock-llm                      # start the server, with the "json" scenario
//   pnpm mock-llm:scenario slow        # change how it responds (no argument lists the scenarios)
//   pnpm mock-llm:last [name]          # save the latest request to .mock-llm/<name>.txt, .json and images
//
// Append ":<mark>" to a scenario to set the mark it awards, e.g. "json:0". The default is 2.
// Follow-up questions get a Markdown reply, streamed the same way (or the same error).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { join } from "node:path";
import { type FixtureFileEntry, LLMock } from "@copilotkit/aimock";

const PORT = Number(process.env.MOCK_LLM_PORT) || 4010;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = join(import.meta.dirname, "../../.mock-llm");
const REQUESTS_DIR = join(OUT_DIR, "requests");

function markingJson(mark: number): string {
  const data = {
    criteria: [
      {
        criterion: "States the relationship",
        status: "met",
        comment: "Correctly gives $v = u + at$ and identifies **each variable**.",
      },
      {
        criterion: "Applies it to the data (2–3 marks)",
        status: "partial",
        comment: 'Substitutes into $a = \\frac{\\Delta v}{\\Delta t}$ but drops the units: "a = 4".',
      },
      {
        criterion: "Uses correct terminology",
        status: "not_met",
        comment: 'Says "speed" where *velocity* is needed.',
      },
    ],
    improvement: "Give units with the final answer, e.g. $4\\,\\text{m s}^{-2}$, and say *velocity* rather than speed.",
    mark,
  };
  return JSON.stringify(data, null, 2);
}

const markingMarkdown = (mark: number) =>
  [
    "**States the relationship**: met. Correctly gives $v = u + at$.",
    "**Applies it to the data**: partly met. Substitutes into $$a = \\frac{\\Delta v}{\\Delta t}$$ but drops the units.",
    "- Give units, e.g. $4\\,\\text{m s}^{-2}$\n- Say *velocity* rather than speed",
    `**Mark: ${mark}/4**`,
  ].join("\n\n");

const FOLLOW_UP_REPLY = [
  "Good question. Acceleration is the *rate of change* of velocity:",
  "$$a = \\frac{v - u}{t}$$",
  "So its units are velocity divided by time. What do you get if you divide $\\text{m s}^{-1}$ by $\\text{s}$?",
  "- Your working was right\n- Only the units were missing",
].join("\n\n");

const STREAM = { chunkSize: 12, latency: 25, openRouterProcessing: true };

const SCENARIOS: Record<string, [description: string, fixtures: (mark: number) => FixtureFileEntry[]]> = {
  json: [
    "Marking JSON, streamed in chunks (default)",
    (mark) => [{ match: {}, response: { content: markingJson(mark) }, ...STREAM }],
  ],
  burst: [
    "Marking JSON in a single chunk",
    (mark) => [{ match: {}, response: { content: markingJson(mark) }, chunkSize: 1e6 }],
  ],
  slow: [
    "Marking JSON after 3 s, a few characters at a time (for testing Stop)",
    (mark) => [
      { match: {}, response: { content: markingJson(mark) }, chunkSize: 4, streamingProfile: { ttft: 3000, tps: 15 } },
    ],
  ],
  markdown: [
    'Markdown instead of JSON, ending "Mark: n/4"',
    (mark) => [{ match: {}, response: { content: markingMarkdown(mark) }, ...STREAM }],
  ],
  "reject-format": [
    "HTTP 400 if response_format is sent, otherwise like json",
    (mark) => [
      {
        match: { responseFormat: "json_schema" },
        response: {
          error: { message: "response_format is not supported by this model", type: "invalid_request_error" },
          status: 400,
        },
      },
      { match: {}, response: { content: markingJson(mark) }, ...STREAM },
    ],
  ],
  "bad-request": [
    "HTTP 400 for every request, so it retries without response_format, then without PDFs",
    () => [
      {
        match: {},
        response: { error: { message: "Invalid request", type: "invalid_request_error" }, status: 400 },
      },
    ],
  ],
  "cut-off": [
    "Drops the connection partway through the JSON",
    (mark) => [{ match: {}, response: { content: markingJson(mark) }, ...STREAM, truncateAfterChunks: 20 }],
  ],
  error: [
    "HTTP 401 with an OpenAI-style error",
    () => [
      { match: {}, response: { error: { message: "Invalid API key", type: "authentication_error" }, status: 401 } },
    ],
  ],
  empty: [
    "A stream with no content",
    (mark) => [{ match: {}, response: { content: markingJson(mark) }, ...STREAM, misbehavior: "empty-response" }],
  ],
};

function fixtures(spec: string): FixtureFileEntry[] {
  const [name, markArg = "2"] = spec.split(":");
  const mark = Number(markArg);
  if (!Object.hasOwn(SCENARIOS, name)) throw new Error(`Unknown scenario "${name}"`);
  if (!Number.isInteger(mark)) throw new Error(`Invalid mark "${markArg}"`);
  const entries = SCENARIOS[name][1](mark);
  // Requests with an assistant message, i.e. follow-ups, behave like the scenario's catch-all
  const { response, ...rest } = entries[entries.length - 1];
  const followUp: FixtureFileEntry = {
    ...rest,
    match: { turnIndex: 1 },
    response:
      "content" in response
        ? {
            content: FOLLOW_UP_REPLY,
            usage: { prompt_tokens: 1840, completion_tokens: 96, prompt_tokens_details: { cached_tokens: 1536 } },
          }
        : response,
  };
  return [followUp, ...entries];
}

async function control(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

async function serve() {
  const mock = new LLMock({ port: 0, host: "127.0.0.1", logLevel: "info", enableMisbehavior: true });
  mock.addFixturesFromJSON(fixtures("json"));
  const upstream = new URL(await mock.start());
  mkdirSync(REQUESTS_DIR, { recursive: true });
  let count = Math.max(
    0,
    ...readdirSync(REQUESTS_DIR)
      .map((f) => parseInt(f, 10))
      .filter(Number.isFinite),
  );

  // aimock's journal truncates bodies over 64 KB, i.e. any request with an image, and doesn't record clients hanging
  // up partway (e.g. the userscript's Stop button). So this proxy in front of it saves chat requests and logs those.
  createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      const id = String(++count).padStart(4, "0");
      writeFileSync(
        join(REQUESTS_DIR, `${id}.json`),
        JSON.stringify({ auth: Boolean(req.headers.authorization), body: body.toString() }),
      );
    }
    let dropped = false;
    const proxied = request(upstream, { method: req.method, path: req.url, headers: req.headers }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      // pipe() doesn't pass on aimock dropping the connection (e.g. the "cut-off" scenario), so do it here
      upstreamRes.on("close", () => {
        if (upstreamRes.complete) return;
        dropped = true;
        res.destroy();
      });
    });
    proxied.on("error", (err) => {
      if (dropped) return;
      if (!res.headersSent) res.writeHead(502);
      res.end(String(err));
    });
    res.on("close", () => {
      if (res.writableFinished || dropped) return;
      console.log(`Connection closed before the response finished: ${req.method} ${req.url}`);
      proxied.destroy();
    });
    proxied.end(body);
  }).listen(PORT, "127.0.0.1", () => console.log(`Mock LLM at ${BASE}/api/v1, scenario: json`));
}

async function scenario(spec?: string) {
  if (!spec) {
    for (const [name, [description]] of Object.entries(SCENARIOS)) console.log(`${name.padEnd(14)} ${description}`);
    return;
  }
  const entries = fixtures(spec);
  await control("DELETE", "/__aimock/fixtures");
  await control("POST", "/__aimock/fixtures", { fixtures: entries });
  console.log(`scenario: ${spec}`);
}

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };
type Message = { role: string; content: string | Part[] | null };
type ChatRequest = { model?: string; messages?: Message[]; response_format?: unknown; reasoning_effort?: string };

// Writes <name>.txt (readable prompt), <name>.json (request body), and <name>-image-K.<ext> and <name>-pdf-K.pdf
// (attachments)
async function last(name = "last") {
  const latest = readdirSync(REQUESTS_DIR)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort()
    .at(-1);
  if (!latest) throw new Error("No chat completion requests yet");
  const saved = JSON.parse(readFileSync(join(REQUESTS_DIR, latest), "utf8")) as { auth: boolean; body: string };
  const body = JSON.parse(saved.body) as ChatRequest;

  for (const file of readdirSync(OUT_DIR))
    if (file.startsWith(`${name}-image-`) || file.startsWith(`${name}-pdf-`)) rmSync(join(OUT_DIR, file));
  const lines = [
    `request: requests/${latest}  model: ${body.model}  response_format: ${body.response_format ? "yes" : "no"}  ` +
      `reasoning_effort: ${body.reasoning_effort ?? "-"}  auth: ${saved.auth ? "yes" : "no"}`,
  ];
  let images = 0;
  let pdfs = 0;
  for (const message of body.messages ?? []) {
    lines.push("", `=== ${message.role}`);
    for (const part of typeof message.content === "string"
      ? [{ type: "text", text: message.content } as const]
      : (message.content ?? [])) {
      if (part.type === "text") {
        lines.push(part.text);
      } else if (part.type === "image_url") {
        const m = /^data:image\/(\w+);base64,(.*)$/s.exec(part.image_url.url);
        if (m) {
          const file = `${name}-image-${++images}.${m[1]}`;
          writeFileSync(join(OUT_DIR, file), Buffer.from(m[2], "base64"));
          part.image_url.url = file; // keeps the saved JSON readable
        }
        lines.push(`<image: ${part.image_url.url}>`);
      } else if (part.type === "file") {
        const m = /^data:application\/pdf;base64,(.*)$/s.exec(part.file.file_data);
        if (m) {
          const file = `${name}-pdf-${++pdfs}.pdf`;
          writeFileSync(join(OUT_DIR, file), Buffer.from(m[1], "base64"));
          part.file.file_data = file;
        }
        lines.push(`<file: ${part.file.filename} (${part.file.file_data})>`);
      }
    }
  }
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(body, null, 2));
  writeFileSync(join(OUT_DIR, `${name}.txt`), `${lines.join("\n")}\n`);
  const attached = [
    images && `${images} image${images === 1 ? "" : "s"}`,
    pdfs && `${pdfs} PDF${pdfs === 1 ? "" : "s"}`,
  ];
  console.log(
    `Saved .mock-llm/${name}.txt${attached
      .filter(Boolean)
      .map((a) => ` and ${a}`)
      .join("")}`,
  );
}

const [command, arg] = process.argv.slice(2);
const commands: Record<string, (arg?: string) => Promise<void>> = { serve, scenario, last };
if (!Object.hasOwn(commands, command)) {
  console.error("Usage: main.ts serve | scenario [name[:mark]] | last [name]");
  process.exit(1);
}
try {
  await commands[command](arg);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
