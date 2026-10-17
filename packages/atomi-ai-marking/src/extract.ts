// Reads the question, marking guidelines and answer from the page, as text for the model

import { type AnswerBox, findAnswerBox, findDrawCanvas, linkBlock, type MathField, markOptions } from "./page";

const MAX_DRAWING_SIZE = 2000; // px, longest side

export interface MarkingContext {
  topic: string;
  question: string;
  guidelines: string;
  answer: string;
  /** the answer was typed in the maths editor, so it's LaTeX */
  latex: boolean;
  max: number | null;
  /** URLs of the images referred to as [Image N] */
  images: string[];
}

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "SVG",
  "BUTTON",
  "NOSCRIPT",
  "TEXTAREA",
  "SELECT",
  "TEMPLATE",
  "MATH-FIELD",
  "CANVAS",
]);
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "TR",
  "TABLE",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "HR",
  "SECTION",
  "ARTICLE",
  "FIGURE",
  "FIGCAPTION",
  "HEADER",
  "FOOTER",
  "DL",
  "DT",
  "DD",
]);

function imageRef(images: string[], src: string, alt?: string | null): string {
  let url: string;
  try {
    url = new URL(src, location.href).href;
  } catch {
    return alt || "";
  }
  images.push(url);
  return `[Image ${images.length}${alt ? `: ${alt}` : ""}]`;
}

function katexToText(el: Element): string {
  const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  if (tex == null) return el.textContent;
  return el.closest(".katex-display") ? `\n$$${tex}$$\n` : `$${tex}$`;
}

function domToText(root: Element | DocumentFragment, images: string[]): string {
  // Atomi hides its KaTeX from screen readers (aria-hidden) and describes it in words ("start subscript, 84, end
  // subscript...") in a visually hidden element named by aria-describedby.
  const spoken = new Set<string>();
  for (const el of root.querySelectorAll('[aria-hidden="true"][aria-describedby]')) {
    if (el.querySelector(".katex")) for (const id of el.getAttribute("aria-describedby")!.split(/\s+/)) spoken.add(id);
  }

  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue;
      return;
    }
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of node.childNodes) walk(child);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (el.classList.contains("katex")) {
      out += katexToText(el);
      return;
    }
    if (SKIP_TAGS.has(tag) || el.hidden || spoken.has(el.id)) return;
    if (el.getAttribute("aria-hidden") === "true") {
      for (const math of el.querySelectorAll(".katex")) out += katexToText(math);
      return;
    }
    if (tag === "IMG") {
      const img = el as HTMLImageElement;
      if (img.src) out += imageRef(images, img.src, img.alt);
      return;
    }
    if (tag === "BR") {
      out += "\n";
      return;
    }
    if (tag === "LI") {
      const list = el.parentElement;
      out += list?.tagName === "OL" ? `\n${[...list.children].indexOf(el) + 1}. ` : "\n- ";
    } else if (tag === "TR") {
      out += "\n|";
    } else if (BLOCK_TAGS.has(tag)) {
      out += "\n";
    }
    if (tag === "TD" || tag === "TH") out += " ";
    for (const child of el.childNodes) walk(child);
    if (tag === "TD" || tag === "TH") out += " |";
    else if (BLOCK_TAGS.has(tag)) out += "\n";
  };
  walk(root);
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Everything in the question card above the "Your answer" box
function readQuestion(answerBox: AnswerBox, images: string[]): string {
  const container = answerBox.closest("article") ?? document.querySelector("main")!;
  const label = answerBox.id ? document.querySelector(`label[for="${CSS.escape(answerBox.id)}"]`) : null;
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEndBefore(label && container.contains(label) ? label : answerBox);
  return domToText(range.cloneContents(), images);
}

// The guidelines link contains the markdown in base64
function readGuidelinesMarkdown(link: HTMLAnchorElement): string | null {
  try {
    const b64 = new URL(link.href).searchParams
      .get("markdown")!
      .replace(/ /g, "+")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).trim() || null;
  } catch {
    return null;
  }
}

function readGuidelines(link: HTMLAnchorElement, images: string[]): string {
  const markdown = readGuidelinesMarkdown(link);
  if (markdown) {
    return markdown
      .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g, (_, alt: string, src: string) =>
        imageRef(images, src, alt),
      )
      .replace(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (tag, src: string) =>
        imageRef(images, src, /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]),
      );
  }
  // Fall back to the guidelines shown below the link
  const block = linkBlock(link);
  const range = document.createRange();
  range.setStartAfter(block);
  range.setEndAfter(block.parentElement!.lastChild!);
  return domToText(range.cloneContents(), images);
}

// The maths editor is a MathLive <math-field> holding LaTeX. MathLive mirrors its value into the element's text, for
// when its API isn't reachable from the script's world.
const readMathField = (field: MathField) =>
  (typeof field.getValue === "function" ? field.getValue("latex") : field.textContent).trim();

// The Draw sheet keeps its ink on a transparent canvas. Returns the inked area on white as a PNG data URL, or null if
// nothing has been drawn.
function readDrawing(): string | null {
  const canvas = findDrawCanvas();
  if (!canvas?.width || !canvas.height) return null;
  const { width, height } = canvas;
  let pixels: Uint32Array;
  try {
    pixels = new Uint32Array(canvas.getContext("2d")!.getImageData(0, 0, width, height).data.buffer);
  } catch (err) {
    console.warn("[Atomi AI marking] Couldn't read the drawing", err);
    return null;
  }
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (pixels[row + x] >>> 24) {
        if (y < top) top = y;
        bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return null;

  const pad = Math.round(width / 100);
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  const w = Math.min(width, right + pad + 1) - x;
  const h = Math.min(height, bottom + pad + 1) - y;
  const scale = Math.min(1, MAX_DRAWING_SIZE / Math.max(w, h));
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

const isMathField = (box: AnswerBox): box is MathField => box.tagName === "MATH-FIELD";

function readAnswer(answerBox: AnswerBox, images: string[]): string {
  const text = isMathField(answerBox) ? readMathField(answerBox) : (answerBox as HTMLTextAreaElement).value.trim();
  const drawing = readDrawing();
  return [text, drawing && imageRef(images, drawing, "the student's drawing")].filter(Boolean).join("\n\n");
}

export function collectContext(link: HTMLAnchorElement): MarkingContext {
  const answerBox = findAnswerBox();
  if (!answerBox) throw new Error("Couldn't find your answer on this page.");
  const images: string[] = [];
  // Answer first, so the image limit never drops the drawing
  const answer = readAnswer(answerBox, images);
  const question = readQuestion(answerBox, images);
  const guidelines = readGuidelines(link, images);
  const options = markOptions();
  const max = options.length
    ? Math.max(...options.map((o) => o.n))
    : Number(/(\d+)\s*marks?\b/i.exec(question)?.[1]) || null;
  return {
    topic: document.querySelector("main h1")?.textContent.trim() ?? "",
    question,
    guidelines,
    answer,
    latex: isMathField(answerBox),
    max,
    images,
  };
}
