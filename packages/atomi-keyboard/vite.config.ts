import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

const REPO = "https://github.com/wongcallum/atomi-userscripts";
const DOWNLOAD = "https://raw.githubusercontent.com/wongcallum/atomi-userscripts/releases/atomi-keyboard.user.js";

export default defineConfig(({ command }) => ({
  build: { minify: true },
  server: { port: 4013, strictPort: true },
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "Atomi Keyboard Shortcuts",
        namespace: "atomi-keyboard",
        description: "Keyboard shortcuts for Atomi questions",
        author: "Callum Wong",
        license: "MIT",
        homepageURL: REPO,
        ...(command === "build" && { updateURL: DOWNLOAD, downloadURL: DOWNLOAD }),
        match: ["https://learn.getatomi.com/*"],
        "run-at": "document-idle",
        noframes: true,
      },
      server: { open: false },
      build: {
        fileName: "atomi-keyboard.user.js",
      },
    }),
  ],
}));
