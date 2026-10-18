import { GM_getValue, GM_registerMenuCommand, GM_setValue, GM_unregisterMenuCommand } from "$";
import css from "./style.css?inline";

type Mode = "auto" | "dark" | "light";
type Role = "background" | "border" | "text";

const NEXT: Record<Mode, Mode> = { auto: "dark", dark: "light", light: "auto" };
const LABEL: Record<Mode, string> = { auto: "Theme: match system", dark: "Theme: dark", light: "Theme: light" };

// Atomi's design tokens (--neon-color-*) are compiled into literal colours, so colours are swapped by value.
// The same values are used for different things: white is the page background, but also the text on blue buttons.
const PALETTE: Record<Role, Record<string, string>> = {
  background: {
    ffffff: "#1c1e22",
    f6f7f9: "#24272b",
    f0f7ff: "#182434",
    e1e3e7: "#33373d",
    c4c8cf: "#474c54",
    a9afb7: "#5b616a",
    d6ebff: "#1d3352",
    ffe7e5: "#3f1f1c",
    ffece5: "#3f2619",
    dffbf0: "#16372a",
  },
  border: {
    f6f7f9: "#24272b",
    e1e3e7: "#33373d",
    c4c8cf: "#474c54",
    a9afb7: "#5b616a",
  },
  text: {
    "26282b": "#e1e3e7",
    "5b636c": "#b4bac2",
    "6f7680": "#979ea8",
    "8e949e": "#767d87",
    a9afb7: "#646a73",
    c4c8cf: "#4f555d",
    "0057ff": "#5c9bff",
    "0042c7": "#7fb0ff",
    "002f8a": "#99c2ff",
    e31102: "#ff6a5e",
    bd0d00: "#ff6a5e",
    "00804a": "#33c27f",
    d13800: "#ff7a45",
  },
};

// Subject colours, e.g. avatars and subject labels
const ACCENTS: [pastel: string, subtle: string, bright: string, text: string][] = [
  ["c1e9f4", "e7f6fa", "65cae4", "0080a3"],
  ["e6afcd", "f5e1ec", "e6afcd", "c13883"],
  ["e3f3d1", "f4faed", "bae191", "568226"],
  ["99ead6", "d8f7ef", "00cc99", "008564"],
  ["e0caf0", "f3ebf9", "b27cda", "935cbc"],
  ["f6cfda", "fbecf0", "e988a3", "db345b"],
  ["c5badd", "e9e5f2", "c5badd", "6f54aa"],
  ["ceedf8", "e6f6fb", "00a7dd", "007ea8"],
  ["ffbdbf", "ffe5e6", "ff5a5f", "eb0032"],
  ["fdd9cd", "feece6", "f9845b", "d83f08"],
  ["99e9e7", "d9f6f6", "00c9c3", "00808a"],
  ["fff3b5", "fef9e9", "fed86f", "fcb95b"],
];
for (const [pastel, subtle, bright, text] of ACCENTS) {
  PALETTE.background[pastel] = `color-mix(in srgb, #${bright} 35%, #1c1e22)`;
  PALETTE.background[subtle] = `color-mix(in srgb, #${bright} 15%, #1c1e22)`;
  PALETTE.text[text] = `#${bright}`;
}

// SVG colour attributes don't say what they're for, so every known grey is flipped.
// White stays, as it's mostly icons on coloured backgrounds.
const SVG_PALETTE: Record<string, string> = {
  ...PALETTE.background,
  ...PALETTE.border,
  ...PALETTE.text,
  ffffff: "",
  d6ebff: "#3a5a8a",
  d1d5db: "#474c54",
  "666666": "#979ea8",
};
const SVG_ATTRIBUTES = ["fill", "stroke", "stop-color"];

function role(property: string): Role | undefined {
  if (property.startsWith("--")) {
    if (/text|icon|symbol|secondary/i.test(property)) return "text";
    if (/border|line|shadow/i.test(property)) return "border";
    if (/background|status/i.test(property)) return "background";
    return undefined;
  }
  if (/^(color|fill|stroke|caret-color|text-decoration-color|-webkit-text-fill-color)$/.test(property)) return "text";
  if (/border|outline|shadow|column-rule/.test(property)) return "border";
  if (property.startsWith("background")) return "background";
  return undefined;
}

const COLOUR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\bwhite\b/gi;

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

