import type { CaptureResult } from "@overturn-ai/shared";
import { type AppSettings, createDraftDetector, type DraftState, decideOnSend, quickReasons, settingsFrom, statusLine, type FrontConversationSnapshot } from "./capture";

interface FrontClient {
  contextUpdates: { subscribe(cb: (ctx: unknown) => void): void };
  fetch(path: string): Promise<unknown>;
  on?(event: string, handler: (payload?: unknown) => void): void;
}

declare global { interface Window { Front?: FrontClient } }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function toSnapshot(ctx: unknown): { conversation: FrontConversationSnapshot | null; settings: Record<string, unknown>; actor: string | null } {
  const c = (ctx ?? {}) as Record<string, unknown>;
  const conv = c.conversation as Record<string, unknown> | undefined;
  const messages = Array.isArray(c.messages) ? (c.messages as FrontConversationSnapshot["messages"]) : [];
  const conversation = conv?.id ? { id: String(conv.id), subject: (conv.subject as string | null) ?? null, recipient: (conv.recipient as FrontConversationSnapshot["recipient"]) ?? null, messages } : null;
  const teammate = c.teammate as { email?: string } | undefined;
  return { conversation, settings: (c.settings as Record<string, unknown>) ?? {}, actor: teammate?.email ?? null };
}

export async function main(): Promise<void> {
  const front = window.Front;
  if (!front) return;
  const root = document.getElementById("app");
  if (!root) return;
  let settings: AppSettings = DEFAULT_SETTINGS;
  let actor: string | null = null;
  let currentConversation: FrontConversationSnapshot | null = null;
  const detector = createDraftDetector({ minDraftChars: settings.minDraftChars });
  const status = el("div", { class: "status" }, "Waiting for a draft");
  let reasonCode: string | null = null;
  const quick = el("div", { class: "quick" });
  const chips: HTMLButtonElement[] = [];
  const reason = el("textarea", { class: "reason", rows: "2", placeholder: "Anything else? Optional." }) as HTMLTextAreaElement;
  const note = el("div", { class: "note" }, "");
  let lastResult: { changed: boolean; dedup: boolean } | null = null;
  let lastComposer = "";
  const render = (): void => { status.textContent = statusLine(detector.current(), lastResult); };
  const rebuildReasons = () => { quick.replaceChildren(); chips.length = 0; for (const q of quickReasons(settings)) { const b = el("button", { type: "button", class: "chip", "data-code": q.code }, q.label) as HTMLButtonElement; b.addEventListener("click", () => { reasonCode = reasonCode === q.code ? null : q.code; for (const c of chips) c.classList.toggle("on", c.dataset.code === reasonCode); }); chips.push(b); quick.appendChild(b); } };
  rebuildReasons();
  root.append(status, quick, reason, note);

  front.contextUpdates.subscribe((ctx) => {
    const parsed = toSnapshot(ctx);
    settings = settingsFrom(parsed.settings);
    actor = parsed.actor;
    currentConversation = parsed.conversation;
    rebuildReasons();
  });
  front.on?.("composer.change", (payload) => {
    const p = (payload ?? {}) as { text?: string };
    lastComposer = p.text ?? "";
    if (detector.onComposer(lastComposer)) render();
  });
  front.on?.("conversation.send", async (payload) => {
    const draft = detector.current();
    if (!draft || !currentConversation) return;
    const p = (payload ?? {}) as { text?: string; html?: string; fields?: Record<string, unknown> };
    const decision = decideOnSend({ conversation: currentConversation, draft, draftFields: {}, send: { text: p.text ?? p.html ?? lastComposer, fields: p.fields ?? {} }, reasonCode, reason: reason.value, actor, settings, now: Date.now() });
    if (decision.action === "skip") return;
    if (decision.action === "need-reason") { note.textContent = "Pick why you changed the reply before sending."; throw new Error("Overturn: reason required"); }
    try {
      const r = await fetch(`${settings.baseUrl}/v1/capture`, { method: "POST", headers: { Authorization: `Bearer ${String(({} as Record<string, unknown>).overturn_api_key ?? "")}`, "Content-Type": "application/json" }, body: JSON.stringify(decision.body) }).then((res) => res.json() as Promise<CaptureResult>);
      lastResult = { changed: r.changed, dedup: r.deduplicated }; note.textContent = r.changed && r.case ? `Case: ${r.case.title}` : ""; reason.value = ""; reasonCode = null; for (const c of chips) c.classList.remove("on"); detector.set(null); render();
    } catch (e) {
      note.textContent = `Overturn could not save this correction (${(e as { status?: number }).status ?? "network"}).`;
    }
  });
  render();
}

void main();
