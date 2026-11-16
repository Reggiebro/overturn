import { describe, expect, it } from "vitest";
import { contextFrom, createDraftDetector, DEFAULT_SETTINGS, decideOnSend, quickReasons, settingsFrom, statusLine, stripHtml, type FrontConversationSnapshot } from "./capture";

const draftText = "<p>Hi Dana,</p><p>We can offer a replacement and ship it within 2 business days. Reply here if you prefer a refund instead.</p>";
const conversation: FrontConversationSnapshot = {
  id: "cnv_48213",
  subject: "Damaged item",
  recipient: { handle: "dana@example.com", name: "Dana" },
  messages: [
    { id: "m1", body: "<p>My item arrived damaged.</p>", author: { email: "dana@example.com" }, is_inbound: true, created_at: 1731758400 },
    { id: "m2", text: "Checked order and photos.", author: { name: "Ray" }, is_inbound: false, type: "comment" },
  ],
};

describe("settings", () => {
  it("parses defaults and overrides", () => {
    expect(settingsFrom({})).toEqual(DEFAULT_SETTINGS);
    const s = settingsFrom({ overturn_base_url: "https://ov.internal/", agent: "support-reply", require_reason: "false", reason_pack: "claims", min_draft_chars: "120" });
    expect(s.baseUrl).toBe("https://ov.internal");
    expect(s.requireReason).toBe(false);
    expect(s.reasonPack).toBe("claims");
    expect(s.minDraftChars).toBe(120);
  });
  it("supports support and claims reason packs", () => {
    expect(quickReasons(DEFAULT_SETTINGS).map((r) => r.code)).toContain("wrong_answer");
    expect(quickReasons(settingsFrom({ reason_pack: "claims" })).map((r) => r.code)).toContain("wrong_coverage_decision");
  });
});

describe("draft detection", () => {
  it("detects inserted drafts", () => {
    const d = createDraftDetector({ minDraftChars: 80 });
    d.onComposer("", 0);
    expect(d.onComposer("x".repeat(200), 500)?.origin).toBe("inserted");
  });
});

describe("context", () => {
  it("builds conversation context", () => {
    expect(stripHtml("<p>a</p><br>b")).toBe("a\nb");
    expect(contextFrom(conversation)).toEqual([
      { role: "customer", author: "dana@example.com", content: "My item arrived damaged.", at: "2024-11-16T12:00:00.000Z" },
      { role: "note", author: "Ray", content: "Checked order and photos.", at: null },
    ]);
  });
});

describe("decideOnSend", () => {
  const draft = { text: draftText, origin: "inserted" as const, at: 1000 };
  const base = { conversation, draft, draftFields: {}, reasonCode: null as string | null, reason: "", actor: "ray@support.com", settings: { ...DEFAULT_SETTINGS, requireReason: false } };

  it("builds front capture payload", () => {
    const d = decideOnSend({ ...base, now: 4300, send: { text: draftText } });
    expect(d.action).toBe("capture");
    if (d.action !== "capture") return;
    expect(d.body.source).toBe("front");
    expect(d.body.externalId).toBe("fr:cnv_48213");
    expect(d.body.secondsToSend).toBe(3.3);
    expect(d.changed).toBe(false);
  });

  it("blocks changed send when reason required", () => {
    const d = decideOnSend({ ...base, settings: DEFAULT_SETTINGS, send: { text: draftText.replace("2 business days", "5 business days") } });
    expect(d).toEqual({ action: "need-reason", changedFields: [] });
  });

  it("captures changed send with reason", () => {
    const d = decideOnSend({ ...base, reasonCode: "wrong_amount_or_date", reason: "Corrected shipping window", send: { text: draftText.replace("2 business days", "5 business days") } });
    expect(d.action).toBe("capture");
    if (d.action !== "capture") return;
    expect(d.changed).toBe(true);
    expect(d.body.reasonCode).toBe("wrong_amount_or_date");
  });
});

describe("statusLine", () => {
  it("describes states", () => {
    expect(statusLine(null, null)).toBe("Waiting for a draft");
    expect(statusLine({ text: "one two three", origin: "manual", at: 1 }, null)).toBe("Draft marked by you · 3 words");
  });
});
