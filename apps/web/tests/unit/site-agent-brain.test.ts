import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_FACTS, applyFacts, factsCount, factsPrompt, imageSlots, photoQuery, placeImages, settingsFromFacts, usableReviews, type BusinessFacts } from "@/lib/ai/site-tools-core";
import { customerBrief, customerSignals, dayContext, deeperBrief, deeperLearning, hasCta, hookStyle, postQuality, qualityFeedback } from "@/lib/social/brain-plus-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
const get = (d: Record<string, unknown>, k: string) => k.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d);

const facts: BusinessFacts = {
  ...EMPTY_FACTS,
  name: "Dana Hair",
  phone: "052-405-9003",
  email: "hi@dana.example",
  address: "Herzl 1, Tel Aviv",
  products: [{ name: "Haircut", price: 120, description: "Wash + cut" }],
  reviews: usableReviews([
    { author: "Noa", rating: 5, body: "The best haircut I ever had, Dana really listens to what you want." },
    { author: "Avi", rating: 5, body: "Professional, on time and a great atmosphere in the salon every visit." },
    { author: "X", rating: 2, body: "Not good at all, waited a long time for nothing really." },
    { author: "Y", rating: 5, body: "short" },
  ]),
  knowledge: [{ title: "About", body: "Family salon since 2010 specialising in curly hair." }],
};

describe("site agent tools — real business facts", () => {
  it("keeps only reviews worth showing", () => {
    expect(facts.reviews.map((r) => r.author)).toEqual(["Noa", "Avi"]);
  });
  it("the prompt carries the facts and forbids inventing", () => {
    const p = factsPrompt(facts);
    expect(p).toContain("052-405-9003");
    expect(p).toContain("Haircut — ₪120");
    expect(p).toContain("REAL customer reviews");
    expect(p).toMatch(/never invent/i);
    expect(factsPrompt(EMPTY_FACTS)).toBe("");
    expect(factsCount(facts)).toBe(3 + 1 + 2 + 1);
  });
  it("fills contact details, replaces invented reviews with real ones and fills settings", () => {
    const site = { name: "x", blocks: [{ type: "hero", data: { title: "Hi", image_url: "" } }, { type: "testimonials", data: { title: "T", items: [{ name: "Fake", quote: "Invented" }] } }] };
    const r = applyFacts(site, facts, { contact: "Contact", testimonials: "Reviews" });
    const t = r.site.blocks.find((b) => b.type === "testimonials")!;
    expect((t.data.items as { name: string }[]).map((i) => i.name)).toEqual(["Noa", "Avi"]);
    const c = r.site.blocks.find((b) => b.type === "contact")!;
    expect(c.data).toMatchObject({ phone: "052-405-9003", email: "hi@dana.example", address: "Herzl 1, Tel Aviv" });
    expect(r.changed).toContain("contact_added");
    expect(site.blocks.find((b) => b.type === "contact")).toBeUndefined(); // the input is not mutated
    const st = settingsFromFacts({ phone: "kept" }, facts, "he");
    expect(st).toMatchObject({ phone: "kept", email: "hi@dana.example", legal_name: "Dana Hair", lang: "he", whatsapp_button: "052-405-9003" });
  });
  it("finds image slots and places free photos", () => {
    expect(photoQuery("A professional photo of a modern hair salon interior, warm light, no text")).toBe("hair salon interior warm light");
    const site = { name: "x", blocks: [{ type: "hero", data: { image_url: "" } }, { type: "about", data: { image_url: "" } }, { type: "gallery", data: { items: [{ url: "https://a/1.jpg", caption: "" }] } }] };
    const slots = imageSlots(site, "hair salon", 3);
    expect(slots.map((s) => s.kind)).toEqual(["hero", "about", "gallery", "gallery"]);
    const placed = placeImages(site, slots.map((slot, i) => ({ slot, url: `https://img/${i}.jpg` })));
    expect(placed.blocks[0]!.data.image_url).toBe("https://img/0.jpg");
    expect((placed.blocks[2]!.data.items as unknown[]).length).toBe(3);
    expect(placeImages(site, [{ slot: slots[0]!, url: "javascript:alert(1)" }]).blocks[0]!.data.image_url).toBe("");
  });
  it("the builder uses every tool and reports them", () => {
    const b = read("lib/ai/site-builder.ts");
    for (const x of ["loadBusinessFacts", "factsPrompt", "applyFacts", "settingsFromFacts", "freeSiteImages", "auditSite", "editSiteWithAI", "report"]) expect(b, x).toContain(x);
    expect(read("components/websites/ai-site-card.tsx")).toContain("BuildStages");
  });
});

