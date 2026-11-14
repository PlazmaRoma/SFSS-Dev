import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Client } from "@sfss/client";
import { reportTitle } from "@sfss/data/reports";
import { errorText } from "./errors";
import { detectLanguage, splitBold, splitCitations } from "./citations";
import { getLang, tr } from "./lang";
import { load, save } from "./storage";
import type { Chat, ChatMessage, HealthInfo, LoadResult } from "./types";
import { LOAD_TIMEOUT_MS } from "./types";

const EXAMPLES = {
  ru: [
    "Как гелий в атмосфере влияет на горение?",
    "Что происходит с пламенем при пониженном давлении?",
    "Что показал эксперимент BASS-II о горении твёрдых материалов?",
  ],
  en: [
    "How does helium in the atmosphere affect burning?",
    "What happens to a flame at reduced pressure?",
    "What did the BASS-II experiment find about burning solids?",
  ],
};
const STAGES = {
  loading: "stageLoading",
  searching: "stageSearching",
  answering: "stageAnswering",
  translating: "stageTranslating",
} as const;

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const newChat = (): Chat => ({ id: newId(), title: "", messages: [] });
// Пустой чат подписан на языке программы, а не на том, при котором его создали
const chatTitle = (chat: Chat) => (chat.messages.length ? chat.title : tr("newChat"));

export interface AiHandle { focus: () => void }

/** Вопрос виден и доступен всегда, без режимов и кнопок на пути к нему. */
export const AiPanel = forwardRef<AiHandle, {
  client: Client;
  health: HealthInfo | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenPage: (docId: string, page: number) => void;
  onModelChanged: () => void;
  onModelStarting: () => void;
  onBusyChange: (busy: boolean) => void;
}>(function AiPanel({ client, health, expanded, onToggleExpanded, onOpenPage, onModelChanged, onModelStarting, onBusyChange }, ref) {
  const [chats, setChats] = useState<Chat[]>(() => {
    const saved = load<Chat[]>("antifire.chats", []);
    return saved.length ? saved : [newChat()];
  });
  const [activeId, setActiveId] = useState(() => chats[0].id);
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<"auto" | "ru" | "en">("auto");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [loadingModel, setLoadingModel] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const active = chats.find((chat) => chat.id === activeId) ?? chats[0];

  // Пока ответ пишется, не сохраняем: оборванный ответ в истории только сбивает
  useEffect(() => {
    if (!busy) save("antifire.chats", chats);
  }, [chats, busy]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [active.messages]);

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const updateMessage = (chatId: string, messageId: string, change: Partial<ChatMessage>) => {
    setChats((all) => all.map((chat) =>
      chat.id === chatId
        ? { ...chat, messages: chat.messages.map((m) => (m.id === messageId ? { ...m, ...change } : m)) }
        : chat,
    ));
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || !health) return;
    const chatId = active.id;
    const replyId = newId();
    setQuestion("");
    setChats((all) => all.map((chat) =>
      chat.id === chatId
        ? {
            ...chat,
            title: chat.messages.length ? chat.title : trimmed.slice(0, 48),
            messages: [
              ...chat.messages,
              { id: newId(), role: "user", text: trimmed },
              { id: replyId, role: "ai", text: "", stage: "searching", sources: [] },
            ],
          }
        : chat,
    ));
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const lang = language === "auto" ? detectLanguage(trimmed) : language;
    try {
      const answer = await client.askStream(
        trimmed, lang,
        (progress) => updateMessage(chatId, replyId, {
          text: progress.text,
          stage: progress.stage,
          sources: progress.sources ?? [],
        }),
        180_000,
        controller.signal,
      );
      updateMessage(chatId, replyId, { text: answer.answer, sources: answer.sources, stage: null });
    } catch (error) {
      updateMessage(chatId, replyId, {
        stage: null,
        error: controller.signal.aborted ? tr("stopped") : errorText(error),
      });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const startChat = () => {
    if (active.messages.length === 0) {
      input.current?.focus();
      return;
    }
    const chat = newChat();
    setChats((all) => [chat, ...all]);
    setActiveId(chat.id);
    input.current?.focus();
  };

  const deleteChat = (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    const rest = chats.filter((chat) => chat.id !== id);
    const next = rest.length ? rest : [newChat()];
    setChats(next);
    if (id === active.id) setActiveId(next[0].id);
  };

  const loadModel = async () => {
    setLoadingModel(true);
    setLoadFailure(null);
    onModelStarting();
    try {
      await client.post<LoadResult>("/llm/load", {}, LOAD_TIMEOUT_MS);
    } catch (error) {
      setLoadFailure(errorText(error));
    } finally {
      setLoadingModel(false);
      onModelChanged();
    }
  };

  const limit = health?.model_context_limit;
  const tooBig = Boolean(limit && health?.model_context_length && health.model_context_length > limit);
  const llmHint = !health || loadingModel || health.model_loading || busy
    ? null
    : !health.lm_studio
      ? tr("hintServerDown", { runtime: health.runtime_name ?? "LM Studio" })
      : health.model_loaded === false
        ? tr("hintNotLoaded")
        : tooBig
          ? tr("hintContext", { context: health.model_context_length ?? "", limit: limit ?? "" })
          : null;

  return (
    <section className={expanded ? "ai expanded" : "ai"} aria-label={tr("aiPanel")}>
      <div className="ai-bar">
        {expanded && <button onClick={onToggleExpanded} title="Esc">{tr("backToCalc")}</button>}
        <h2>{tr("aiTitle")}</h2>
        <button onClick={startChat}>{tr("newChat")}</button>
        {!expanded && <button onClick={onToggleExpanded}>{tr("allChats")}</button>}
      </div>

      <div className="ai-columns">
        {expanded && (
          <nav className="chat-list" aria-label={tr("chats")}>
            {chats.map((chat) => (
              <div key={chat.id} className={chat.id === active.id ? "chat on" : "chat"} onMouseLeave={() => setConfirmDelete(null)}>
                <button className="chat-open" onClick={() => setActiveId(chat.id)} disabled={busy} title={chatTitle(chat)}>
                  {chatTitle(chat)}
                </button>
                <button
                  className={confirmDelete === chat.id ? "chat-delete armed" : "chat-delete"}
                  onClick={() => deleteChat(chat.id)}
                  onBlur={() => setConfirmDelete(null)}
                  disabled={busy}
                  aria-label={`${tr("deleteChat")}: ${chatTitle(chat)}`}
                  title={tr("deleteChat")}
                >
                  {confirmDelete === chat.id ? tr("confirmDelete") : "×"}
                </button>
              </div>
            ))}
          </nav>
        )}

        <div className="ai-main">
          <div className="thread" ref={thread}>
            {active.messages.length === 0 && (
              <div className="examples">
                <p className="muted">{tr("aiIntro")}</p>
                {EXAMPLES[getLang()].map((example) => (
                  <button key={example} className="example" onClick={() => void ask(example)} disabled={!health}>
                    {example}
                  </button>
                ))}
              </div>
            )}
            {active.messages.map((message) =>
              message.role === "user" ? (
                <p key={message.id} className="question">{message.text}</p>
              ) : (
                <Reply key={message.id} message={message} elapsed={elapsed} onOpen={onOpenPage} />
              ),
            )}
          </div>

          {(loadingModel || health?.model_loading) && !busy && (
            <p className="notice warn hint" role="status">{tr("loadingNow")}</p>
          )}
          {llmHint && (
            <p className="notice warn hint hint-action">
              <span>{llmHint}</span>
              <button onClick={() => void loadModel()}>{tooBig ? tr("reload") : tr("load")}</button>
            </p>
          )}
          {loadFailure && <p className="notice bad hint">{loadFailure}</p>}

          <form
            className="ask"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
          >
            <textarea
              ref={input}
              rows={2}
              value={question}
              placeholder={health ? tr("askPlaceholder") : tr("noConnection")}
              aria-label={tr("question")}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(question);
                }
              }}
            />
            <div className="ask-actions">
              <select aria-label={tr("answerLanguage")} value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                <option value="auto">{tr("langAuto")}</option>
                <option value="ru">по-русски</option>
                <option value="en">in English</option>
              </select>
              {busy ? (
                <button type="button" onClick={() => abort.current?.abort()}>{tr("stop")}</button>
              ) : (
                <button type="submit" className="primary" disabled={!question.trim() || !health}>{tr("ask")}</button>
              )}
            </div>
          </form>
        </div>

      </div>
    </section>
  );
});

