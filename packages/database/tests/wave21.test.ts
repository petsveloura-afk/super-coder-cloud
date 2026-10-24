import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** Wave 21 (real Postgres): an automatic message from the phone never stops the agent; handoffs keep their reason. */
d("wave 21 (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let org: string;
  let tok: string;

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@w21.test", "Owner TwentyOne");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('TwentyOne', 'twentyone-biz') as id`))[0]!.id, true);
    tok = (await db.q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name, config) values ($1, 'whatsapp_qr', 'WhatsApp', '{"state":"connected"}') returning webhook_token`, [org]))[0]!.webhook_token;
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  const conv = async (chat: string) =>
    (await db.q<{ id: string; ai_mode: string; ai_note: string | null; owner_takeover_at: string | null }>(`select id, ai_mode, ai_note, owner_takeover_at from conversations where organization_id = $1 and channel = 'whatsapp_qr' and external_id = $2`, [org, chat]))[0]!;

  it("an automatic greeting from the phone is shown in the chat, the agent keeps the conversation", async () => {
    await db.q(`select public.ingest_channel_message_v2($1, 'whatsapp_qr', '972501112233', 'Dana', '+972501112233', null, 'היי, מה המחירים?', 'IN1')`, [tok]);
    const r = (await db.q<{ r: { ok: boolean; takeover: boolean } }>(`select public.ingest_owner_message_v2($1, 'whatsapp_qr', '972501112233', 'שלום! תודה שפנית, נחזור אליך בהקדם', 'GREET1', null, false, 'instant_reply') as r`, [tok]))[0]!.r;
    expect(r).toMatchObject({ ok: true, takeover: false });
    const c = await conv("972501112233");
    expect(c.ai_mode).toBe("auto");
    expect(c.owner_takeover_at).toBeNull();
    const m = (await db.q<{ meta: Record<string, unknown>; direction: string }>(`select meta, direction from messages where conversation_id = $1 and external_id = 'GREET1'`, [c.id]))[0]!;
    expect(m).toMatchObject({ direction: "out", meta: { owner: true, device: "phone", auto: "instant_reply" } });
    // the same phone message again (WhatsApp re-sync) is stored once
    const again = (await db.q<{ r: { duplicate: boolean } }>(`select public.ingest_owner_message_v2($1, 'whatsapp_qr', '972501112233', 'שלום! תודה שפנית, נחזור אליך בהקדם', 'GREET1', null, false, 'instant_reply') as r`, [tok]))[0]!.r;
    expect(again.duplicate).toBe(true);
  });

  it("the owner typing himself takes over, with the reason for the inbox", async () => {
    const r = (await db.q<{ r: { takeover: boolean } }>(`select public.ingest_owner_message_v2($1, 'whatsapp_qr', '972501112233', 'היי דנה, כאן שירה', 'OWN1') as r`, [tok]))[0]!.r;
    expect(r.takeover).toBe(true);
    const c = await conv("972501112233");
    expect(c.ai_mode).toBe("human");
    expect(c.ai_note).toBe("owner_phone");
    expect(c.owner_takeover_at).not.toBeNull();
    await expect(db.q(`select public.ingest_owner_message_v2($1, 'messenger', '1', 'x', 'm')`, [tok])).rejects.toThrow(/invalid_kind/);
  });

  it("a handoff keeps its reason; the wave-12 function still works as before", async () => {
    await db.q(`select public.ingest_channel_message_v2($1, 'whatsapp_qr', '972509990000', 'Ron', '+972509990000', null, 'אני רוצה נציג', 'IN2')`, [tok]);
    const c = await conv("972509990000");
    await db.q(`select public.ai_handoff($1, 'customer_asked')`, [c.id]);
    expect(await conv("972509990000")).toMatchObject({ ai_mode: "human", ai_note: "customer_asked" });
    // a second handoff on a human conversation changes nothing (same as before)
    await db.q(`select public.ai_handoff($1, 'angry_customer')`, [c.id]);
    expect((await conv("972509990000")).ai_note).toBe("customer_asked");
    const old = (await db.q<{ r: { owner: boolean } }>(`select public.ingest_owner_message($1, 'whatsapp_qr', '972507770000', 'שלום', 'OLD1') as r`, [tok]))[0]!.r;
    expect(old.owner).toBe(true);
    expect((await conv("972507770000")).ai_mode).toBe("human");
    // a note longer than allowed is cut, never an error
    await db.q(`select public.ingest_channel_message_v2($1, 'whatsapp_qr', '972506660000', 'Lea', null, null, 'שלום', 'IN3')`, [tok]);
    await db.q(`select public.ai_handoff($1, $2)`, [(await conv("972506660000")).id, "x".repeat(500)]);
    expect((await conv("972506660000")).ai_note).toHaveLength(200);
  });
});
