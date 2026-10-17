## Guidelines

- Before calling a change done, run `pnpm check` and `pnpm typecheck`. Test UI and behaviour changes in the browser.
- Don't commit unless asked.
- Avoid writing our own implementation when there are dependencies and platform APIs. Keep the bundle small though.
- By default, write no comments. Write them when there is behaviour that would surprise a competent reader of the code.
- Keep the UI minimal and close to Atomi's look.

## Releasing

Bump `version` in the script's `package.json`, then push a tag `<package>@<version>`.

## Testing

- Test in the firefox-devtools MCP's Firefox (logged in to Atomi, with Violentmonkey).
- If the MCP isn't installed, notify the user instead of finding workarounds.
- AI features should be tested against against the mock LLM (`pnpm mock-llm`).

### Setup

- Each dev loader shows up in Violentmonkey as `server:<name>`, with its own stored values.
- The first time, Firefox asks whether the site may access other apps and services on this device.
  Until a person allows it (and remembers the choice), requests to the dev server hang.

### Browser

- Only one Firefox can use the MCP's profile at a time. Close the MCP's browser before `pnpm browser`
  (e.g. to log in again), and close that before using the MCP again.
- The MCP can't see or click `moz-extension://` pages. Ask a person to click Install/Reinstall,
  or to edit script values (Violentmonkey dashboard -> script -> Values). Reinstalling keeps stored values.
- `prompt()` dialogs are dismissed instantly, including from userscript menu commands.

### Driving Atomi

- Questions are in practice sets (list entry says "practice"), and multiple choice ones in quizzes ("quiz").
  Opening a set again resumes where it was left.
- `/accounts/<id>/classes/...` links still work, same as `/subscriptions/<id>/classes/...`.
- Maths editor (`math-field`): `click_by_uid` on it or call its `focus()`, then `type_text` without a uid. Focus
  reaches it on the next animation frame, so keys sent straight after go to the page.
  Spaces become `\:`, Enter makes `\displaylines{...\\...}`.
- Drawing: click Draw, then dispatch `PointerEvent`s and `MouseEvent`s at the canvas with
  `pointerId: 0, pointerType: 'mouse'` in CSS pixels. Pen pointers don't draw. Screenshots are scaled by
  `devicePixelRatio`.
- The console can be noisy, so filter by the script's prefix.
- The stylesheet is copied into each shadow root when the UI mounts, so reload the page to see CSS changes.

### Mock LLM

- Set `endpoint` to `http://127.0.0.1:4010/api/v1` and `apiKey` to anything in the script's settings dialog.
  Delete `apiKey` to see the first-run flow.
- aimock's journal truncates bodies over 64 KB (anything with an image). Use `.mock-llm/requests/` or
  `pnpm mock-llm:last` instead.
- `Connection closed before the response finished` in the proxy log is expected when the client hangs up.
