import { describe, expect, it } from "vitest";
import { commentsFromIgMedia, commentsFromPosts, messagesFromConversations, missingPageFields } from "@/lib/channels/meta-sync-core";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("wave 41 — Meta inbound safety net (additive)", () => {
  it("detects a Page that is not subscribed to messages / feed", () => {
    expect(missingPageFields({ data: [] }, "111")).toEqual(["messages", "feed"]);
    expect(missingPageFields({ data: [{ id: "999", subscribed_fields: ["messages", "feed"] }] }, "111")).toEqual(["messages", "feed"]);
    expect(missingPageFields({ data: [{ id: "111", subscribed_fields: ["messages"] }] }, "111")).toEqual(["feed"]);
    expect(missingPageFields({ data: [{ id: 111, subscribed_fields: ["messages", "feed", "message_echoes"] }] }, "111")).toEqual([]);
    expect(missingPageFields(null, "111")).toEqual(["messages", "feed"]);
  });

  it("turns Page post comments into webhook-shaped comments (skips the page's own, old and empty ones)", () => {
    const json = {
      data: [
        {
          id: "100_1",
          comments: {
            data: [
              { id: "100_1_a", message: "כמה עולה?", created_time: ago(30), from: { id: "555", name: "דנה" } },
              { id: "100_1_b", message: "Thanks!", created_time: ago(20), from: { id: "100", name: "Page" } },
              { id: "100_1_c", message: "old", created_time: ago(60 * 40), from: { id: "556" } },
              { id: "100_1_d", message: "  ", created_time: ago(5), from: { id: "557" } },
              { id: "100_1_e", message: "reply", created_time: ago(4), from: { id: "558" }, parent: { id: "100_1_a" } },
            ],
          },
        },
      ],
    };
    const out = commentsFromPosts("100", json, NOW - 12 * 3_600_000);
    expect(out.map((c) => c.commentId)).toEqual(["100_1_a", "100_1_e"]);
    expect(out[0]).toMatchObject({ platform: "facebook", accountId: "100", postId: "100_1", parentId: null, authorId: "555", authorName: "דנה", verb: "add" });
    expect(out[1]!.parentId).toBe("100_1_a");
  });

  it("turns Instagram media comments into comments and skips the account's own replies", () => {
    const json = { data: [{ id: "m1", comments: { data: [{ id: "c1", text: "price?", timestamp: ago(10), username: "buyer" }, { id: "c2", text: "sent!", timestamp: ago(9), username: "MyShop" }] } }] };
    const out = commentsFromIgMedia("900", "@myshop", json, NOW - 3_600_000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ platform: "instagram", accountId: "900", commentId: "c1", postId: "m1", authorName: "buyer" });
  });

  it("returns only the customer messages nobody has answered yet, oldest first", () => {
    const json = {
      data: [
        {
          id: "t_1",
          messages: {
            data: [
              { id: "m_3", message: "hello?", created_time: ago(5), from: { id: "777", name: "Avi" } },
              { id: "m_2", message: "I need a site", created_time: ago(8), from: { id: "777", name: "Avi" } },
              { id: "m_1", message: "welcome 👋", created_time: ago(12), from: { id: "100" } },
              { id: "m_0", message: "hi", created_time: ago(15), from: { id: "777" } },
            ],
          },
        },
      ],
    };
    const out = messagesFromConversations("messenger", "100", [], json, NOW - 3 * 3_600_000);
    expect(out.map((m) => m.mid)).toEqual(["m_2", "m_3"]);
    expect(out[0]).toMatchObject({ platform: "messenger", accountId: "100", senderId: "777", echo: false, senderName: "Avi" });
  });

  it("skips a thread whose latest message was sent by the business (already answered)", () => {
    const json = { data: [{ id: "t", messages: { data: [{ id: "m_9", message: "we sent you the details", created_time: ago(2), from: { id: "100" } }, { id: "m_8", message: "price?", created_time: ago(6), from: { id: "777" } }] } }] };
    expect(messagesFromConversations("messenger", "100", [], json, NOW - 3_600_000)).toEqual([]);
  });

  it("ignores messages older than the window and Instagram messages sent by the account or its Page", () => {
    const old = { data: [{ id: "t", messages: { data: [{ id: "m_1", message: "old", created_time: ago(60 * 10), from: { id: "777" } }] } }] };
    expect(messagesFromConversations("messenger", "100", [], old, NOW - 3 * 3_600_000)).toEqual([]);
    const ig = { data: [{ id: "t", messages: { data: [{ id: "m_5", message: "ok", created_time: ago(1), from: { id: "900" } }, { id: "m_4", message: "q", created_time: ago(3), from: { id: "321" } }] } }] };
    expect(messagesFromConversations("instagram", "900", ["100"], ig, NOW - 3_600_000)).toEqual([]);
  });
});
