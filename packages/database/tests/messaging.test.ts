import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db, createTestDatabase, dbAvailable } from "./harness";

const d = dbAvailable ? describe : describe.skip;

/** 0017: channel accounts (encrypted secrets hidden from users), inbound messages → contacts/conversations. */
d("messaging: channel accounts, conversations, inbound ingest (real Postgres)", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let owner: string;
  let support: string;
  let analyst: string;
  let stranger: string;
  let org: string;
  let token: string;

  const ingest = async (args: { chat: string; name?: string; phone?: string | null; text: string; mid: string; kind?: string; tok?: string }) => {
    await db.q(`set role service_role`);
    try {
      return (
        await db.q<{ r: Record<string, unknown> }>(`select public.ingest_channel_message($1, $2, $3, $4, $5, $6, $7, null) as r`, [
          args.tok ?? token,
          args.kind ?? "whatsapp",
          args.chat,
          args.name ?? null,
          args.phone ?? null,
          args.text,
          args.mid,
        ])
      )[0]!.r;
    } finally {
      await db.q(`reset role`);
    }
  };

  beforeAll(async () => {
    const t = await createTestDatabase();
    drop = t.drop;
    db = await Db.connect(t.url);
    owner = await db.createUser("owner@m.test");
    support = await db.createUser("support@m.test");
    analyst = await db.createUser("analyst@m.test");
    stranger = await db.createUser("stranger@m.test");
    org = await db.as(owner, async (q) => (await q<{ id: string }>(`select public.create_organization('Msg Org', 'msg-org') as id`))[0]!.id, true);
    await db.q(`update organizations set plan = 'business' where id = $1`, [org]);
    await db.q(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'support'), ($1, $3, 'analyst')`, [org, support, analyst]);
    token = await db.as(owner, async (q) =>
      (await q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name, config, secret_enc) values ($1, 'whatsapp', 'wa', '{"phone_number_id":"123"}', 'v1:cipher') returning webhook_token`, [org]))[0]!.webhook_token,
    true);
  });

  afterAll(async () => {
    await db?.end();
    await drop?.();
  });

  it("only integrations.manage can connect channels; the ciphertext is never readable by users", async () => {
    await expect(db.as(support, (q) => q(`insert into channel_accounts (organization_id, kind) values ($1, 'telegram')`, [org]))).rejects.toThrow();
    await expect(db.as(owner, (q) => q(`select secret_enc from channel_accounts where organization_id = $1`, [org]))).rejects.toThrow(/permission denied/);
    const visible = await db.as(support, (q) => q<{ kind: string }>(`select kind, config from channel_accounts where organization_id = $1`, [org]));
    expect(visible.map((r) => r.kind)).toEqual(["whatsapp"]);
    expect(await db.as(stranger, (q) => q(`select id from channel_accounts`))).toHaveLength(0);
  });

  it("first inbound message creates contact + conversation, de-duplicates, and fires message.received", async () => {
    const rule = (await db.q<{ id: string }>(`insert into automations (organization_id, name, trigger_type, trigger_config, actions) values ($1, 'wa', 'message.received', '{"channel":"whatsapp"}', '[{"type":"add_tag","config":{"tag":"whatsapp-lead"}}]') returning id`, [org]))[0]!.id;
    const r1 = await ingest({ chat: "972501234567", name: "Dana", phone: "+972501234567", text: "שלום, מעוניינת", mid: "wamid.1" });
    expect(r1.ok).toBe(true);
    const dup = await ingest({ chat: "972501234567", name: "Dana", phone: "+972501234567", text: "שלום, מעוניינת", mid: "wamid.1" });
    expect(dup.duplicate).toBe(true);
    const r2 = await ingest({ chat: "972501234567", name: "Dana", phone: "+972501234567", text: "עוד הודעה", mid: "wamid.2" });
    expect(r2.conversation_id).toBe(r1.conversation_id);

    const c = (await db.q<{ first_name: string; phone: string; source: string }>(`select first_name, phone, source from contacts where id = $1`, [r1.contact_id]))[0]!;
    expect(c).toEqual({ first_name: "Dana", phone: "+972501234567", source: "whatsapp" });
    const conv = (await db.q<{ unread_count: number; last_message_preview: string }>(`select unread_count, last_message_preview from conversations where id = $1`, [r1.conversation_id]))[0]!;
    expect(conv).toEqual({ unread_count: 2, last_message_preview: "עוד הודעה" });
    expect(await db.q(`select 1 from messages where conversation_id = $1`, [r1.conversation_id])).toHaveLength(2);
    expect(await db.q(`select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = $1 and t.name = 'whatsapp-lead'`, [r1.contact_id])).toHaveLength(1);
    expect((await db.q<{ run_count: number }>(`select run_count from automations where id = $1`, [rule]))[0]!.run_count).toBe(2);
  });

  it("matches an existing contact stored with a local number", async () => {
    const existing = (await db.q<{ id: string }>(`insert into contacts (organization_id, first_name, phone) values ($1, 'Yossi', '0527654321') returning id`, [org]))[0]!.id;
    const r = await ingest({ chat: "972527654321", name: "Y", phone: "+972527654321", text: "hi", mid: "wamid.3" });
    expect(r.contact_id).toBe(existing);
  });

  it("RLS: inbox.read sees conversations; analyst (no inbox.read) and strangers don't; nobody inserts messages directly", async () => {
    expect((await db.as(support, (q) => q(`select id from conversations where organization_id = $1`, [org]))).length).toBeGreaterThan(0);
    expect(await db.as(analyst, (q) => q(`select id from conversations where organization_id = $1`, [org]))).toHaveLength(0);
    expect(await db.as(stranger, (q) => q(`select id from messages`))).toHaveLength(0);
    const conv = (await db.q<{ id: string }>(`select id from conversations limit 1`))[0]!.id;
    await expect(db.as(owner, (q) => q(`insert into messages (organization_id, conversation_id, direction, body) values ($1, $2, 'out', 'x')`, [org, conv]))).rejects.toThrow();
    await db.as(support, (q) => q(`update conversations set unread_count = 0, status = 'closed' where id = $1`, [conv]), true);
    expect((await db.q<{ status: string }>(`select status from conversations where id = $1`, [conv]))[0]!.status).toBe("closed");
  });

  it("unknown token / wrong kind is rejected; ingest is service-role only", async () => {
    await expect(ingest({ chat: "1", text: "x", mid: "m", tok: "f".repeat(48) })).rejects.toThrow(/not_found/);
    await expect(ingest({ chat: "1", text: "x", mid: "m", kind: "telegram" })).rejects.toThrow(/not_found/);
    await expect(db.as(owner, (q) => q(`select public.ingest_channel_message($1, 'whatsapp', '1', null, null, 'x', 'y', null)`, [token]))).rejects.toThrow(/permission denied/);
  });

  it("telegram contacts are matched by telegram id on later conversations", async () => {
    const tg = await db.as(owner, async (q) =>
      (await q<{ webhook_token: string }>(`insert into channel_accounts (organization_id, kind, name) values ($1, 'telegram', 'bot') returning webhook_token`, [org]))[0]!.webhook_token,
    true);
    const r = await ingest({ kind: "telegram", tok: tg, chat: "55501", name: "Avi Cohen", text: "/start", mid: "1" });
    const c = (await db.q<{ first_name: string; last_name: string; custom_fields: { telegram_id: string } }>(`select first_name, last_name, custom_fields from contacts where id = $1`, [r.contact_id]))[0]!;
    expect([c.first_name, c.last_name]).toEqual(["Avi", "Cohen"]);
    expect(c.custom_fields.telegram_id).toBe("55501");
  });
});
