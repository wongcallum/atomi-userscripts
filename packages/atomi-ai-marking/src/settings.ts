import { GM_getValue, GM_setValue } from "$";

export const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "google/gemini-3.8-flash";
export const DEFAULT_EFFORT = "low";

export interface Settings {
  /** undefined until the settings have been saved once */
  apiKey: string | undefined;
  endpoint: string;
  model: string;
  /** blank = don't send one */
  effort: string;
}

// Stored as entered, under version 1's keys so its settings carry over. A blank endpoint or model means the default.
export function storedSettings(): Settings {
  return {
    apiKey: GM_getValue<string | undefined>("apiKey", undefined),
    endpoint: GM_getValue("endpoint", ""),
    model: GM_getValue("model", ""),
    effort: GM_getValue("reasoningEffort", DEFAULT_EFFORT),
  };
}

export function loadSettings(): Settings {
  const stored = storedSettings();
  return { ...stored, endpoint: stored.endpoint || DEFAULT_ENDPOINT, model: stored.model || DEFAULT_MODEL };
}

export function saveSettings(settings: Settings) {
  GM_setValue("apiKey", settings.apiKey?.trim() ?? "");
  GM_setValue("endpoint", settings.endpoint.trim());
  GM_setValue("model", settings.model.trim());
  GM_setValue("reasoningEffort", settings.effort.trim());
}
