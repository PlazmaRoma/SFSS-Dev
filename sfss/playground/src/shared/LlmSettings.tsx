import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Client } from "./client";
import type { Lang, LlmConfig, LlmModels, LlmPatch, RuntimeKind } from "./types";
import "./llm-settings.css";

/** Сервис может выгружать прежнюю модель, это не быстро. Он сдаётся через 180 с. */
const SAVE_MS = 200_000;
const DEFAULT_PORTS: Record<RuntimeKind, number> = { lmstudio: 1234, ollama: 11434 };
const RUNTIME_NAMES: Record<RuntimeKind, string> = { lmstudio: "LM Studio", ollama: "Ollama" };

const TEXT = {
  ru: {
    title: "Настройки AI",
    runtime: "Рантайм",
    runtimeHint: "Программа, в которой работает нейросеть.",
    host: "Адрес",
    port: "Порт",
    reachable: "{name} отвечает на {address}",
    unreachable: "{name} не отвечает на {address}. Сервис запустит его при загрузке модели, если он на этой машине.",
    check: "Проверить",
    save: "Сохранить",
    saved: "Сохранено",
    model: "Модель",
    modelHint: "Какая нейросеть отвечает на вопросы.",
    name: "Модель",
    missing: "{name} (нет у рантайма)",
    noList: "Список недоступен: рантайм не отвечает. Имя можно ввести вручную.",
    context: "Контекст, токенов",
    contextOllama: "Контекст Ollama задаётся у неё: OLLAMA_CONTEXT_LENGTH.",
    maxTokens: "Длина ответа, токенов",
    needNumber: "Нужно целое число",
    embedding: "Поиск по отчётам: {name}. Меняется только в .env и с новой индексацией.",
    reset: "Вернуть из .env",
    close: "Закрыть",
    busy: "Сейчас идёт ответ: сохранить можно, когда он закончится.",
    offline: "SFSS не отвечает. Запустите его: sfss start. Без него настройки меняются только командой sfss config.",
    failed: "Сервис не принял настройку",
  },
  en: {
    title: "AI settings",
    runtime: "Runtime",
    runtimeHint: "The program the model runs in.",
    host: "Host",
    port: "Port",
    reachable: "{name} responds at {address}",
    unreachable: "{name} is not responding at {address}. The service starts it when loading the model, if it is on this machine.",
    check: "Check",
    save: "Save",
    saved: "Saved",
    model: "Model",
    modelHint: "Which model answers the questions.",
    name: "Model",
    missing: "{name} (not in the runtime)",
    noList: "No list: the runtime is not responding. You can type the name.",
    context: "Context, tokens",
    contextOllama: "Ollama sets its own context: OLLAMA_CONTEXT_LENGTH.",
    maxTokens: "Answer length, tokens",
    needNumber: "A whole number is needed",
    embedding: "Report search: {name}. Changed only in .env, with a new indexing run.",
    reset: "Back to .env",
    close: "Close",
    busy: "An answer is in progress: you can save when it finishes.",
    offline: "SFSS is not responding. Start it: sfss start. Without it, settings change only with sfss config.",
    failed: "The service did not accept the setting",
  },
} as const;

type TextKey = keyof typeof TEXT["en"];

function wholeNumber(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() && Number.isInteger(value) ? value : null;
}

/** Рантайм и модель сохраняются каждый своей кнопкой: это разные решения, и смена
 *  рантайма сразу показывает модели нового. Общее окно для Anti-Fire и Площадки. */
