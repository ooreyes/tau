/** Lightweight Gemini catalog shared by first-paint preferences and the
 * deferred cloud-assistant implementation. Keep this module free of provider
 * and network imports: reading Tau's saved preference must not pull the whole
 * assistant compiler into the initial renderer bundle. */
export const GEMINI_MODEL_PRESETS = {
  "gemini-2.5-flash": {
    label: "Gemini 2.5 Flash",
    model: "gemini-2.5-flash",
    /** Free-tier eligible: the no-credit-card default for students. */
    freeTier: true,
  },
  "gemini-2.5-pro": {
    label: "Gemini 2.5 Pro",
    model: "gemini-2.5-pro",
    freeTier: false,
  },
} as const;

export type GeminiModelPreset = keyof typeof GEMINI_MODEL_PRESETS;

export const GEMINI_DEFAULT_MODEL: GeminiModelPreset = "gemini-2.5-flash";
