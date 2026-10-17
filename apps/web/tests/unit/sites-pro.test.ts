import { describe, expect, it } from "vitest";
import { FREE_TEMPLATES, TEMPLATES, fontsHref, onColor, resolveTheme, templateByKey, withAlpha } from "@/lib/site/templates";
import { LEGAL_KEYS, legalText, parseLegal } from "@/lib/site/legal";
import { customerPrice, dnsRecords, domainCandidates, domainContactSchema, normalizeDomain, pricingFromEnv, registrarPhone } from "@/lib/site/domain-core";
import { normalizeAiSite, siteJsonInstructionsPro } from "@/lib/ai/site-json";
import { siteSchema } from "@scc/shared/engagement";

/** Wave 13 — professional websites: templates, legal pages, domains, AI output. */
describe("design templates", () => {
  it("10 distinct templates, 3 free, every font known", () => {
    expect(TEMPLATES).toHaveLength(10);
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(10);
    expect(FREE_TEMPLATES).toEqual(["classic", "minimal", "fresh"]);
    expect(new Set(TEMPLATES.map((t) => `${t.hero}/${t.cards}/${t.bg}`)).size).toBeGreaterThanOrEqual(8);
    expect(templateByKey("nope").key).toBe("classic");
  });
  it("resolves the business's choices over the template defaults; bad input falls back", () => {
    const r = resolveTheme({ template: "luxe", accent: "#112233", font: "heebo", radius: "round", animations: false });
    expect(r).toMatchObject({ accent: "#112233", accent2: "#E9DCC0", display: "heebo", body: "heebo", radius: "round", animations: false, mode: "dark" });
    const bad = resolveTheme({ template: "luxe", accent: "red", font: "comic" });
    expect(bad).toMatchObject({ accent: "#C8A96A", display: "frank", body: "assistant", radius: "sharp" });
    // a light template switched to dark gets a dark palette
    expect(resolveTheme({ template: "fresh", mode: "dark" }).palette.bg).toBe("#0b1020");
  });
  it("readable text on the brand colour; alpha tints; Google Fonts URL", () => {
    expect(onColor("#FFB547")).toBe("#0b0b14");
    expect(onColor("#0B3D91")).toBe("#ffffff");
    expect(withAlpha("#112233", 0.5)).toBe("#11223380");
    expect(fontsHref(["frank", "assistant", "frank"])).toBe("https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Assistant:wght@300;400;600;800&display=swap");
  });
});

describe("legal pages", () => {
  const input = { siteName: "פט-ליין", legalName: "פט-ליין בע״מ", businessId: "515555555", email: "hi@pet.co.il", phone: "03-1234567", a11yContact: "דנה 050-0000000", hasForms: true };
  it("Hebrew texts use the business details and cite the Israeli rules", () => {
    const privacy = legalText("privacy", "he", input);
    expect(privacy).toContain("פט-ליין בע״מ (ח.פ./ע.מ. 515555555)");
    expect(privacy).toContain("חוק הגנת הפרטיות");
    expect(privacy).toContain("hi@pet.co.il");
    expect(legalText("accessibility", "he", input)).toContain("ת״י 5568");
    expect(legalText("accessibility", "he", input)).toContain("רכז/ת הנגישות: דנה 050-0000000");
    expect(legalText("terms", "he", input)).toMatch(/© \d{4} כל הזכויות שמורות/);
  });
  it("English for other languages; every page parses into headings, paragraphs and lists", () => {
    for (const k of LEGAL_KEYS) {
      const parts = parseLegal(legalText(k, "en", input));
      expect(parts.some((p) => p.kind === "h")).toBe(true);
      expect(parts.some((p) => p.kind === "p")).toBe(true);
    }
    expect(parseLegal("## A\n\n- x\n- y\n\nhello")).toEqual([{ kind: "h", text: "A" }, { kind: "ul", items: ["x", "y"] }, { kind: "p", text: "hello" }]);
  });
});

