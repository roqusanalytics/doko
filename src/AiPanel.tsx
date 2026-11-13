import { SelectMenu } from "./SelectMenu";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { copyText } from "./clipboard";
import type { PDFDocumentProxy } from "./pdf";
import { getAiHistory, saveAiHistory } from "./recent";
import { ProviderLogo } from "./ProviderLogo";
import { ModelMenu, type ModelGroup } from "./ModelMenu";
import { CLAUDE_CODE_URL, PROVIDERS, savedProvider, saveAiPreference, signInChatGPT, subscribeAiPreferences, USAGE_URL, type AiProvider } from "./ai";
import { Modal } from "./Dialogs";
import { readSetting } from "./preferences";
import { readAiDocumentText } from "./aiDocumentText";
import type { PageText } from "./OcrFindController";

const AiMarkdown = lazy(() => import("./AiMarkdown").then((module) => ({ default: module.AiMarkdown })));

export interface AiContext {
  text: string;
  page: number;
}

interface Message extends AiMessage {
  createdAt?: number;
  context?: AiContext;
  error?: { message: string; code?: string; link?: string };
}

const CLAUDE_MODELS = [
  { id: "", name: "Default model" },
  { id: "sonnet", name: "Sonnet" },
  { id: "opus", name: "Opus" },
  { id: "haiku", name: "Haiku" },
];

// ── Panel ─────────────────────────────────────────────────────────────────────────────────
// Keep partial replies and provider errors when the panel closes. Protected documents are session-only.
const closingChats = new Map<string, () => void>();
export function stopAiForClose(id: string) { closingChats.get(id)?.(); }
const conversations = new Map<string, { messages: Message[]; generation: number; persist: boolean }>();
let lastChatClear = 0;
export function forgetClearedChats(generation: number) {
  lastChatClear = Math.max(lastChatClear, generation);
  for (const [id, chat] of conversations) {
    if (chat.persist && chat.generation < generation) conversations.delete(id);
  }
}

function rememberChat(id: string, persist: boolean, messages: Message[], generation: number) {
  if (!persist || generation >= lastChatClear) conversations.set(id, { messages, generation, persist });
}

export async function flushAiHistory(id: string) {
  const chat = conversations.get(id);
  if (chat?.persist) await saveAiHistory(id, storedMessages(chat.messages), chat.generation);
}

