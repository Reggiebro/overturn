import type { CaptureResult } from "@overturn-ai/shared";
import {
  type AppSettings,
  createDraftDetector,
  type DraftState,
  decideOnSend,
  quickReasons,
  settingsFrom,
  statusLine,
  type IntercomConversationSnapshot,
} from "./capture";

interface IntercomCanvasClient {
  getContext(): Promise<{ conversation?: IntercomConversationSnapshot; settings?: Record<string, unknown>; actor?: { email?: string } }>;
  on(event: string, handler: (payload?: unknown) => void): void;
  request<T = unknown>(opts: Record<string, unknown>): Promise<T>;
}

declare global { interface Window { IntercomCanvas?: { init(): IntercomCanvasClient } } }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export async function main(): Promise<void> {
  const client = window.IntercomCanvas?.init();
  if (!client) return;
  const ctx = await client.getContext();
  const settings: AppSettings = settingsFrom(ctx.settings ?? {});
  const detector = createDraftDetector({ minDraftChars: settings.minDraftChars });

  const root = document.getElementById("app");
  if (!root) return;
  const status = el("div", { class: "status" }, "Waiting for a draft");
  let reasonCode: string | null = null;
  const quick = el("div", { class: "quick", role: "radiogroup", "aria-label": "Why did you change it?" });
  const chips: HTMLButtonElement[] = [];
  for (const q of quickReasons(settings)) {
    const b = el("button", { type: "button", class: "chip", "data-code": q.code }, q.label) as HTMLButtonElement;
    b.addEventListener("click", () => { reasonCode = reasonCode === q.code ? null : q.code; for (const c of chips) c.classList.toggle("on", c.dataset.code === reasonCode); });
    chips.push(b); quick.appendChild(b);
  }
  const reason = el("textarea", { class: "reason", rows: "2", placeholder: "Anything else? Optional." }) as HTMLTextAreaElement;
  const mark = el("button", { type: "button", class: "link" }, "Use the current text as the draft");
  const note = el("div", { class: "note" }, "");
  root.append(status, quick, reason, mark, note);

  let lastResult: { changed: boolean; dedup: boolean } | null = null;
  let lastComposer = "";
  const render = (): void => { status.textContent = statusLine(detector.current(), lastResult); };

  client.on("composer.change", (payload) => {
    const p = (payload ?? {}) as { text?: string; from?: string };
    lastComposer = p.text ?? "";
    const from = (p.from ?? "").toLowerCase();
    const kind = from.includes("fin") || from.includes("ai") || from.includes("assist") ? "ai" : from.includes("human") ? "manual" : "unknown";
    if (detector.onComposer(lastComposer, kind)) render();
  });
  mark.addEventListener("click", () => {
    if (!lastComposer.trim()) return;
    detector.set({ text: lastComposer, origin: "manual", kind: "manual", at: Date.now() });
    lastResult = null; render();
  });

  client.on("conversation.reply.send", async (payload) => {
    const draft = detector.current();
    if (!draft) return;
    const p = (payload ?? {}) as { text?: string; html?: string; fields?: Record<string, unknown> };
    const current = await client.getContext();
    const conversation = current.conversation;
    if (!conversation) return;
    const decision = decideOnSend({
      conversation,
      draft,
      draftFields: {},
      send: { text: p.text ?? p.html ?? "", fields: p.fields ?? {} },
      reasonCode,
      reason: reason.value,
      actor: current.actor?.email ?? null,
      settings,
      now: Date.now(),
    });
    if (decision.action === "skip") return;
    if (decision.action === "need-reason") {
      chips[0]?.focus();
      note.textContent = `Pick why you changed the ${decision.changedFields.length ? decision.changedFields.join(", ") : "reply"} before sending.`;
      throw new Error("Overturn: reason required");
    }
    try {
      const r = await client.request<CaptureResult>({
        url: `${settings.baseUrl}/v1/capture`,
        method: "POST",
        headers: { Authorization: `Bearer ${String((ctx.settings ?? {}).overturn_api_key ?? "")}`, "Content-Type": "application/json" },
        body: JSON.stringify(decision.body),
      });
      lastResult = { changed: r.changed, dedup: r.deduplicated };
      note.textContent = r.changed && r.case ? `Case: ${r.case.title}` : "";
      reason.value = ""; reasonCode = null; for (const c of chips) c.classList.remove("on"); detector.set(null); render();
    } catch (e) {
      note.textContent = `Overturn could not save this correction (${(e as { status?: number }).status ?? "network"}).`;
    }
  });

  render();
}

void main();
