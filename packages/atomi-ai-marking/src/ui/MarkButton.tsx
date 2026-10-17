import { marking } from "../marking";

export function MarkButton({ onMark, onStop }: { onMark: () => void; onStop: () => void }) {
  const working = marking.value.phase === "working";
  return (
    <button
      type="button"
      class="mark"
      title={working ? "Stop AI marking" : "Mark your answer with AI"}
      onClick={working ? onStop : onMark}
    >
      {working ? "Stop" : "Mark with AI"}
    </button>
  );
}