function CopyResponse({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy response");
  useEffect(() => {
    if (label === "Copy response") return;
    const timer = window.setTimeout(() => setLabel("Copy response"), 2200);
    return () => window.clearTimeout(timer);
  }, [label]);

  return (
    <button className="link small copy-response" title={label === "Copy response" ? "Copy response as Markdown" : label}
      aria-label={label} data-failed={label === "Copy failed" || undefined}
      onClick={async () => setLabel(await copyText(text) ? "Copied" : "Copy failed")}>
      <Icon name={label === "Copied" ? "check" : label === "Copy failed" ? "info" : "copy"} size={13} />
      <span className="copy-status" aria-live="polite">{label}</span>
    </button>
  );
}

// Failed and empty answers aren't kept.
const storedMessages = (messages: Message[]) =>
  messages.filter((m) => !m.error && m.content).map(({ role, content, context, createdAt }) => ({ role, content, ...(context ? { context } : {}), ...(createdAt ? { createdAt } : {}) }));

function NewConversationDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <div onMouseDownCapture={event => {
    // The backdrop closes on mousedown; its default action must not blur the restored button.
    if (event.target === event.currentTarget.querySelector(".modal-backdrop")) event.preventDefault();
  }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    if (event.key !== "Tab") return;
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <Modal title="Start a new conversation?" onClose={onCancel}>
      <div className="password-form">
        <p>The current conversation for this document will be deleted. This cannot be undone.</p>
        <div className="form-actions">
          <button className="btn ghost" autoFocus onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={onConfirm}>Delete conversation</button>
        </div>
      </div>
    </Modal>
  </div>;
}

interface Props {
  pdf: PDFDocumentProxy;
  getPageText: (n: number) => Promise<PageText>;
  docId: string;
  /** Save the conversation with the document (off for password-protected documents). */
  persist: boolean;
  docName: string;
  context: AiContext | null;
  onClearContext: () => void;
  onGoToPage: (n: number) => void;
  onSettings: () => void;
  onClose: () => void;
  onSaveError?: (failed: boolean) => void;
}

export function AiPanel({ pdf, getPageText, docId, persist, docName, context, onClearContext, onGoToPage, onSettings, onClose, onSaveError }: Props) {
  const ai = window.folioDesktop?.ai;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const provider = useSyncExternalStore(subscribeAiPreferences, savedProvider);
  const keyRevision = useSyncExternalStore(subscribeAiPreferences, () => readSetting("folio:ai-key-revision"));
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [routerModels, setRouterModels] = useState<OpenRouterModel[]>([]);
  const routerSaved = useSyncExternalStore(subscribeAiPreferences, () => readSetting("folio:ai-model:openrouter") ?? "");
  const modelKey = `folio:ai-model:${provider}`;
  const savedModel = useSyncExternalStore(subscribeAiPreferences, () => readSetting(modelKey) ?? "");
  const model = provider === "chatgpt" && models.length && !models.some(m => m.id === savedModel) ? models[0].id : savedModel;
  const [messages, setMessages] = useState<Message[]>(() => conversations.get(docId)?.messages ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<"read" | "save" | null>(null);
  const [storageRetry, setStorageRetry] = useState(0);
  const [confirmNew, setConfirmNew] = useState(false);
  const busyRef = useRef<string | null>(null);
  const preparing = useRef<{ id: string; controller: AbortController } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const newConversationRef = useRef<HTMLButtonElement>(null);
  const cancelNew = () => { setConfirmNew(false); newConversationRef.current?.focus(); };

  // The panel is mounted per document (keyed by docId in App), so this conversation always belongs to docId.
  const [generation, setGeneration] = useState<number | null>(() => conversations.get(docId)?.generation ?? (persist ? null : 0));
  const loaded = generation !== null;
  useEffect(() => { onSaveError?.(storageError === "save"); }, [storageError, onSaveError]);
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    void getAiHistory(docId).then(({ messages, generation }) => {
      if (cancelled) return;
      setMessages(messages);
      setGeneration(generation);
      setStorageError(null);
    }).catch(() => {
      if (!cancelled) setStorageError("read");
    });
    return () => { cancelled = true; };
  }, [docId, loaded, storageRetry]);
  useEffect(() => {
    if (generation === null) return;
    rememberChat(docId, persist, messages, generation);
    // Save once an answer has finished (not on every streamed word).
    let cancelled = false;
    if (persist && !busy) void saveAiHistory(docId, storedMessages(messages), generation).then(() => {
      if (!cancelled) setStorageError(null);
    }).catch(() => {
      if (!cancelled) setStorageError("save");
    });
    return () => { cancelled = true; };
  }, [docId, messages, busy, generation, persist, storageRetry]);
  useEffect(() => {
    let current = true;
    void ai?.status().then(value => { if (current) setStatus(value); }).catch(() => { if (current) setSetupError("Couldn't check AI connections."); });
    return () => { current = false; };
  }, [ai, keyRevision]);
  useEffect(() => { if (context) inputRef.current?.focus(); }, [context]);

  // ChatGPT's model list depends on the signed-in account.
  const chatgptConnected = !!status?.chatgpt.connected;
  useEffect(() => {
    setSetupError(null);
    if (!ai || !chatgptConnected) return;
    let current = true;
    void ai.chatgptModels().then((result) => {
      if (!current) return;
      if (!result.ok) {
        if (result.code === "signed_out") void ai.status().then(setStatus);
        setSetupError(result.error ?? null);
        return;
      }
      setModels(result.models ?? []);
    });
    return () => { current = false; };
  }, [ai, chatgptConnected]);

  // OpenRouter lists hundreds of models; the menu offers the newest and Settings has the full search.
  // The list loads when the menu opens, once per key, so the panel makes no request until it's needed.
  const routerConfigured = !!status?.openrouter?.configured;
  const routerLoadedFor = useRef<string | null>(null);
  const loadRouterModels = () => {
    const key = String(keyRevision);
    if (!ai || !routerConfigured || routerLoadedFor.current === key) return;
    routerLoadedFor.current = key;
    void ai.openRouterModels().then(result => {
      if (result.ok) setRouterModels(result.models ?? []); else routerLoadedFor.current = null;
    }).catch(() => { routerLoadedFor.current = null; });
  };

  // Stream answers into the last assistant message.
  useEffect(() => {
    if (!ai) return;
    return ai.onEvent((event) => {
      if (event.id !== busyRef.current) return;
      setMessages((list) => {
        const next = list.slice();
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") return list;
        if (event.type === "delta") next[next.length - 1] = { ...last, content: last.content + (event.text ?? "") };
        if (event.type === "error") next[next.length - 1] = { ...last, error: { message: event.message ?? "Something went wrong.", code: event.code, link: event.link } };
        return next;
      });
      if (event.type !== "delta") {
        busyRef.current = null;
        setBusy(null);
        if (event.code === "signed_out") void ai.status().then(setStatus);
      }
    });
  }, [ai]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const connected = { chatgpt: chatgptConnected, claude: !!status?.claude.installed && status.claude.loggedIn,
    openrouter: !!status?.openrouter?.configured && !!model };
  const ready = loaded && connected[provider];

  // Newest first. ChatGPT lists its own order; Claude Code takes family names; OpenRouter is sorted by release date.
  const newestRouter = [...routerModels].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).slice(0, 6);
  const routerList = routerSaved && !newestRouter.some(m => m.id === routerSaved)
    ? [{ id: routerSaved, name: routerModels.find(m => m.id === routerSaved)?.name ?? routerSaved }, ...newestRouter] : newestRouter;
  const groups: ModelGroup[] = [
    { provider: "chatgpt", label: "ChatGPT", models: models.length ? models : model && provider === "chatgpt" ? [{ id: model, name: model }] : [],
      setup: chatgptConnected ? undefined : "Sign in to ChatGPT in Settings" },
    { provider: "claude", label: "Claude", models: CLAUDE_MODELS,
      setup: status?.claude.installed && status.claude.loggedIn ? undefined : "Set up Claude Code in Settings" },
    { provider: "openrouter", label: "OpenRouter", models: routerList, more: "More models in Settings…",
      setup: routerConfigured ? undefined : "Add an OpenRouter key in Settings" },
  ];
  const modelName = (groups.find(group => group.provider === provider)?.models.find(item => item.id === model)?.name) ?? (model.split("/").pop() || "Default");

  // Closing the panel, entering focus mode, or opening another document ends an answer in progress the way Stop does.
  // Otherwise it keeps running unseen, holds one of the two answers allowed at a time, and comes back never finishing.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => {
    closingChats.set(docId, () => {
      const request = busyRef.current;
      preparing.current?.controller.abort();
      preparing.current = null; busyRef.current = null;
      if (request) void ai?.cancel(request).catch(() => {});
      setBusy(null);
      if (generation !== null) rememberChat(docId, persist, messagesRef.current, generation);
    });
    return () => { closingChats.delete(docId); };
  }, [ai, docId, persist, generation]);
  useEffect(() => () => {
    preparing.current?.controller.abort();
    preparing.current = null;
    const id = busyRef.current;
    if (!id) return;
    busyRef.current = null;
    void ai?.cancel(id);
    const list = messagesRef.current;
    const last = list[list.length - 1];
    const kept = last?.role === "assistant" && !last.content && !last.error ? list.slice(0, -1) : list;
    if (generation !== null) {
      rememberChat(docId, persist, kept, generation);
      // The cached conversation survives a failed save and is retried when the panel reopens.
      if (persist) void saveAiHistory(docId, storedMessages(kept), generation).catch(() => {});
    }
  }, [ai, docId, persist, generation]);
  const stop = () => {
    if (!busy) return;
    if (preparing.current?.id !== busy) { void ai?.cancel(busy); return; }
    preparing.current?.controller.abort();
    preparing.current = null;
    busyRef.current = null;
    setBusy(null);
    setMessages(list => list.slice(0, -1));
  };

  const send = useCallback(async (question: string) => {
    if (!ai || !question.trim() || busyRef.current || !ready) return;
    const turn: Message = { role: "user", content: question.trim(), createdAt: Date.now(), ...(context ? { context } : {}) };
    const history = [...messages.filter((m) => !m.error && m.content), turn];
    const id = crypto.randomUUID();
    const controller = new AbortController();
    preparing.current = { id, controller };
    busyRef.current = id;
    setBusy(id);
    setMessages([...messages, turn, { role: "assistant", content: "", createdAt: Date.now() }]);
    setInput("");
    onClearContext();
    try {
      const doc = provider === "openrouter" && context ? { text: "", truncated: true } : await readAiDocumentText(pdf.numPages, getPageText, controller.signal);
      if (preparing.current?.id !== id) return;
      preparing.current = null;
      await ai.ask({ id, provider, model, document: { name: docName, ...doc },
        messages: history.map(({ role, content, context }) => ({ role, content, ...(context ? { context } : {}) })) });
    } catch {
      if (busyRef.current !== id) return;
      const readingFailed = preparing.current?.id === id;
      preparing.current = null;
      busyRef.current = null;
      setBusy(null);
      if (readingFailed) setInput(question);
      setMessages((list) => {
        const next = list.slice();
        next[next.length - 1] = { role: "assistant", content: "", error: { message: readingFailed ? "Doko couldn’t read this document. Your question is below; send it again to retry." : "Doko couldn't send that question." } };
        return next;
      });
    }
  }, [ai, pdf, getPageText, context, messages, provider, model, docName, onClearContext, ready]);

  const signIn = async () => {
    if (!ai) return;
    setSigningIn(true);
    setSetupError(null);
    const result = await signInChatGPT(ai);
    setSigningIn(false);
    setSetupError(result.error);
    setStatus(result.status);
  };

  const placeholder = !ready ? "Connect an AI provider to ask questions"
    : context ? "Ask about the selected passage…" : "Ask about this document…";

  return (
    <aside className="ai-panel" aria-label="Ask AI">
      <header className="ai-head">
        <div className="ai-title"><Icon name="sparkle" size={16} /> Ask AI</div>
        {ai && <SelectMenu className="ai-provider" label="AI provider" value={provider} disabled={!!busy}
          onChange={value => saveAiPreference("folio:ai-provider", value)}
          options={(Object.entries(PROVIDERS) as [AiProvider, string][]).map(([value, label]) => ({ value, label, icon: <ProviderLogo provider={value} /> }))} />}
        <div className="ai-head-actions">
          <button ref={newConversationRef} className="pill-btn" title="New conversation" aria-label="New conversation" disabled={!loaded || !messages.length || !!busy} onClick={() => setConfirmNew(true)}>
            <Icon name="plus" size={15} />
          </button>
          <button className="pill-btn" title="Close" aria-label="Close Ask AI" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </div>
      </header>

      <div className="ai-body" ref={listRef}>
        {!ai ? (
          <div className="ai-card"><p>Ask AI is available in the Doko desktop app.</p></div>
        ) : !status ? (
          <p className="ai-checking">Checking connections…</p>
        ) : provider === "chatgpt" && !chatgptConnected ? (
          <div className="ai-card">
            <h3>Use your ChatGPT plan</h3>
            <p>Sign in with ChatGPT to ask questions using your existing ChatGPT plan (Go, Plus, or Pro). No API key needed.</p>
            {/* Stays clickable while waiting: a closed browser tab is opened again. */}
            <button className="btn primary chatgpt-btn" onClick={signIn}>
              {signingIn ? "Open the sign-in page again" : "Continue with ChatGPT"}
            </button>
            {signingIn && <p className="fine">Finish signing in in your browser, then come back here.</p>}
            <p className="fine">When you ask, Doko sends your question and the document's text to OpenAI. Nothing is sent otherwise.</p>
          </div>
        ) : provider === "claude" && !(status.claude.installed && status.claude.loggedIn) ? (
          <div className="ai-card">
            <h3>Use your Claude subscription</h3>
            {!status.claude.installed ? (
              <p>Doko uses Claude Code, Anthropic's official app, signed in with your own Claude Pro or Max account. Install Claude Code, sign in once, then check again.</p>
            ) : (
              <p>Claude Code is installed but not signed in. Open a terminal, run <code>claude</code>, and sign in with your Claude account.</p>
            )}
            <div className="ai-card-actions">
              {!status.claude.installed && <a className="btn ghost" href={CLAUDE_CODE_URL} target="_blank" rel="noreferrer">Get Claude Code</a>}
              <button className="btn primary" onClick={async () => setStatus({ ...status, claude: await ai.recheckClaude() })}>Check again</button>
            </div>
            <p className="fine">Doko never sees your Claude password or tokens. When you ask, it sends your question and the document's text to Anthropic through Claude Code.</p>
          </div>
        ) : provider === "openrouter" && !connected.openrouter ? (
          <div className="ai-card">
            <h3>Connect OpenRouter</h3>
            <p>{status.openrouter?.configured ? "Choose a model for your questions." : "Use your own API key and choose a model in Settings."}</p>
            <button className="btn primary" onClick={onSettings}>Open Ask AI settings</button>
          </div>
        ) : (
          <>
            {provider === "chatgpt" && !status.chatgpt.welcomeSeen && (
              <div className="ai-card ai-welcome">
                <p><strong>You're connected{status.chatgpt.email ? ` as ${status.chatgpt.email}` : ""}.</strong> Questions you ask in Doko use your ChatGPT plan. You can manage usage in ChatGPT settings.</p>
                <div className="ai-card-actions">
                  <a className="btn ghost" href={USAGE_URL} target="_blank" rel="noreferrer">Manage usage</a>
                  <button className="btn primary" onClick={async () => { await ai.chatgptWelcomeSeen(); setStatus(await ai.status()); }}>Got it</button>
                </div>
              </div>
            )}
            {loaded && messages.length === 0 && (
              <div className="ai-empty">
                <p>Ask anything about <strong>{docName.replace(/\.pdf$/i, "")}</strong>, or select text in the document and choose <em>Ask AI</em>.</p>
                <div className="suggestions">
                  {(context ? ["Explain this in simple terms", "Why does this matter?", "Summarize this passage"]
                    : ["Summarize this document", "What are the key takeaways?", "What questions does this leave open?"]).map((q) => (
                    <button key={q} className="suggestion" onClick={() => void send(q)}>{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === "user" ? (
                  <>
                    {m.context && <blockquote>p. {m.context.page}: {m.context.text.length > 220 ? m.context.text.slice(0, 220) + "…" : m.context.text}</blockquote>}
                    <p>{m.content}</p>
                  </>
                ) : m.error ? (
                  <div className="msg-error">
                    <p>{m.error.message}</p>
                    {m.error.code === "usage_limit" && provider === "chatgpt" && (
                      <a className="btn primary" href={m.error.link || USAGE_URL} target="_blank" rel="noreferrer">Manage usage</a>
                    )}
                    {m.error.code === "signed_out" && provider === "chatgpt" && (
                      <button className="btn primary" onClick={signIn}>Continue with ChatGPT</button>
                    )}
                  </div>
                ) : m.content ? (
                  <>
                    <Suspense fallback={<p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p>}>
                      <AiMarkdown text={m.content} onPage={onGoToPage} />
                    </Suspense>
                    {(!busy || i < messages.length - 1) && <div className="msg-meta">
                      <CopyResponse text={m.content} />
                      {m.createdAt ? <time dateTime={new Date(m.createdAt).toISOString()}>
                        {new Date(m.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </time> : <span title="This response was saved before message timestamps were recorded.">Date unavailable</span>}
                    </div>}
                  </>
                ) : (
                  <div className="typing" aria-label="Thinking"><span /><span /><span /></div>
                )}
              </div>
            ))}
          </>
        )}
        {!loaded && !storageError && <p className="ai-checking">Loading conversation…</p>}
        {storageError && <div className="msg-error" role="alert">
          <p>{storageError === "read" ? "Couldn't load this conversation. Try again before asking a question."
            : "Couldn't save this conversation. Your messages are still available here."}</p>
          <button className="btn ghost" disabled={!!busy} onClick={() => {
            setStorageError(null);
            setStorageRetry(value => value + 1);
          }}>Retry</button>
        </div>}
        {setupError && <div className="msg-error"><p>{setupError}</p></div>}
      </div>

      <footer className="ai-foot">
        {context && (
          <div className="context-chip">
            <span>p. {context.page}: “{context.text.length > 90 ? context.text.slice(0, 90) + "…" : context.text}”</span>
            <button onClick={onClearContext} aria-label="Ask about the whole document instead" title="Ask about the whole document instead">
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={2}
            disabled={!ready}
            placeholder={placeholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <div className="composer-actions">
            {ai && status && <ModelMenu groups={groups} provider={provider} model={model} label={modelName} disabled={!!busy} onSettings={onSettings} onOpen={loadRouterModels}
              onChange={(next, id) => { saveAiPreference(`folio:ai-model:${next}`, id); saveAiPreference("folio:ai-provider", next); }} />}
            {busy ? (
              <button type="button" className="send-btn" onClick={stop} title="Stop" aria-label="Stop">
                <Icon name="stop" size={15} />
              </button>
            ) : (
              <button type="submit" className="send-btn" disabled={!ready || !input.trim()} title="Send (Enter)" aria-label="Send">
                <Icon name="send" size={16} />
              </button>
            )}
          </div>
        </form>
        {ready && (
          <div className="ai-meta">
            {provider === "chatgpt" ? (
              <span>Using ChatGPT plan · <a href={USAGE_URL} target="_blank" rel="noreferrer">Manage usage</a></span>
            ) : provider === "openrouter" ? <span>Billed by OpenRouter</span> : (
              <span>{status?.claude.subscription ? "Using your Claude subscription via Claude Code" : "Using Claude Code"}</span>
            )}
          </div>
        )}
      </footer>
      {confirmNew && createPortal(<NewConversationDialog onCancel={cancelNew} onConfirm={() => {
        setConfirmNew(false);
        setMessages([]);
        inputRef.current?.focus();
      }} />, document.body)}
    </aside>
  );
}
