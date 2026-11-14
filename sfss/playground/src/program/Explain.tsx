import { useEffect, useRef, useState } from "react";
import type { Answer, Lang } from "../shared/types";
import { askStream, cache, type Progress } from "../shared/api";
import { TOPIC_LABEL, tr } from "../shared/i18n";
import { reportTitle } from "../shared/data/reports";

/** Модель отвечает лёгкой разметкой: **жирный** и списки. Полноценный
 *  markdown-парсер сюда тащить незачем — хватает жирного и абзацев. */
function render(text: string) {
  return text.split(/\n{2,}|\n(?=[-*\d])/).filter(Boolean).map((block, i) => {
    const parts = block.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return (
      <p key={i}>
        {parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={j}>{p.slice(2, -2)}</strong>
            : <span key={j}>{p}</span>,
        )}
      </p>
    );
  });
}

const TOPICS = ["oxygen", "pressure", "solids", "airflow", "materials", "helium", "safety", "droplet"];

/** Длинный вопрос модель на 3B всё равно не удержит, а промпт растёт */
const MAX_QUESTION = 300;

export function Explain({
  lang,
  online,
  llm,
  onCheck,
}: {
  lang: Lang;
  online: boolean;
  /** Рантайм нейросети отвечает: без него /query упадёт, прождав до 90 секунд */
  llm: boolean;
  /** Перечитать /health: рантайм поднимают и гасят отдельно от сервиса. Зовётся,
   *  когда человек собирается спросить и когда ответа не было */
  onCheck: () => void;
}) {
  // topic === null — показан свой вопрос пользователя, а не готовая тема
  const [topic, setTopic] = useState<string | null>(TOPICS[0]);
  const [own, setOwn] = useState("");
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<Answer | null>(null);
  // Что успело прийти из потока, пока ответ ещё пишется
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);

  // Ответ идёт полминуты, за это время можно уйти на другую тему. Номер
  // запроса не даёт опоздавшему ответу встать под чужой вопрос.
  const request = useRef(0);

  // Полминуты без движения выглядят как зависание: показываем секунды
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const entry = topic ? cache[topic] : null;
  const asked = entry ? entry.question[lang] : own;
  const shown: Answer | null = live ?? entry?.[lang] ?? null;
  const canAsk = online && llm && !busy;
  const streamed = busy && progress?.text ? progress.text : null;
  // Источники приходят первыми, сразу после поиска: их видно, пока модель пишет
  const sources = busy ? progress?.sources ?? null : shown?.sources ?? null;
  const stage = tr(
    progress?.stage === "translating" ? "stageTranslating" : progress?.stage === "answering" ? "stageAnswering" : "asking",
    lang,
  );

  const reset = () => {
    request.current += 1;
    setLive(null);
    setProgress(null);
    setBusy(false);
    setFailed(false);
    setFull(false);
  };

  const pick = (key: string) => {
    reset();
    setTopic(key);
  };

  const ask = async (question: string) => {
    const id = ++request.current;
    setBusy(true);
    setElapsed(0);
    setFailed(false);
    setProgress(null);
    try {
      const answer = await askStream(question, lang, (p) => {
        if (id === request.current) setProgress(p);
      });
      if (id === request.current) setLive(answer);
    } catch {
      if (id === request.current) {
        setFailed(true);
        onCheck();
      }
    } finally {
      if (id === request.current) setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const question = draft.trim();
    if (!question || !canAsk) return;
    reset();
    setTopic(null);
    setOwn(question);
    void ask(question);
  };

  return (
    <div className="panel">
      <h3>{tr("askNasa", lang)}</h3>

      {/* Поле первым: свой вопрос и есть главное, готовые темы под ним */}
      <form className="ask-own" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          maxLength={MAX_QUESTION}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={tr("askPlaceholder", lang)}
          aria-label={tr("askLabel", lang)}
          disabled={!online || !llm}
          onFocus={() => { if (online) onCheck(); }}
        />
        <button type="submit" className="chip" disabled={!canAsk || !draft.trim()}>
          {tr("askSend", lang)}
        </button>
      </form>
      {!online && <p className="footnote">{tr("askNeedsBackend", lang)}</p>}
      {online && !llm && <p className="footnote warn">{tr("llmOff", lang)}</p>}

      <div className="ask-row">
        {TOPICS.map((key) => (
          <button key={key} className="chip" aria-pressed={key === topic} onClick={() => pick(key)}>
            {TOPIC_LABEL[key][lang]}
          </button>
        ))}
      </div>

      <p className="asked">{asked}</p>

      {/* Пока текст идёт потоком, не обрезаем: иначе новые слова прятались бы */}
      <div className={full || busy ? "prose" : "prose clamped"}>
        {streamed ? (
          render(streamed)
        ) : busy ? (
          <p>
            {stage} {tr("seconds", lang, { s: String(elapsed) })}
          </p>
        ) : shown ? (
          render(shown.answer)
        ) : (
          <p>{tr("noAnswer", lang)}</p>
        )}
      </div>
      {!busy && shown && shown.answer.length > 340 && (
        <button className="linkish more" onClick={() => setFull((v) => !v)}>
          {tr(full ? "less" : "more", lang)}
        </button>
      )}

      <p className="footnote" style={{ marginTop: "18px" }}>
        {streamed
          ? `${stage} ${tr("seconds", lang, { s: String(elapsed) })}`
          : busy
            ? null
            : live
              ? tr("answeredNow", lang)
              : entry
                ? tr("cached", lang)
                : null}
        {entry && !live && !busy && canAsk && (
          <>
            {" · "}
            <button className="linkish" onClick={() => void ask(entry.question[lang])}>
              {tr("askLive", lang)}
            </button>
          </>
        )}
        {failed && <>{entry ? ". " : ""}{tr(entry ? "askFailedCached" : "askFailed", lang)}</>}
      </p>

      {sources && sources.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <h3>{tr("sources", lang)}</h3>
          {/* Цитата из PDF нужна для проверки, но три таких блока подряд
              превращают панель в стену текста. Прячем под раскрытие. */}
          {sources.map((s, i) => (
            <details className="source" key={i}>
              <summary title={s.doc_id}>
                {reportTitle(s.doc_id)}
                {s.page != null && `, ${tr("page", lang)} ${s.page}`}
              </summary>
              <q>{s.excerpt.length > 260 ? `${s.excerpt.slice(0, 260)}…` : s.excerpt}</q>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
