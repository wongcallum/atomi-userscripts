import { tinykeys } from "tinykeys";
import css from "./style.css?inline";

type Action = RegExp | ((event: KeyboardEvent) => boolean);

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

// Atomi's class names are generated and change between builds, so buttons are found by their text or aria-label.
// Actions that return false let the key through to the page.
const SHORTCUTS: [keys: string, shown: string, description: string, action: Action, whileTyping?: boolean][] = [
  ["$mod+Enter", `${MOD}+Enter`, "Check answer, or Next once checked", checkOrNext, true],
  ["ArrowRight", "→", "Next", /^(next|continue|done|finish)/i],
  ["ArrowLeft", "←", "Back", /^(back|previous)/i],
  ["s", "s", "Skip question", /^skip$/i],
  ["f", "f", "Focus answer box", focusAnswer],
  ["d", "d", "Toggle Draw", () => toggleSheet("Draw", /^draw$/i)],
  ["y", "y", "Toggle Symbols", () => toggleSheet("Formula Keyboard", /^symbols$/i)],
  ["[Shift]+([1-9])", "1–9", "Pick multiple choice option", (event) => pickOption(Number(event.key))],
  ["ArrowUp", "↑", "Previous option (once an option is focused)", () => moveOption(-1)],
  ["ArrowDown", "↓", "Next option (once an option is focused)", () => moveOption(1)],
  ["Escape", "Esc", "Close help / leave the answer box", blurAnswer, true],
  ["[Shift]+?", "?", "Show this help", toggleHelp],
];

const label = (el: Element) => (el.getAttribute("aria-label") || el.textContent || "").trim();

const usable = (el: HTMLElement) =>
  el.offsetParent !== null && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";

function clickButton(pattern: RegExp, root: ParentNode = document) {
  const el = [...root.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')].find(
    (el) => usable(el) && pattern.test(label(el)),
  );
  el?.click();
  return !!el;
}

// The maths editor's Symbols and Draw sheets stay in the page, inert while closed, and their buttons only open them
function toggleSheet(name: string, button: RegExp) {
  const sheet = document.querySelector(`[role="dialog"][aria-label="${name}"]`);
  return sheet && !sheet.closest("[inert]") ? clickButton(/^close$/i, sheet) : clickButton(button);
}

const isTyping = (el: EventTarget | null) =>
  el instanceof Element &&
  !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]');

// Inside shadow roots (e.g. other userscripts' UI), activeElement and event targets are the shadow host
function deepActiveElement() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function focusAnswer() {
  const box = document.querySelector<HTMLElement>(
    'main [role="textbox"], main textarea, main [contenteditable="true"]',
  );
  box?.focus();
  box?.scrollIntoView({ block: "center" });
  return !!box;
}

function blurAnswer() {
  if (help.matches(":popover-open")) return toggleHelp();
  const el = deepActiveElement();
  if (!isTyping(el)) return false;
  // Let Escape close the editor's auto-suggest menu first
  if ([...document.querySelectorAll<HTMLElement>('[role="menu"]')].some(usable)) return false;
  (el as HTMLElement).blur();
  return true;
}

function checkOrNext() {
  return clickButton(/^(check answer|self-mark answer)/i) || clickButton(/^next/i);
}

// Multiple choice options are plain buttons ("Choice A ...") in a list inside the question
const options = () => [...document.querySelectorAll<HTMLElement>("main article ul > li > button")].filter(usable);

function pickOption(n: number) {
  const el = options()[n - 1];
  el?.click();
  el?.focus();
  return !!el;
}

// Only once an option has focus, so that otherwise the arrows still scroll the page
function moveOption(delta: number) {
  const all = options();
  const i = all.indexOf(document.activeElement as HTMLElement);
  if (i === -1) return false;
  return pickOption(Math.min(Math.max(i + delta, 0), all.length - 1) + 1);
}

const host = document.createElement("div");
const help = Object.assign(document.createElement("div"), { popover: "auto" });
const list = document.createElement("dl");
for (const [, shown, description] of SHORTCUTS) {
  const key = document.createElement("dt");
  key.append(Object.assign(document.createElement("kbd"), { textContent: shown }));
  list.append(key, Object.assign(document.createElement("dd"), { textContent: description }));
}
help.append(Object.assign(document.createElement("h2"), { textContent: "Keyboard shortcuts" }), list);
// In a shadow root so that Atomi's CSS doesn't reach it
host.attachShadow({ mode: "open" }).append(Object.assign(document.createElement("style"), { textContent: css }), help);
document.body.append(host);

function toggleHelp() {
  help.togglePopover();
  return true;
}

tinykeys(
  window,
  Object.fromEntries(
    SHORTCUTS.map(([keys, , , action, whileTyping]) => [
      keys,
      (event: KeyboardEvent) => {
        if (!whileTyping && isTyping(event.composedPath()[0])) return;
        if (action instanceof RegExp ? clickButton(action) : action(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    ]),
  ),
  // Capture, so this runs before Atomi's own handlers. Repeats are ignored so holding a key can't skip question after
  // question.
  { capture: true, ignore: (event) => event.defaultPrevented || event.isComposing || event.repeat },
);