// To #rrggbbaa
function normalise(colour: string) {
  if (colour.toLowerCase() === "white") return "ffffffff";
  if (colour.startsWith("#")) {
    const digits = colour.slice(1).toLowerCase();
    return (digits.length <= 4 ? [...digits].map((c) => c + c).join("") : digits).padEnd(8, "f");
  }
  const [r = 0, g = 0, b = 0, a = 1] = colour.match(/[\d.]+/g)?.map(Number) ?? [];
  return [r, g, b, a * 255].map(hex).join("");
}

function swap(colour: string, palette: Record<string, string>) {
  const rgba = normalise(colour);
  const dark = palette[rgba.slice(0, 6)];
  if (!dark) return colour;
  const alpha = Number.parseInt(rgba.slice(6), 16) / 2.55;
  return `light-dark(${colour}, ${alpha > 99.9 ? dark : `color-mix(in srgb, ${dark} ${alpha.toFixed(1)}%, transparent)`})`;
}

function rewrite(style: CSSStyleDeclaration) {
  for (const property of [...style]) {
    const r = role(property);
    const value = style.getPropertyValue(property);
    if (!r || value.includes("light-dark(")) continue;
    const next = value.replace(COLOUR, (colour) => swap(colour, PALETTE[r]));
    if (next !== value) style.setProperty(property, next, style.getPropertyPriority(property));
  }
}

const done = new WeakSet<CSSRule>();

function rewriteRules(rules: CSSRuleList) {
  for (const rule of rules) {
    if ("style" in rule && !done.has(rule)) {
      done.add(rule);
      rewrite(rule.style as CSSStyleDeclaration);
    }
    if ("cssRules" in rule) rewriteRules(rule.cssRules as CSSRuleList);
  }
}

const own = new CSSStyleSheet();
const lengths = new WeakMap<CSSStyleSheet, number>();

// styled-components adds rules with insertRule.
// Checking for new rules after each DOM change catches them before they're painted.
function scan() {
  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    if (sheet === own) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (lengths.get(sheet) === rules.length) continue;
    lengths.set(sheet, rules.length);
    rewriteRules(rules);
  }
}

const owned = new WeakMap<SVGElement, Set<string>>();

function rewriteSvg(el: SVGElement) {
  for (const attribute of SVG_ATTRIBUTES) {
    const value = el.getAttribute(attribute);
    const next = value?.replace(COLOUR, (colour) => swap(colour, SVG_PALETTE));
    const ours = owned.get(el) ?? new Set();
    if (next && next !== value) {
      el.style.setProperty(attribute, next);
      owned.set(el, ours.add(attribute));
    } else if (ours.delete(attribute)) el.style.removeProperty(attribute);
  }
}

const INLINE = "[style], [fill], [stroke], [stop-color]";

function rewriteInline(el: Node) {
  if (el instanceof HTMLElement || el instanceof SVGElement) rewrite(el.style);
  if (el instanceof SVGElement) rewriteSvg(el);
}

let mode = GM_getValue<Mode>("mode", "auto");
let menu: string | number | undefined;

function apply() {
  const scheme = { auto: "light dark", dark: "dark", light: "light" }[mode];
  const ink = '[role="dialog"][aria-label="Draw"] canvas { filter: invert(1) }';
  own.replaceSync(
    `${css}
    :root { color-scheme: ${scheme} !important }
    ${{ auto: `@media (prefers-color-scheme: dark) { ${ink} }`, dark: ink, light: "" }[mode]}`,
  );
  if (menu !== undefined) GM_unregisterMenuCommand(menu);
  menu = GM_registerMenuCommand(LABEL[mode], () => {
    mode = NEXT[mode];
    GM_setValue("mode", mode);
    apply();
  });
}

apply();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, own];
scan();
document.querySelectorAll(INLINE).forEach(rewriteInline);
new MutationObserver((records) => {
  scan();
  for (const record of records) {
    if (record.type === "attributes") rewriteInline(record.target);
    for (const node of record.addedNodes) {
      rewriteInline(node);
      if (node instanceof Element) node.querySelectorAll(INLINE).forEach(rewriteInline);
    }
  }
}).observe(document, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["style", "class", ...SVG_ATTRIBUTES],
});
// Stylesheets from <link>s load after the element is added
document.addEventListener("load", scan, true);
