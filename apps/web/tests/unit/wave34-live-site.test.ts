import { describe, expect, it } from "vitest";
import he from "@/lib/i18n/dictionaries/he.json";
import ar from "@/lib/i18n/dictionaries/ar.json";
import en from "@/lib/i18n/dictionaries/en.json";

/** Wave 34 — "view site" must never show a stale page: unsaved edits (the agent's too) are called out and saved first. */
const KEYS = ["unsavedLiveTitle", "unsavedLiveBody", "saveAndUpdate", "saveAndView", "openFullPreview", "popupBlocked", "adjusted"] as const;
const LIVE_KEYS = ["stale", "broken"] as const;
type Dict = { websites: { editor: Record<string, string>; live: Record<string, string> } };

describe("wave 34 — live site vs. editor state", () => {
  for (const [name, dict] of [["he", he], ["ar", ar], ["en", en]] as const) {
    it(`${name}: every new editor string exists and is non-empty`, () => {
      const ed = (dict as unknown as Dict).websites.editor;
      for (const k of KEYS) expect(typeof ed[k] === "string" && ed[k]!.trim().length > 3, `${name}.${k}`).toBe(true);
      const live = (dict as unknown as Dict).websites.live;
      for (const k of LIVE_KEYS) expect(typeof live[k] === "string" && live[k]!.trim().length > 3, `${name}.live.${k}`).toBe(true);
    });
  }
});
