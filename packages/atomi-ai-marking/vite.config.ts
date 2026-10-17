import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

const REPO = "https://github.com/wongcallum/atomi-userscripts";
// Published to the releases branch by .github/workflows/release.yml
const DOWNLOAD = "https://raw.githubusercontent.com/wongcallum/atomi-userscripts/releases/atomi-ai-marking.user.js";

export default defineConfig(({ command }) => ({
  // marked-katex-extension calls katex.renderToString, which Temml matches
  resolve: { alias: { katex: "temml" } },
  // Published as a GitHub release rather than on Greasy Fork, which requires readable code
  build: { minify: true },
  // Fixed so the installed dev loader (pnpm dev) keeps finding it
  server: { port: 4012, strictPort: true },
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  plugins: [
    monkey({
      entry: "src/main.tsx",
      userscript: {
        name: "Atomi AI Marking",
        namespace: "atomi-ai-marking",
        description: "Mark Atomi written answers against marking guidelines with an LLM (any OpenAI-compatible API)",
        author: "Callum Wong",
        license: "MIT",
        homepageURL: REPO,
        // Left off the dev loader, or Violentmonkey would update it to the release
        ...(command === "build" && { updateURL: DOWNLOAD, downloadURL: DOWNLOAD }),
        // Atomi navigates in-page, and userscripts only check @match on a full page load, so match the whole site
        // and look for a question in the page.
        match: ["https://learn.getatomi.com/*"],
        connect: ["openrouter.ai", "*"],
        "run-at": "document-idle",
        noframes: true,
      },
      server: { open: false },
      build: {
        fileName: "atomi-ai-marking.user.js",
      },
    }),
  ],
}));