function Reply({ message, elapsed, onOpen }: {
  message: ChatMessage;
  elapsed: number;
  onOpen: (docId: string, page: number) => void;
}) {
  return (
    <div className="reply">
      {message.stage && <p className="stage">{tr(STAGES[message.stage])}... {elapsed} {tr("seconds")}</p>}
      {message.text && (
        <p className="answer">
          {splitCitations(message.text).map((part, i) =>
            part.kind === "text" ? (
              <span key={i}>
                {splitBold(part.text).map((piece, j) => (j % 2 ? <strong key={j}>{piece}</strong> : piece))}
              </span>
            ) : (
              <button key={i} className="cite" onClick={() => onOpen(part.docId, part.page)} title={tr("openPage")}>
                {part.text}
              </button>
            ),
          )}
        </p>
      )}
      {message.error && <p className="notice bad">{message.error}</p>}
      {Boolean(message.sources?.length) && (
        <ol className="sources">
          {message.sources!.map((source, i) => (
            <li key={`${source.doc_id}-${source.page}-${i}`}>
              <button
                className="source"
                disabled={source.page === null}
                title={source.excerpt.slice(0, 400)}
                onClick={() => { if (source.page !== null) onOpen(source.doc_id, source.page); }}
              >
                {reportTitle(source.doc_id)}{source.page !== null ? `, ${tr("page")} ${source.page}` : ""}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
