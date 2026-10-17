import { renderInline, renderMarkdown } from "../markdown";
import { type Criterion, marking, readReply, replyMark } from "../marking";
import { openSettings } from "./SettingsDialog";

const Icon = ({ d }: { d?: string }) => (
  <svg
    viewBox="0 0 20 20"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {d && <path d={d} />}
  </svg>
);

const STATUSES: Record<string, { label: string; icon: string }> = {
  met: { label: "Met", icon: "M6 10.4l2.7 2.7L14.2 7.3" },
  partial: { label: "Partly met", icon: "M6.5 10h7" },
  not_met: { label: "Not met", icon: "M7 7l6 6M13 7l-6 6" },
};

// The score's colour, as a CSS colour, and title
function verdict(mark: number, max: number | null): [tone: string, title: string] {
  if (max == null) return ["var(--accent)", "AI mark"];
  if (mark >= max) return ["var(--good)", "Full marks"];
  if (mark >= max / 2) return ["var(--warn)", "Nearly there"];
  return ["var(--bad)", mark > 0 ? "Keep going" : "Not yet"];
}

function CriterionRow({ criterion: c, done }: { criterion: Criterion; done: boolean }) {
  // The status comes before the comment, so it's complete once the comment has started
  const status = done || c.comment !== undefined ? c.status : undefined;
  const known = status !== undefined && Object.hasOwn(STATUSES, status) ? STATUSES[status] : null;
  return (
    <div class="criterion">
      <span class={`status ${known ? status : ""} ${known || done ? "" : "pending"}`} title={known?.label}>
        <Icon d={known?.icon} />
      </span>
      <div>
        {c.criterion && <b>{String(c.criterion)}: </b>}
        {typeof c.comment === "string" && (
          <span class="html" dangerouslySetInnerHTML={{ __html: renderInline(c.comment) }} />
        )}
      </div>
    </div>
  );
}

function Score({ mark, max, criteria }: { mark: number; max: number | null; criteria: Criterion[] }) {
  const [tone, title] = verdict(mark, max);
  const met = criteria.filter((c) => c.status === "met").length;
  const partial = criteria.filter((c) => c.status === "partial").length;
  const summary = criteria.length
    ? `${met} of ${criteria.length} ${criteria.length === 1 ? "criterion" : "criteria"} met${partial ? ` · ${partial} partly met` : ""}`
    : "";
  const percent = max ? Math.min(100, Math.max(0, (100 * mark) / max)) : 100;
  return (
    <div class="score">
      <div class="ring" style={{ "--p": percent, "--tone": tone }}>
        {mark}
        {max != null && `/${max}`}
      </div>
      <div>
        <h3>{title}</h3>
        {summary && <p>{summary}</p>}
      </div>
    </div>
  );
}

export function Panel() {
  const state = marking.value;
  if (!state.key) return null;
  const done = state.phase !== "working";
  const reply = readReply(state.text);
  // Once it's over, leave out a criterion that was cut off before any of it arrived
  const criteria =
    reply && "json" in reply && Array.isArray(reply.json.criteria)
      ? reply.json.criteria.filter((c) => c && typeof c === "object" && (!done || c.criterion || c.comment))
      : [];
  const improvement =
    reply && "json" in reply && typeof reply.json.improvement === "string" ? reply.json.improvement.trim() : "";
  const mark = state.phase === "done" ? replyMark(reply) : null;

  return (
    <div class="panel">
      <div class="panel-head">
        AI marking
        <span class="model" title={state.model}>
          {state.model.split("/").pop()}
        </span>
        <button type="button" onClick={() => openSettings()}>
          Settings
        </button>
      </div>
      <div class="panel-body">
        {criteria.map((c, i) => (
          <CriterionRow key={i} criterion={c} done={done} />
        ))}
        {improvement && (
          <div class="improvement">
            <b>To improve:</b> <span class="html" dangerouslySetInnerHTML={{ __html: renderInline(improvement) }} />
          </div>
        )}
        {reply && "markdown" in reply && (
          <div class="html markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(reply.markdown) }} />
        )}
        {!reply && state.phase === "working" && <p class="shimmer">Marking your answer...</p>}
        {!reply && state.phase === "done" && <p class="note error">The model's response couldn't be read.</p>}
        {state.phase === "stopped" && <p class="note muted">Stopped.</p>}
        {state.phase === "error" && <p class="note error">{state.error}</p>}
      </div>
      {mark !== null && <Score mark={mark} max={state.max} criteria={criteria} />}
    </div>
  );
}
