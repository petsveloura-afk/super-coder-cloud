import { describe, expect, it } from "vitest";
import he from "@/lib/i18n/dictionaries/he.json";
import ar from "@/lib/i18n/dictionaries/ar.json";
import en from "@/lib/i18n/dictionaries/en.json";
import { auditLabel, createTranslator, type Dictionary } from "@/lib/i18n/translate";
import { dirOf, negotiateLocale } from "@/lib/i18n/config";
import { NAV_ITEMS } from "@/lib/navigation";
import { CONTACT_STATUSES, LEAD_SOURCES } from "@scc/shared/validators";
import { ORG_ROLES } from "@scc/shared/permissions";

function leaves(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, leaves(v, key));
  }
  return out;
}

const dicts = { he, ar, en } as Record<string, Dictionary>;
const heKeys = Object.keys(leaves(he)).sort();

describe("localization dictionaries", () => {
  for (const [name, dict] of Object.entries(dicts)) {
    it(`${name} has exactly the same keys as he`, () => {
      expect(Object.keys(leaves(dict)).sort()).toEqual(heKeys);
    });
    it(`${name} has no empty strings and keeps every {placeholder}`, () => {
      const l = leaves(dict);
      const base = leaves(he);
      for (const [k, v] of Object.entries(l)) {
        expect(v.trim(), k).not.toBe("");
        const want = (base[k]!.match(/\{\w+\}/g) ?? []).sort();
        const got = (v.match(/\{\w+\}/g) ?? []).sort();
        expect(got, `${name}:${k}`).toEqual(want);
      }
    });
  }

  it("every nav item, status, source, role and validation key is translated", () => {
    const t = createTranslator(he as Dictionary);
    const keys = [
      ...NAV_ITEMS.map((n) => n.label),
      ...CONTACT_STATUSES.map((s) => `crm.statuses.${s}`),
      ...LEAD_SOURCES.map((s) => `crm.sources.${s}`),
      ...ORG_ROLES.map((r) => `team.roles.${r}`),
      "validation.required", "validation.tooShort", "validation.tooLong", "validation.email", "validation.phone",
      "validation.slug", "validation.emailOrPhone", "validation.passwordLength", "validation.passwordStrength", "validation.invalidId",
    ];
    for (const k of keys) expect(t(k), k).not.toBe(k);
  });

  it("interpolates params and falls back to key for unknown entries", () => {
    const t = createTranslator(en as Dictionary);
    expect(t("dashboard.welcome", { name: "Tom" })).toBe("Hello, Tom");
    expect(t("missing.key")).toBe("missing.key");
  });

  it("labels audit actions and falls back to the raw code", () => {
    const t = createTranslator(he as Dictionary);
    expect(auditLabel(t, "contacts.update")).toBe("איש קשר עודכן");
    expect(auditLabel(t, "weird.action")).toBe("weird.action");
  });

  it("negotiates locale from Accept-Language and maps directions", () => {
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
    expect(negotiateLocale("ar-AE,ar;q=0.9")).toBe("ar");
    expect(negotiateLocale("iw-IL")).toBe("he");
    expect(negotiateLocale("fr-FR, de;q=0.5")).toBe("he");
    expect(negotiateLocale(null)).toBe("he");
    expect(dirOf("he")).toBe("rtl");
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
  });
});
