import { type ComponentChild, render } from "preact";
import { GM_registerMenuCommand } from "$";
import { markAnswer, marking, resetMarking, stopMarking } from "./marking";
import { findAnswerBox, findGuidelinesLink, findMarksLabel, linkBlock } from "./page";
import { loadSettings } from "./settings";
import css from "./style.css?inline";
import { MarkButton } from "./ui/MarkButton";
import { Panel } from "./ui/Panel";
import { openSettings, SettingsDialog } from "./ui/SettingsDialog";

// Each part of the UI is a Preact tree in a shadow root of an element of ours, so that Atomi's CSS doesn't reach it.
// sync() keeps them in place as Atomi re-renders.
function mount(host: HTMLElement, ui: ComponentChild) {
  const root = host.attachShadow({ mode: "open" });
  root.append(Object.assign(document.createElement("style"), { textContent: css }));
  render(ui, root);
  return host;
}
const buttonHost = document.createElement("span");
buttonHost.style.display = "contents";
const panelHost = document.createElement("div");

function startMarking() {
  const link = findGuidelinesLink();
  if (!link) return;
  const settings = loadSettings();
  if (settings.apiKey === undefined) {
    openSettings("Enter your API key to start marking.", startMarking);
    return;
  }
  void markAnswer(link, settings);
  sync();
}

function sync() {
  const label = findMarksLabel();
  const link = findGuidelinesLink();

  // The button goes directly left of "I got", once the guidelines are showing. Questions to complete on paper have
  // no answer box, so there's nothing to mark.
  if (label && link && findAnswerBox()) {
    if (buttonHost.nextElementSibling !== label) label.before(buttonHost);
  } else {
    buttonHost.remove();
  }

  // The panel goes above the guidelines. Atomi moves between questions without reloading, so clear it on a new one.
  const { key } = marking.value;
  if (link && key && link.href !== key) resetMarking();
  if (link && marking.value.key) {
    const block = linkBlock(link);
    if (panelHost.nextElementSibling !== block) block.before(panelHost);
  } else {
    panelHost.remove();
  }
}

mount(buttonHost, <MarkButton onMark={startMarking} onStop={stopMarking} />);
mount(panelHost, <Panel />);
document.body.append(mount(document.createElement("div"), <SettingsDialog />));
GM_registerMenuCommand("Settings", () => openSettings());

let timer = 0;
// Changes in our shadow roots aren't seen here
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(sync, 50);
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
sync();