describe("domains", () => {
  it("normalises what the customer typed", () => {
    expect(normalizeDomain("https://www.My-Shop.co.il/about?x=1")).toBe("my-shop.co.il");
    expect(normalizeDomain("pet.com.")).toBe("pet.com");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("-bad-.com")).toBeNull();
  });
  it("search candidates: the exact domain + the name on popular endings", () => {
    expect(domainCandidates("pet-line.com", 4)).toEqual(["pet-line.com", "pet-line.co.il", "pet-line.co", "pet-line.net"]);
    expect(domainCandidates("Pet Line")[0]).toBe("petline.com");
  });
  it("customer price = cost + commission (percent, with a minimum), rounded up", () => {
    const p = pricingFromEnv({ DOMAIN_MARKUP_PERCENT: "30", DOMAIN_MIN_FEE_USD: "5" });
    expect(customerPrice(11.25, p)).toEqual({ price: 16.25, fee: 5 });
    expect(customerPrice(40, p)).toEqual({ price: 52, fee: 12 });
    expect(pricingFromEnv({})).toEqual({ markupPercent: 30, minFee: 5, maxCost: 60 });
  });
  it("DNS records for apex / .co.il / subdomain + verification TXT", () => {
    expect(dnsRecords("pet.co.il").map((r) => `${r.type} ${r.name}`)).toEqual(["A @", "CNAME www"]);
    expect(dnsRecords("shop.pet.com")).toEqual([{ type: "CNAME", name: "shop", value: "cname.vercel-dns.com" }]);
    expect(dnsRecords("pet.com", [{ type: "TXT", domain: "_vercel.pet.com", value: "vc-domain-verify=abc" }]).pop()).toEqual({ type: "TXT", name: "_vercel", value: "vc-domain-verify=abc" });
  });
  it("registrant contact: Israeli phone → E.164 → registrar format", () => {
    const c = domainContactSchema.parse({ firstName: "Dana", lastName: "Cohen", email: "d@x.io", phone: "050-123-4567", address1: "Herzl 1", city: "Tel Aviv", state: "Tel Aviv", zip: "6100001", country: "il" });
    expect(c.phone).toBe("+972501234567");
    expect(c.country).toBe("IL");
    expect(registrarPhone(c.phone)).toBe("+972.501234567");
    expect(registrarPhone("+14155550100")).toBe("+1.4155550100");
    expect(domainContactSchema.safeParse({ ...c, email: "bad" }).success).toBe(false);
  });
});

describe("AI site output (wave 13)", () => {
  const raw = {
    name: "פט-ליין",
    accent: "#E8590C",
    accent2: "#22aa88",
    template: "luxe",
    font: "frank",
    mode: "light",
    seo: { title: "t", description: "d" },
    blocks: [
      { type: "hero", data: { title: "כותרת", subtitle: "s", cta_label: "c", cta_href: "#contact" } },
      { type: "stats", data: { title: "במספרים", items: [{ value: "12", label: "שנות ניסיון" }] } },
      { type: "pricing", data: { title: "מחירון", items: [{ name: "בסיס", price: "₪150", features: ["רחצה", "תספורת"], highlight: true }] } },
      { type: "testimonials", data: { title: "לקוחות", items: [{ name: "דנה", quote: "מדהים", rating: 9 }] } },
      { type: "video", data: { title: "v", url: "https://evil.example.com/x" } },
      { type: "logos", data: { items: ["Acme", { name: "Globex" }] } },
      { type: "contact", data: { title: "צור קשר", phone: "03-1234567" } },
    ],
  };
  it("keeps the new sections (validated) and the chosen template when allowed", () => {
    const s = normalizeAiSite(raw, "full", {}, "x", { templates: ["classic", "luxe"] })!;
    expect(s.theme).toMatchObject({ template: "luxe", accent2: "#22aa88", font: "frank", mode: "light" });
    const types = s.blocks.map((b) => b.type);
    expect(types).toEqual(["hero", "stats", "pricing", "testimonials", "logos", "contact"]); // unsafe video dropped
    const pricing = s.blocks.find((b) => b.type === "pricing")!;
    expect(pricing.type === "pricing" && pricing.data.items[0]).toMatchObject({ features: "רחצה\nתספורת", highlight: "yes", cta_href: "#contact" });
    const t = s.blocks.find((b) => b.type === "testimonials")!;
    expect(t.type === "testimonials" && t.data.items[0]!.rating).toBe("5");
    expect(siteSchema.safeParse({ name: s.name, slug: "abc-123", theme: s.theme, seo: s.seo, blocks: s.blocks }).success).toBe(true);
  });
  it("a premium template the plan does not include falls back to the first allowed one", () => {
    expect(normalizeAiSite(raw, "full", {}, "x", { templates: ["classic", "minimal", "fresh"] })!.theme.template).toBe("classic");
    // older callers (no templates option) keep the original theme shape
    expect(normalizeAiSite({ ...raw, template: undefined, accent2: undefined, font: undefined }, "landing", {}, "x")!.theme).toEqual({ accent: "#E8590C", mode: "light" });
  });
  it("the pro prompt lists the allowed templates and forbids invented reviews / prices", () => {
    const p = siteJsonInstructionsPro("full", "he", {}, ["classic", "fresh"]);
    expect(p).toContain('["classic","fresh"]');
    expect(p).toContain("never invent reviews");
    expect(p).toContain("ONLY with prices the customer gave");
  });
});
