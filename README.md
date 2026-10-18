# atomi-userscripts

Userscripts for [Atomi](https://getatomi.com).

## atomi-ai-marking

A userscript that helps you mark your responses to short answer questions against the question's marking guidelines,
using any OpenAI-compatible LLM API. It sends any images embedded and PDFs linked in the question.

It works with both the plain text answer box and the multi-format editor, including images drawn with the Draw tool.

### Install

<https://raw.githubusercontent.com/wongcallum/atomi-userscripts/releases/atomi-ai-marking.user.js>

### Use

1. Answer a short answer question, then click **Self-mark answer**.
2. Click the **Mark with AI** button in the footer.
3. For the first run, you'll be prompted to enter an API key.
   By default the script uses [OpenRouter](https://openrouter.ai/keys) with `google/gemini-3.8-flash`.
   You can choose any OpenAI-compatible endpoint and model.

## atomi-dark

Adds dark mode to Atomi.

### Install

<https://raw.githubusercontent.com/wongcallum/atomi-userscripts/releases/atomi-dark.user.js>

### Use

By default it follows your system's light or dark setting.
To always use dark or light, click **Theme** in your userscript manager's menu.

## atomi-keyboard

A userscript that adds keyboard shortcuts for answering questions.

### Install

<https://raw.githubusercontent.com/wongcallum/atomi-userscripts/releases/atomi-keyboard.user.js>

### Use

Press <kbd>?</kbd> in Atomi to see the list of shortcuts.

While you're typing an answer, only <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> and <kbd>Esc</kbd> work.

## Development

```sh
pnpm install
pnpm dev
pnpm mock-llm
```

With the dev servers running, open the `Local` URL each one prints to install its dev loader.
