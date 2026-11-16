import type { CaptureCreate, CaptureMessage } from "@overturn-ai/shared";
import {
  diffCaptureAnswers,
  normalizeCaptureText,
  REASON_PACKS,
  type ReasonCodeOption,
  type ReasonPack,
  reasonPackFrom,
} from "@overturn-ai/shared/capture";

export interface IntercomPart {
  id?: string | number;
  body?: string | null;
  part_type?: string | null;
  author?: { type?: string | null; id?: string | number | null; name?: string | null; email?: string | null } | null;
  created_at?: number | string | null;
}

export interface IntercomConversationSnapshot {
  id: string | number;
  source?: { subject?: string | null; body?: string | null; author?: { type?: string | null; email?: string | null; name?: string | null } | null } | null;
  conversation_parts?: { conversation_parts?: IntercomPart[] } | IntercomPart[] | null;
  contact?: { email?: string | null; name?: string | null } | null;
  fields?: Record<string, unknown>;
}

export interface AppSettings {
  baseUrl: string;
  agent: string;
  requireReason: boolean;
  minDraftChars: number;
  reasonPack: ReasonPack;
}

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: "https://api.overturn.run",
  agent: "support-reply",
  requireReason: true,
  minDraftChars: 80,
  reasonPack: "support",
};

