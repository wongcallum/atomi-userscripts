import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Example',
        namespace: 'atomi-userscripts',
        match: ['https://example.com/*'],
      },
    }),
  ],
});