describe("social brain — deeper understanding", () => {
  const post = (body: string, day: number, engagement: number) => ({ body, scheduled_at: `2026-11-0${day}T08:00:00Z`, pillar: null, media: "image" as const, engagement });
  it("recognises the opening style", () => {
    expect(hookStyle("מה הסוד לשיער מושלם?\nהנה")).toBe("question");
    expect(hookStyle("3 טיפים לשיער מתולתל")).toBe("number");
    expect(hookStyle("✨ חדש אצלנו")).toBe("emoji");
    expect(hookStyle("We opened in 2010 with one chair")).toBe("story");
    expect(hookStyle("The best cut in town")).toBe("statement");
    expect(hasCta("שלחו לנו הודעה")).toBe(true);
    expect(hasCta("just a nice day")).toBe(false);
  });
  it("learns hooks, days, emojis and calls to action from real numbers", () => {
    const d = deeperLearning([
      post("מה דעתכם?\nשלחו הודעה ✨✨", 1, 40),
      post("איך שומרים על צבע?\nהזמינו תור 💇‍♀️💇‍♀️", 1, 36),
      post("The best cut in town", 3, 5),
      post("Another plain statement", 4, 4),
    ]);
    expect(Object.keys(d.hookScores)).toEqual(expect.arrayContaining(["question", "statement"]));
    expect(d.hookScores.question!).toBeGreaterThan(d.hookScores.statement!);
    expect(d.bestDays[0]).toBe(0); // 2026-11-01 is a Sunday
    expect(d.emojiWorks).toBe(true);
    expect(d.ctaWorks).toBe(true);
    expect(deeperBrief(d, ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])).toContain("Sunday");
    expect(deeperLearning([post("a", 1, 1)]).bestDays).toEqual([]);
  });
  it("turns inbox messages into the questions customers really ask (no phones / emails kept)", () => {
    const s = customerSignals(["כמה עולה תספורת?", "כמה עולה תספורת ?", "אפשר לקבוע לשישי? 052-4059003", "mail me at a@b.co please about prices", "hi"]);
    expect(s.questions[0]).toBe("כמה עולה תספורת?");
    expect(s.questions.join(" ")).not.toMatch(/052|@/);
    expect(customerBrief(s)).toContain("כמה עולה תספורת?");
    expect(customerBrief({ questions: [], topics: [], count: 0 })).toBe("");
  });
  it("knows the day the post goes out", () => {
    expect(dayContext("2026-11-01", "he")).toContain("start of the work week");
    expect(dayContext("2026-11-05", "he")).toContain("weekend");
    expect(dayContext("bad", "he")).toBe("");
  });
  it("self-checks a draft and gives concrete feedback", () => {
    const weak = postQuality("a very long first line that goes on and on without stopping and keeps talking about the salon and the team and the chairs and more", "instagram");
    expect(weak.score).toBeLessThan(60);
    expect(qualityFeedback(weak)).toMatch(/call to action/);
    const good = postQuality("✨ שיער מתולתל בלי פריז?\nהסוד: מסכה פעם בשבוע.\nוגם ייבוש בפיזור.\nשלחו לנו הודעה לתור 💬\n#שיער #תלתלים #טיפוח #מספרה #תלאביב", "instagram");
    expect(good.score).toBeGreaterThanOrEqual(80);
  });
  it("the brain uses all of it and shows it", () => {
    const b = read("lib/social/brain.ts");
    for (const x of ["customerSignals", "deeperBrief", "dayContext", "postQuality", "deeperLearning"]) expect(b, x).toContain(x);
    expect(read("components/social/brain-panel.tsx")).toContain("social.brain.deep.hook");
  });
  it("texts exist in he, en and ar", () => {
    for (const l of ["he", "en", "ar"]) for (const k of ["social.brain.deep.hook", "social.brain.deep.hooks.question", "websites.buildStages.quality", "ai.siteBuiltPro"]) expect(get(dict(l), k), `${l}:${k}`).toBeTruthy();
  });
});
