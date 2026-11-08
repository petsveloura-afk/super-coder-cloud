import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const inserts: { table: string; row: Row }[] = [];

/** a chainable, awaitable stand-in for a Supabase query builder */
function chain(result: unknown): unknown {
  const c: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      return () => c;
    },
  });
  return c;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => chain({ data: { id: "conv-1", channel: "web", external_id: "visitor-1" }, error: null }),
      insert: (row: Row) => {
        inserts.push({ table, row });
        return chain({ data: { id: "msg-1" }, error: null });
      },
      update: () => chain({ data: null, error: null }),
    }),
  }),
}));

async function send(text: string, opts?: { aiAgentId?: string | null; meta?: Record<string, unknown> }, sentBy?: string) {
  const { sendToConversation } = await import("@/lib/channels/send-message");
  return sendToConversation("org-1", "conv-1", text, sentBy, opts);
}

const messageInserts = () => inserts.filter((i) => i.table === "messages").map((i) => i.row);

describe("wave A1 — sendToConversation guard wiring", () => {
  beforeEach(() => {
    inserts.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    delete process.env.OUTBOUND_GUARD;
    vi.restoreAllMocks();
  });

  it("an AI message with an unfilled placeholder is held: stored as failed with the draft, never delivered", async () => {
    const r = await send("שלום [שם הלקוח], התור שלך נקבע.", { aiAgentId: "agent-1", meta: { system: "x" } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("held_by_outbound_guard");
    expect(r.permanent).toBe(true);
    const rows = messageInserts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error).toBe("held_by_outbound_guard");
    expect((rows[0]!.meta as { held: { reasons: string[] }; system: string }).held.reasons).toContain("placeholder");
    expect((rows[0]!.meta as { system: string }).system).toBe("x");
  });

  it("an AI message with the model's thinking is cleaned and delivered", async () => {
    const r = await send("<think>customer wants a price</think>\nהמחיר הוא 80 ש\"ח.", { aiAgentId: "agent-1" });
    expect(r.ok).toBe(true);
    const rows = messageInserts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe("המחיר הוא 80 ש\"ח.");
    expect(rows[0]!.status).toBe("queued");
  });

  it("a normal AI message is delivered unchanged", async () => {
    const r = await send("שלום דנה! נשמח לראות אותך ביום שלישי.", { aiAgentId: "agent-1" });
    expect(r.ok).toBe(true);
    expect(messageInserts()[0]!.body).toBe("שלום דנה! נשמח לראות אותך ביום שלישי.");
  });

  it("a person's own message is never touched, even with brackets", async () => {
    const r = await send("שלום [שם הלקוח], זה הטקסט שכתבתי בעצמי", undefined, "user-1");
    expect(r.ok).toBe(true);
    expect(messageInserts()[0]!.body).toBe("שלום [שם הלקוח], זה הטקסט שכתבתי בעצמי");
  });

  it("OUTBOUND_GUARD=off sends AI text exactly as before", async () => {
    process.env.OUTBOUND_GUARD = "off";
    const r = await send("שלום [שם הלקוח]", { aiAgentId: "agent-1" });
    expect(r.ok).toBe(true);
    expect(messageInserts()[0]!.body).toBe("שלום [שם הלקוח]");
  });

  it("OUTBOUND_GUARD=clean removes thinking but does not hold", async () => {
    process.env.OUTBOUND_GUARD = "clean";
    const r = await send("<think>x</think>שלום [שם הלקוח]", { aiAgentId: "agent-1" });
    expect(r.ok).toBe(true);
    expect(messageInserts()[0]!.body).toBe("שלום [שם הלקוח]");
  });
});
