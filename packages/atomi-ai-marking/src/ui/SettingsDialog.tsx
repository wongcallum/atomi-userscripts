import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { DEFAULT_ENDPOINT, DEFAULT_MODEL, saveSettings, storedSettings } from "../settings";

interface DialogState {
  /** 0 when closed, otherwise which opening this is, so the form starts afresh each time */
  open: number;
  message: string | null;
  onSave: (() => void) | null;
}

const dialog = signal<DialogState>({ open: 0, message: null, onSave: null });
let openings = 0;

export function openSettings(message: string | null = null, onSave: (() => void) | null = null) {
  dialog.value = { open: ++openings, message, onSave };
}

const close = () => {
  dialog.value = { ...dialog.value, open: 0, onSave: null };
};

const Field = ({ label, hint, children }: { label: string; hint: string; children: ComponentChildren }) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
  <label>
    {label}
    {children}
    <small>{hint}</small>
  </label>
);

// An in-page dialog rather than prompt(), which shows one setting at a time
export function SettingsDialog() {
  const { open, message, onSave } = dialog.value;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const stored = storedSettings();
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const field = (name: string) => String(form.get(name) ?? "");
    saveSettings({
      apiKey: field("apiKey"),
      endpoint: field("endpoint"),
      model: field("model"),
      effort: field("effort"),
    });
    close();
    onSave?.();
  };

  return (
    <dialog ref={ref} aria-labelledby="aiam-settings-title" onClose={close}>
      {open > 0 && (
        <form key={open} onSubmit={submit}>
          <h2 id="aiam-settings-title">AI marking settings</h2>
          {message && <p class="message">{message}</p>}
          <Field label="API key" hint="Leave blank for endpoints that don't need one.">
            <input name="apiKey" type="password" autocomplete="off" defaultValue={stored.apiKey ?? ""} />
          </Field>
          <Field label="API endpoint" hint="Any OpenAI-compatible base URL.">
            <input name="endpoint" placeholder={DEFAULT_ENDPOINT} defaultValue={stored.endpoint} />
          </Field>
          <Field label="Model" hint="Vision-capable models are preferred, and needed to mark drawings.">
            <input name="model" placeholder={DEFAULT_MODEL} defaultValue={stored.model} />
          </Field>
          <Field label="Reasoning effort" hint="Leave blank if your endpoint rejects the reasoning_effort parameter.">
            <input name="effort" list="aiam-efforts" defaultValue={stored.effort} />
          </Field>
          <datalist id="aiam-efforts">
            {["minimal", "low", "medium", "high"].map((effort) => (
              <option key={effort} value={effort} />
            ))}
          </datalist>
          <div class="actions">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button type="submit">Save</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
