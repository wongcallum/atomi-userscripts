# atomi-userscripts

Userscripts for [Atomi](https://getatomi.com).

## atomi-ai-marking

A userscript that helps you mark your responses to short answer questions against the question's marking guidelines,
using any OpenAI-compatible LLM API.

It works with both the plain text answer box and the multi-format editor, including images drawn with the Draw tool.

### Install

<https://raw.githubusercontent.com/wongcallum/atomi-userscripts/releases/atomi-ai-marking.user.js>

### Use

1. Answer a short answer question, then click **Self-mark answer**.
2. Click the **Mark with AI** button in the footer.
3. For the first run, you'll be prompted to enter an API key.
   By default the script uses [OpenRouter](https://openrouter.ai/keys) with `anthropic/claude-haiku-5.5`.
   You can choose any OpenAI-compatible endpoint and model.

## Development

```sh
pnpm install
pnpm dev
pnpm mock-llm
```

With the dev server running, install the dev loader from <http://localhost:4012/__vite-plugin-monkey.install.user.js>.
