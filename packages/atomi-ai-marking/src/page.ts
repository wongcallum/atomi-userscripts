// Where things are on Atomi's question pages

export type MathField = HTMLElement & { getValue?: (format: string) => string };
export type AnswerBox = HTMLTextAreaElement | MathField;

export const findMarksLabel = () =>
  document.evaluate(
    '//footer//*[not(*)][normalize-space()="I got"]',
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue as Element | null;
export const findGuidelinesLink = () =>
  document.querySelector<HTMLAnchorElement>('main a[href*="/view/marking-guidelines"]');
// Some questions don't have one
export const findAnswerBox = (): AnswerBox | null =>
  document.querySelector<HTMLTextAreaElement>("main textarea#answer") ??
  document.querySelector<MathField>("main math-field") ??
  document.querySelector<HTMLTextAreaElement>("main textarea");
// The maths editor's Draw sheet, which keeps its canvas after closing
export const findDrawCanvas = () =>
  document.querySelector<HTMLCanvasElement>('[role="dialog"][aria-label="Draw"] canvas');
const findMarkSelect = () => document.querySelector<HTMLSelectElement>("footer select");
const findMarkTrigger = () => document.querySelector<HTMLButtonElement>('footer button[aria-haspopup="listbox"]');

// The guidelines link's outermost wrapper that holds nothing else
export function linkBlock(link: Element): Element {
  let node = link;
  while (
    node.parentElement &&
    node.parentElement.childElementCount === 1 &&
    !node.parentElement.matches("main, article")
  ) {
    node = node.parentElement;
  }
  return node;
}

interface MarkOption {
  value: string;
  label: string;
  n: number;
}

// The choices in the "I got" dropdown
export function markOptions(): MarkOption[] {
  const select = findMarkSelect();
  if (!select) return [];
  return [...select.options]
    .map((o) => ({ value: o.value, label: o.textContent.trim(), n: Number(o.value) }))
    .filter((o) => o.value !== "" && Number.isFinite(o.n));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(fn: () => T | null | undefined, timeout = 1500): Promise<T | null> {
  for (const start = Date.now(); Date.now() - start < timeout; await sleep(50)) {
    const result = fn();
    if (result) return result;
  }
  return null;
}

// Selects the closest option in the "I got" dropdown
export async function selectMark(mark: number) {
  const options = markOptions();
  if (!options.length) return;
  const best = options.reduce((a, b) => (Math.abs(b.n - mark) < Math.abs(a.n - mark) ? b : a));
  const trigger = findMarkTrigger();
  const shown = () => trigger?.textContent.trim() === best.label;
  if (shown()) return;

  // react-aria mirrors the listbox in a hidden native <select>, and changing that updates the dropdown. The prototype's
  // setter gets past React's value tracking when the script runs in the page's world.
  const select = findMarkSelect()!;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, best.value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(100);
  if (shown() || !trigger) return;

  // Otherwise pick it the way the user would.
  trigger.click();
  const option = await waitFor(() =>
    [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')].find(
      (o) => o.textContent.trim() === best.label,
    ),
  );
  option?.click();
}
