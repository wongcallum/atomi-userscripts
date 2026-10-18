import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

const REPO = "https://github.com/wongcallum/atomi-userscripts";
const DOWNLOAD = "https://raw.githubusercontent.com/wongcallum/atomi-userscripts/releases/atomi-dark.user.js";

export default defineConfig(({ command }) => ({
  build: { minify: true },
  server: { port: 4014, strictPort: true },
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "Atomi Dark Mode",
        namespace: "atomi-dark",
        description: "Dark mode for Atomi",
        author: "Callum Wong",
        license: "MIT",
        homepageURL: REPO,
        ...(command === "build" && { updateURL: DOWNLOAD, downloadURL: DOWNLOAD }),
        match: ["https://learn.getatomi.com/*"],
        "run-at": "document-start",
        noframes: true,
      },
      server: { open: false },
      build: {
        fileName: "atomi-dark.user.js",
      },
    }),
  ],
}));
