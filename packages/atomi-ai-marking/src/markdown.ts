import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const md = new Marked({ gfm: true });
// Rendered by Temml (aliased to katex in vite.config.ts) as MathML, which the browser draws itself, so no CSS or
// fonts are needed
md.use(markedKatex({ throwOnError: false, strict: false, nonStandard: true }));
// Some models write \(...\) and \[...\] despite being asked for $...$.
const BRACKETED = /^\\\((.+?)\\\)|^\\\[(.+?)\\\]/s;
md.use({
  extensions: [
    {
      name: "bracketedKatex",
      level: "inline",
      start: (src) => src.search(/\\[([]/),
      tokenizer(src) {
        const match = BRACKETED.exec(src);
        if (!match) return;
        const [raw, inline, display] = match;
        return { type: "inlineKatex", raw, text: (inline ?? display).trim(), displayMode: display !== undefined };
      },
    },
  ],
});
md.use({
  renderer: {
    // Show HTML from the model as text rather than adding it to the page
    html: ({ text }) => escapeHtml(text),
    // Only web links, opened in a new tab, and no images, which could load from anywhere
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!/^(https?:|mailto:)/i.test(href)) return text;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image: ({ text }) => escapeHtml(text),
  },
});

const inlineCache = new Map<string, string>();

export const renderMarkdown = (text: string) => md.parse(text, { async: false });

// Called for every criterion on every update while the reply streams in, so finished ones come from the cache
export function renderInline(text: string): string {
  let html = inlineCache.get(text);
  if (html === undefined) {
    if (inlineCache.size > 500) inlineCache.clear();
    html = md.parseInline(text, { async: false });
    inlineCache.set(text, html);
  }
  return html;
}