export function LlmSettings({ client, lang, busy = false, describeError, onClose, onChanged }: {
  /** Клиент с префиксом /v1: настроек нет на старых путях. */
  client: Client;
  lang: Lang;
  /** Идёт ответ: выгрузка прежней модели оборвала бы его. */
  busy?: boolean;
  describeError?: (error: unknown) => string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const t = (key: TextKey, vars?: Record<string, string | number>) => {
    let text: string = TEXT[lang][key];
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{${name}}`, String(value));
    return text;
  };

  const dialog = useRef<HTMLDialogElement>(null);
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [offline, setOffline] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [kind, setKind] = useState<RuntimeKind>("lmstudio");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<"runtime" | "model" | null>(null);

  const explain = (cause: unknown) =>
    describeError ? describeError(cause) : cause instanceof ApiError && cause.detail ? cause.detail : t("failed");

  const show = useCallback(async (next: LlmConfig) => {
    setConfig(next);
    setKind(next.runtime.kind);
    setHost(next.runtime.host);
    setPort(String(next.runtime.port));
    setName(next.model.name);
    setContext(String(next.model.context_length));
    setMaxTokens(String(next.model.max_tokens));
    try {
      const list = await client.get<LlmModels>("/llm/models", 8000, true);
      setModels(list.models.map((model) => model.id));
    } catch {
      setModels([]);
    }
  }, [client]);

  const read = useCallback(async () => {
    try {
      await show(await client.get<LlmConfig>("/llm/config", 8000, true));
      setOffline(false);
    } catch {
      setConfig(null);
      setOffline(true);
    }
  }, [client, show]);

  useEffect(() => {
    dialog.current?.showModal();
    void read();
  }, [read]);

  const save = async (part: "runtime" | "model", patch: LlmPatch) => {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await show(await client.patch<LlmConfig>("/llm/config", patch, SAVE_MS));
      setSaved(part);
      onChanged?.();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await show(await client.del<LlmConfig>("/llm/config", SAVE_MS));
      onChanged?.();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setSaving(false);
    }
  };

  const chooseKind = (next: RuntimeKind) => {
    // Порт прежнего рантайма новому не подойдёт, а свой порт человек введёт сам
    if (wholeNumber(port) === DEFAULT_PORTS[kind]) setPort(String(DEFAULT_PORTS[next]));
    setKind(next);
    setSaved(null);
  };

  const portValue = wholeNumber(port);
  const contextValue = wholeNumber(context);
  const tokensValue = wholeNumber(maxTokens);
  const runtimeChanged = config !== null && (
    kind !== config.runtime.kind || host.trim() !== config.runtime.host || portValue !== config.runtime.port
  );
  const modelChanged = config !== null && (
    name.trim() !== config.model.name
    || contextValue !== config.model.context_length
    || tokensValue !== config.model.max_tokens
  );
  const locked = saving || busy;

  return (
    <dialog ref={dialog} className="llm-settings" aria-label={t("title")} onClose={onClose}>
      <header className="llm-head">
        <h2>{t("title")}</h2>
        <button type="button" onClick={() => dialog.current?.close()}>{t("close")}</button>
      </header>

      {offline && <p className="llm-note llm-bad" role="alert">{t("offline")}</p>}
      {busy && <p className="llm-note">{t("busy")}</p>}

      {config && (
        <>
          <form
            className="llm-group"
            onSubmit={(event) => {
              event.preventDefault();
              void save("runtime", { runtime: { kind, host: host.trim(), port: portValue ?? undefined } });
            }}
          >
            <h3>{t("runtime")}</h3>
            <p className="llm-note">{t("runtimeHint")}</p>
            <div className="llm-choice" role="radiogroup" aria-label={t("runtime")}>
              {(Object.keys(RUNTIME_NAMES) as RuntimeKind[]).map((option) => (
                <label key={option} className={kind === option ? "on" : undefined}>
                  <input type="radio" name="llm-runtime" checked={kind === option} onChange={() => chooseKind(option)} />
                  {RUNTIME_NAMES[option]}
                </label>
              ))}
            </div>
            <div className="llm-row">
              <label className="llm-wide">{t("host")}
                <input value={host} spellCheck={false} autoCapitalize="off" onChange={(e) => setHost(e.target.value)} />
              </label>
              <label>{t("port")}
                <input value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} />
              </label>
            </div>
            <p className={config.runtime.reachable ? "llm-note llm-ok" : "llm-note llm-warn"} role="status">
              {t(config.runtime.reachable ? "reachable" : "unreachable", {
                name: config.runtime.name,
                address: `${config.runtime.host}:${config.runtime.port}`,
              })}
            </p>
            <div className="llm-actions">
              <button type="submit" className="llm-primary" disabled={locked || !runtimeChanged || portValue === null || !host.trim()}>{t("save")}</button>
              <button type="button" disabled={saving} onClick={() => void read()}>{t("check")}</button>
              {saved === "runtime" && <span className="llm-note llm-ok" role="status">{t("saved")}</span>}
            </div>
          </form>

          <form
            className="llm-group"
            onSubmit={(event) => {
              event.preventDefault();
              void save("model", {
                model: {
                  name: name.trim(),
                  max_tokens: tokensValue ?? undefined,
                  context_length: config.runtime.controls_context ? contextValue ?? undefined : undefined,
                },
              });
            }}
          >
            <h3>{t("model")}</h3>
            <p className="llm-note">{t("modelHint")}</p>
            <label>{t("name")}
              {models.length ? (
                <select value={name} onChange={(e) => setName(e.target.value)}>
                  {!models.includes(name) && <option value={name}>{t("missing", { name })}</option>}
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              ) : (
                <input value={name} spellCheck={false} autoCapitalize="off" onChange={(e) => setName(e.target.value)} />
              )}
            </label>
            {!models.length && <p className="llm-note">{t("noList")}</p>}
            <div className="llm-row">
              {config.runtime.controls_context && (
                <label>{t("context")}
                  <input value={context} inputMode="numeric" onChange={(e) => setContext(e.target.value)} />
                </label>
              )}
              <label>{t("maxTokens")}
                <input value={maxTokens} inputMode="numeric" onChange={(e) => setMaxTokens(e.target.value)} />
              </label>
            </div>
            {!config.runtime.controls_context && <p className="llm-note">{t("contextOllama")}</p>}
            <div className="llm-actions">
              <button type="submit" className="llm-primary" disabled={locked || !modelChanged || !name.trim() || tokensValue === null || contextValue === null}>{t("save")}</button>
              {saved === "model" && <span className="llm-note llm-ok" role="status">{t("saved")}</span>}
            </div>
          </form>

          {error && <p className="llm-note llm-bad" role="alert">{error}</p>}

          <footer className="llm-foot">
            <p className="llm-note">{t("embedding", { name: config.embedding_model })}</p>
            <button type="button" disabled={locked} onClick={() => void reset()}>{t("reset")}</button>
          </footer>
        </>
      )}
    </dialog>
  );
}
