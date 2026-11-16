import { describe, expect, it } from "vitest";
import {
  contextFrom,
  createDraftDetector,
  DEFAULT_SETTINGS,
  decideOnSend,
  draftTag,
  quickReasons,
  settingsFrom,
  statusLine,
  stripHtml,
  type IntercomConversationSnapshot,
} from "./capture";

const draftText = "<p>Hi Dana,</p><p>I checked your account and your refund is processing. You should see it within 3-5 business days.</p>";
const conversation: IntercomConversationSnapshot = {
  id: "c-48213",
  source: { subject: "Refund status", body: "<p>When will I get my refund?</p>", author: { type: "user", email: "dana@example.com" } },
  conversation_parts: { conversation_parts: [
    { id: "p1", body: "<p>Checking billing now.</p>", part_type: "note", author: { type: "admin", name: "Ray" } },
    { id: "p2", body: "<p>It has been a week.</p>", part_type: "comment", author: { type: "user", email: "dana@example.com" } },
  ]},
};

describe("settings", () => {
  it("parses defaults and overrides", () => {
    expect(settingsFrom({})).toEqual(DEFAULT_SETTINGS);
    const s = settingsFrom({ overturn_base_url: "https://ov.internal/", agent: "support-reply", require_reason: "false", min_draft_chars: "100", reason_pack: "claims" });
    expect(s.baseUrl).toBe("https://ov.internal");
    expect(s.requireReason).toBe(false);
    expect(s.minDraftChars).toBe(100);
    expect(s.reasonPack).toBe("claims");
  });
  it("uses support reasons by default", () => {
    expect(quickReasons(DEFAULT_SETTINGS).map((r) => r.code)).toContain("wrong_answer");
  });
});

describe("draft detection and tags", () => {
  it("detects inserted drafts and tags Fin/assist as draft:ai when known", () => {
    const d = createDraftDetector({ minDraftChars: 80 });
    d.onComposer("", "unknown", 0);
    const found = d.onComposer("x".repeat(200), "ai", 500);
    expect(found?.origin).toBe("inserted");
    expect(found?.kind).toBe("ai");
    if (found) expect(draftTag(found)).toBe("draft:ai");
  });
  it("tags manual human drafts distinctly", () => {
    const d = createDraftDetector({ minDraftChars: 80 });
    const found = d.onComposer("y".repeat(120), "manual", 10);
    expect(found?.kind).toBe("manual");
    if (found) expect(draftTag(found)).toBe("draft:manual");
  });
});

describe("context", () => {
  it("builds conversation context", () => {
    expect(stripHtml("<p>a</p><br><div>b</div>")).toBe("a\nb");
    const ctx = contextFrom(conversation);
    expect(ctx[0]).toEqual({ role: "customer", author: "dana@example.com", content: "When will I get my refund?", at: null });
    expect(ctx[1]).toEqual({ role: "note", author: "Ray", content: "Checking billing now.", at: null });
    expect(ctx[2].role).toBe("customer");
  });
});

describe("decideOnSend", () => {
  const draft = { text: draftText, origin: "inserted" as const, kind: "ai" as const, at: 1000 };
  const base = { conversation, draft, draftFields: {}, reasonCode: null as string | null, reason: "", actor: "ray@support.com", settings: { ...DEFAULT_SETTINGS, requireReason: false } };

  it("builds intercom capture payload", () => {
    const d = decideOnSend({ ...base, now: 4500, send: { text: draftText } });
    expect(d.action).toBe("capture");
    if (d.action !== "capture") return;
    expect(d.body.source).toBe("intercom");
    expect(d.body.externalId).toBe("ic:c-48213");
    expect(d.body.tags).toEqual(["draft:ai"]);
    expect(d.body.secondsToSend).toBe(3.5);
  });

  it("requires reason for changed replies", () => {
    const d = decideOnSend({ ...base, settings: DEFAULT_SETTINGS, send: { text: draftText.replace("3-5 business days", "7-10 business days") } });
    expect(d).toEqual({ action: "need-reason", changedFields: [] });
  });

  it("skips when no draft or empty", () => {
    expect(decideOnSend({ ...base, draft: null, send: { text: "x" } })).toEqual({ action: "skip", why: "no-draft" });
    expect(decideOnSend({ ...base, send: { text: "" } })).toEqual({ action: "skip", why: "empty" });
  });
});

describe("statusLine", () => {
  it("describes states", () => {
    expect(statusLine(null, null)).toBe("Waiting for a draft");
    expect(statusLine({ text: "one two three", origin: "manual", kind: "manual", at: 1 }, null)).toBe("Draft marked by you · 3 words");
  });
});