export function settingsFrom(raw: Record<string, unknown>): AppSettings {
  const str = (k: string): string | null => {
    const v = raw[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const bool = (k: string, d: boolean): boolean => {
    const v = raw[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v === "true" || v === "1";
    return d;
  };
  const min = Number(str("min_draft_chars") ?? raw.min_draft_chars ?? "");
  return {
    baseUrl: (str("overturn_base_url") ?? DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
    agent: str("agent") ?? DEFAULT_SETTINGS.agent,
    requireReason: bool("require_reason", DEFAULT_SETTINGS.requireReason),
    minDraftChars: Number.isFinite(min) && min > 0 ? min : DEFAULT_SETTINGS.minDraftChars,
    reasonPack: reasonPackFrom(str("reason_pack")),
  };
}

export type DraftOrigin = "inserted" | "manual" | "recorded" | "preloaded";
export type DraftKind = "ai" | "manual" | "unknown";

export interface DraftState {
  text: string;
  origin: DraftOrigin;
  kind: DraftKind;
  runId?: string;
  model?: string | null;
  at: number;
}

export interface DraftDetector {
  onComposer(text: string, kindHint?: DraftKind, now?: number): DraftState | null;
  current(): DraftState | null;
  set(d: DraftState | null): void;
}

export function createDraftDetector(opts: { minDraftChars: number; typingWindowMs?: number }): DraftDetector {
  const window = opts.typingWindowMs ?? 1500;
  let draft: DraftState | null = null;
  let last = { text: "", at: 0 };
  let seen = false;
  return {
    onComposer(text, kindHint = "unknown", now = Date.now()) {
      const prev = last;
      const firstSight = !seen;
      seen = true;
      last = { text, at: now };
      if (draft) return null;
      const grew = text.length - prev.text.length;
      const jump = grew >= opts.minDraftChars && (prev.text.length < opts.minDraftChars / 2 || now - prev.at > window);
      const first = firstSight && text.length >= opts.minDraftChars;
      if (jump || first) {
        const origin: DraftOrigin = first ? "preloaded" : "inserted";
        const kind: DraftKind = kindHint !== "unknown" ? kindHint : origin === "inserted" ? "unknown" : "unknown";
        draft = { text, origin, kind, at: now };
        return draft;
      }
      return null;
    },
    current: () => draft,
    set: (d) => { draft = d; },
  };
}

export function stripHtml(html: string): string {
  return normalizeCaptureText(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

function partsOf(c: IntercomConversationSnapshot): IntercomPart[] {
  const p = c.conversation_parts;
  if (!p) return [];
  if (Array.isArray(p)) return p;
  return Array.isArray(p.conversation_parts) ? p.conversation_parts : [];
}

function roleOf(part: IntercomPart): CaptureMessage["role"] {
  if ((part.part_type ?? "").includes("note")) return "note";
  const t = (part.author?.type ?? "").toLowerCase();
  if (t === "user" || t === "lead" || t === "contact") return "customer";
  return "agent";
}

export function contextFrom(conversation: IntercomConversationSnapshot): CaptureMessage[] {
  const msgs: CaptureMessage[] = [];
  if (conversation.source?.body) {
    msgs.push({
      role: "customer",
      author: conversation.source.author?.email ?? conversation.source.author?.name ?? conversation.contact?.email ?? conversation.contact?.name ?? null,
      content: stripHtml(conversation.source.body),
      at: null,
    });
  }
  for (const part of partsOf(conversation)) {
    const content = stripHtml(part.body ?? "");
    if (!content) continue;
    msgs.push({
      role: roleOf(part),
      author: part.author?.email ?? part.author?.name ?? null,
      content,
      at: typeof part.created_at === "number" ? new Date(part.created_at * 1000).toISOString() : part.created_at ? String(part.created_at) : null,
    });
  }
  return msgs.filter((m) => m.content.trim().length > 0);
}

export interface PendingSend { text: string; fields?: Record<string, unknown>; }

export type SendDecision =
  | { action: "skip"; why: "no-draft" | "empty" }
  | { action: "capture"; body: CaptureCreate; changed: boolean; changedFields: string[] }
  | { action: "need-reason"; changedFields: string[] };

export function draftTag(d: DraftState): string {
  if (d.kind === "ai") return "draft:ai";
  if (d.kind === "manual") return "draft:manual";
  if (d.origin === "inserted") return "draft:unknown";
  return `draft:${d.origin}`;
}

export function decideOnSend(input: {
  conversation: IntercomConversationSnapshot;
  draft: DraftState | null;
  draftFields: Record<string, unknown>;
  send: PendingSend;
  reasonCode: string | null;
  reason: string;
  actor: string | null;
  settings: AppSettings;
  now?: number;
}): SendDecision {
  const { conversation, draft, send, settings } = input;
  const sentText = stripHtml(send.text);
  if (!sentText) return { action: "skip", why: "empty" };
  if (!draft) return { action: "skip", why: "no-draft" };
  const draftText = stripHtml(draft.text);
  const sentFields = send.fields ?? {};
  const diff = diffCaptureAnswers({ text: draftText, fields: input.draftFields }, { text: sentText, fields: sentFields });
  if (diff.changed && settings.requireReason && !input.reasonCode) {
    return { action: "need-reason", changedFields: diff.changedFields };
  }
  const now = input.now ?? Date.now();
  const body: CaptureCreate = {
    source: "intercom",
    externalId: `ic:${conversation.id}`,
    agent: settings.agent,
    actor: input.actor,
    subject: conversation.source?.subject ?? null,
    context: contextFrom(conversation),
    draft: { text: draftText, fields: Object.keys(input.draftFields).length ? input.draftFields : undefined },
    sent: { text: sentText, fields: Object.keys(sentFields).length ? sentFields : undefined },
    reasonCode: input.reasonCode,
    reason: input.reason?.trim() ? input.reason.trim() : undefined,
    tags: [draftTag(draft)],
    secondsToSend: draft.at ? Math.max(0, Math.round((now - draft.at) / 100) / 10) : undefined,
  };
  if (draft.runId) body.draftRunId = draft.runId;
  if (draft.model !== undefined) body.draftModel = draft.model ?? undefined;
  return { action: "capture", body, changed: diff.changed, changedFields: diff.changedFields };
}

export function statusLine(d: DraftState | null, lastResult: { changed: boolean; dedup: boolean } | null): string {
  if (lastResult) {
    if (!lastResult.changed) return "Sent as drafted · approved";
    return lastResult.dedup ? "Captured · already in the suite" : "Captured · edit saved as a case";
  }
  if (!d) return "Waiting for a draft";
  const words = d.text.trim().split(/\s+/).filter(Boolean).length;
  const from = { inserted: "inserted", manual: "marked by you", recorded: "recorded by your agent", preloaded: "found in the composer" }[d.origin];
  return `Draft ${from} · ${words} words`;
}

export function quickReasons(settings: AppSettings): readonly ReasonCodeOption[] {
  return REASON_PACKS[settings.reasonPack];
}
