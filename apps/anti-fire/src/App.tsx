import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type RequestRecord } from "@sfss/client";
import { LlmSettings } from "@sfss/LlmSettings";
import { AiPanel, type AiHandle } from "./AiPanel";
import { Calculator } from "./Calculator";
import { toCurl } from "./commands";
import { DataScreen } from "./DataScreen";
import { getLang, setLang, tr } from "./lang";
import { PageViewer, usePageViewer } from "./PageViewer";
import { canControl, controlService, localPort, SFSS_NOT_FOUND } from "./service";
import { load, save } from "./storage";
import { Terminal } from "./Terminal";
import { errorText } from "./errors";
import type { DashboardInfo, HealthInfo, Line, LoadResult } from "./types";
import { LOAD_TIMEOUT_MS } from "./types";

const DEFAULT_BASE = import.meta.env.VITE_API || "http://127.0.0.1:8000";
// Состояние модели меняют и снаружи, из Bionic или lms. Запрос дешёвый, около 0,2 с
const HEALTH_EVERY_MS = 2000;
// Спросить сразу после нажатия: статус «загружается» не должен ждать опроса
const SERVICE_REACTS_MS = 200;
const MAX_LINES = 500;
const TERMINAL_DEFAULT = 210;
const TERMINAL_MIN = 40; // одна строка ввода: терминал убран, но под рукой
const BODY_MIN_DEFAULT = 340; // пока экран расчёта не измерен

interface Connection { base: string; key: string }

/** Anti-Fire: программа, для которой SFSS — внешний сервис.
 *
 *  Один экран без режимов: условия и результат, рядом всегда открытый AI, снизу
 *  терминал, где виден каждый запрос. Ничего не считает сама и не хранит снятых
 *  ответов: нет сервиса — так и говорит. */
export default function App() {
  const [connection, setConnection] = useState<Connection>(() =>
    load("antifire.connection", { base: DEFAULT_BASE, key: "" }),
  );
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [checked, setChecked] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardInfo | null>(null);
  const [screen, setScreen] = useState<"work" | "data">("work");
  const [aiExpanded, setAiExpanded] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [terminalHeight, setTerminalHeight] = useState(() => load("antifire.terminal", TERMINAL_DEFAULT));
  const [bodyMin, setBodyMin] = useState(BODY_MIN_DEFAULT);
  const [lang, setLangState] = useState(getLang);
  const checking = useRef(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [service, setService] = useState<"starting" | "stopping" | null>(null);
  const nextLine = useRef(1);
  const ai = useRef<AiHandle>(null);

  const print = useCallback((kind: "in" | "out" | "err", text: string) => {
    const id = nextLine.current++;
    setLines((all) => [...all, { id, kind, text }].slice(-MAX_LINES));
    return id;
  }, []);

  const replaceLine = useCallback((id: number, text: string) => {
    setLines((all) => all.map((line) => (line.id === id ? { ...line, text } : line)));
  }, []);

  const client = useMemo(() => {
    const onRequest = (record: RequestRecord) => {
      const id = nextLine.current++;
      const status = record.status ?? tr("noResponse");
      const text = `${record.method} ${record.path}  ${status}  ${record.ms} ms`;
      const curl = toCurl(record, Boolean(connection.key));
      setLines((all) => [...all, { id, kind: "req" as const, text, curl }].slice(-MAX_LINES));
    };
    return createClient({ base: connection.base, key: connection.key || undefined, prefix: "/v1", onRequest });
  }, [connection]);

  const online = health !== null;
  const { viewer, open: openPage, close: closePage } = usePageViewer(client);

  const checkHealth = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      setHealth(await client.get<HealthInfo>("/health", 4000, true));
    } catch {
      setHealth(null);
    } finally {
      checking.current = false;
      setChecked(true);
    }
  }, [client]);

  useEffect(() => {
    void checkHealth();
    const timer = setInterval(() => void checkHealth(), HEALTH_EVERY_MS);
    // Вернулись из другого окна: там могли выгрузить модель, узнаём сразу
    const onFocus = () => void checkHealth();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkHealth]);

  // Терминал не поднимается выше заголовка таблицы. Высота условий меняется с
  // ошибками ввода и шириной окна, поэтому она измеряется, а не задана числом.
  useEffect(() => {
    const calc = document.querySelector<HTMLElement>(".calc");
    const area = calc?.querySelector<HTMLElement>(".table-area");
    const bar = area?.querySelector<HTMLElement>(".table-bar");
    if (!calc || !area || !bar) return;
    const measure = () => {
      const box = calc.getBoundingClientRect();
      if (!box.height) return;
      const above = area.getBoundingClientRect().top - box.top + calc.scrollTop;
      setBodyMin(Math.ceil(box.top + above + bar.offsetHeight));
    };
    const observer = new ResizeObserver(measure);
    for (const element of [calc, bar, ...calc.querySelectorAll<HTMLElement>(".conditions, .result")]) observer.observe(element);
    return () => observer.disconnect();
  }, [screen]);

  useEffect(() => {
    if (!online) return;
    let stop = false;
    client
      .get<DashboardInfo>("/dashboard", 15_000, true)
      .then((next) => { if (!stop) setDashboard(next); })
      .catch(() => { if (!stop) setDashboard(null); });
    return () => { stop = true; };
  }, [client, online]);

  // Слэш ведёт к вопросу: AI всегда под рукой, без мыши и переключений
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        setScreen("work");
        ai.current?.focus();
      }
      if (event.key === "Escape") setAiExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resizeTerminal = useCallback((height: number) => {
    const next = Math.round(Math.max(TERMINAL_MIN, Math.min(window.innerHeight - bodyMin, height)));
    setTerminalHeight(next);
    save("antifire.terminal", next);
  }, [bodyMin]);

  const switchModel = async (action: "load" | "unload") => {
    setModelBusy(true);
    setTimeout(() => void checkHealth(), SERVICE_REACTS_MS);
    try {
      await client.post<LoadResult>(`/llm/${action}`, {}, LOAD_TIMEOUT_MS);
    } catch (error) {
      print("err", errorText(error));
    } finally {
      setModelBusy(false);
      void checkHealth();
    }
  };

  const controllable = canControl(connection.base);

  const controlSfss = async (action: "start" | "stop") => {
    print("in", `$ sfss ${action}`);
    if (!controllable) {
      const remote = localPort(connection.base) === null;
      print("err", remote ? tr("serviceRemote") : tr("serviceBrowserOnly", { action }));
      return;
    }
    setService(action === "start" ? "starting" : "stopping");
    try {
      // Без сервиса модель из программы уже не выгрузить, а память она держит
      if (action === "stop") await client.post<LoadResult>("/llm/unload", {}, LOAD_TIMEOUT_MS).catch(() => null);
      let streamed = false;
      const output = await controlService(action, connection.base, (line) => {
        streamed = true;
        print("out", line);
      }).catch((error: unknown) => {
        // Строки уже в терминале: из ошибки печатаем только последнюю, причину
        if (streamed && typeof error === "string") throw error.split("\n").pop() ?? error;
        throw error;
      });
      if (output && !streamed) print("out", output);
      const answers = await client.get<HealthInfo>("/health", 4000, true).then(() => true, () => false);
      if (action === "stop" && answers) print("err", tr("serviceStillUp"));
      if (action === "start" && !answers) print("err", tr("serviceNotUp", { base: connection.base }));
    } catch (error) {
      print("err", error === SFSS_NOT_FOUND ? tr("serviceNotFound") : typeof error === "string" ? error : errorText(error));
    } finally {
      setService(null);
      void checkHealth();
    }
  };

  const chooseLang = (next: typeof lang) => {
    setLang(next);
    setLangState(next);
  };

  const connect = (next: Connection) => {
    const cleaned = { base: next.base.trim().replace(/\/+$/, ""), key: next.key.trim() };
    setConnection(cleaned);
    save("antifire.connection", cleaned);
    setHealth(null);
    setChecked(false);
    setShowConnection(false);
  };

  return (
    <div className="app" style={{ "--terminal-height": `${terminalHeight}px`, "--body-min": `${bodyMin}px` } as CSSProperties}>
      <header className="top">
        <strong className="brand">Anti-Fire</strong>
        <div className="lang" role="group" aria-label={tr("language")} title={tr("language")}>
          {(["ru", "en"] as const).map((option) => (
            <button
              key={option}
              className={lang === option ? "lang-option on" : "lang-option"}
              aria-pressed={lang === option}
              onClick={() => chooseLang(option)}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
        <nav className="tabs" aria-label={tr("screen")}>
          <button className={screen === "work" ? "tab on" : "tab"} onClick={() => setScreen("work")}>{tr("tabWork")}</button>
          <button className={screen === "data" ? "tab on" : "tab"} onClick={() => setScreen("data")}>{tr("tabData")}</button>
        </nav>
        <button className="status" onClick={() => setShowConnection((open) => !open)} title={tr("connectionTitle")}>
          <Dot state={online ? "ok" : "bad"} /> SFSS
          <Dot state={llmState(health)} /> {modelLabel(health)}
        </button>
        <button className="model-action" title={tr("aiSettingsTitle")} onClick={() => setShowSettings(true)}>
          {tr("aiSettings")}
        </button>
        {health && !health.model_loading && (
          // Пока идёт ответ, выгрузка оборвала бы его
          health.model_loaded ? (
            <button className="model-action" title={tr("unloadTitle")} disabled={modelBusy || aiBusy} onClick={() => void switchModel("unload")}>
              {tr("unload")}
            </button>
          ) : (
            <button className="model-action" title={tr("loadTitle")} disabled={modelBusy || aiBusy} onClick={() => void switchModel("load")}>
              {tr("load")}
            </button>
          )
        )}
        {controllable && online && !service && (
          <button className="model-action" title={tr("serviceStopTitle")} disabled={aiBusy || modelBusy} onClick={() => void controlSfss("stop")}>
            {tr("serviceStop")}
          </button>
        )}
      </header>

      {showSettings && (
        <LlmSettings
          client={client}
          lang={lang}
          busy={aiBusy || modelBusy}
          describeError={errorText}
          onClose={() => setShowSettings(false)}
          onChanged={() => void checkHealth()}
        />
      )}
      {showConnection && <ConnectionForm connection={connection} onConnect={connect} onCancel={() => setShowConnection(false)} />}

      <main className={`body${aiExpanded && screen === "work" ? " expanded" : ""}${aiExpanded && viewer && screen === "work" ? " with-page" : ""}`}>
        {service && <p className="service-progress" role="status">{tr(service === "starting" ? "serviceStarting" : "serviceStopping")}</p>}
        {!online && checked && !showConnection && !service && (
          <Offline
            base={connection.base}
            onStart={controllable ? () => void controlSfss("start") : null}
            onChange={() => setShowConnection(true)}
          />
        )}
        {screen === "work" ? (
          <>
            {/* Расчёт скрыт, а не убран: иначе закрытие страницы теряло бы ввод */}
            <div className="left" hidden={aiExpanded || Boolean(viewer)}>
              <Calculator client={client} online={online} dashboard={dashboard} print={print} />
            </div>
            {viewer && <PageViewer viewer={viewer} onClose={closePage} />}
            <AiPanel
              ref={ai}
              client={client}
              health={health}
              expanded={aiExpanded}
              onToggleExpanded={() => setAiExpanded((open) => !open)}
              onOpenPage={(docId, page) => void openPage(docId, page)}
              onModelChanged={() => void checkHealth()}
              onModelStarting={() => setTimeout(() => void checkHealth(), SERVICE_REACTS_MS)}
              onBusyChange={setAiBusy}
            />
          </>
        ) : (
          <DataScreen client={client} online={online} dashboard={dashboard} print={print} />
        )}
      </main>

      <div
        className="splitter"
        role="separator"
        aria-orientation="horizontal"
        aria-label={tr("terminalHeight")}
        aria-valuenow={terminalHeight}
        tabIndex={0}
        title={tr("terminalHandle")}
        onDoubleClick={() => resizeTerminal(TERMINAL_DEFAULT)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") { event.preventDefault(); resizeTerminal(terminalHeight + 24); }
          if (event.key === "ArrowDown") { event.preventDefault(); resizeTerminal(terminalHeight - 24); }
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            resizeTerminal(window.innerHeight - event.clientY);
          }
        }}
      />

      <Terminal
        client={client}
        lines={lines}
        print={print}
        replaceLine={replaceLine}
        clear={() => setLines([])}
        onModelChanged={() => void checkHealth()}
        onModelStarting={() => setTimeout(() => void checkHealth(), SERVICE_REACTS_MS)}
        onService={controlSfss}
      />
    </div>
  );
}

function llmState(health: HealthInfo | null): "ok" | "warn" | "bad" {
  if (!health) return "bad";
  if (health.model_loading || !health.lm_studio || health.model_loaded === false) return "warn";
  return "ok";
}

function modelLabel(health: HealthInfo | null): string {
  if (!health) return tr("model");
  if (health.model_loading) return tr("modelLoading", { model: health.model });
  if (!health.lm_studio) return tr("lmDown", { runtime: health.runtime_name ?? "LM Studio" });
  return health.model_loaded === false ? tr("modelNotLoaded", { model: health.model }) : health.model;
}

function Dot({ state }: { state: "ok" | "warn" | "bad" }) {
  return <span className={`dot ${state}`} aria-label={tr(({ ok: "dotOk", warn: "dotWarn", bad: "dotBad" } as const)[state])} />;
}

function Offline({ base, onStart, onChange }: { base: string; onStart: (() => void) | null; onChange: () => void }) {
  return (
    <div className="offline" role="alert">
      {onStart ? (
        <>
          <span>{tr("offlineNative", { base })}</span>
          <button className="primary" onClick={onStart}>{tr("serviceStart")}</button>
        </>
      ) : (
        <>
          <span>{tr("offline", { base })}</span>
          <code>sfss start</code>
        </>
      )}
      <button onClick={onChange}>{tr("otherAddress")}</button>
    </div>
  );
}

function ConnectionForm({ connection, onConnect, onCancel }: {
  connection: Connection;
  onConnect: (next: Connection) => void;
  onCancel: () => void;
}) {
  const [base, setBase] = useState(connection.base);
  const [key, setKey] = useState(connection.key);
  return (
    <form
      className="connection"
      onSubmit={(event) => {
        event.preventDefault();
        onConnect({ base, key });
      }}
    >
      <label>{tr("address")} <input value={base} onChange={(e) => setBase(e.target.value)} /></label>
      <label>{tr("keyLabel")} <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" /></label>
      <button type="submit" className="primary">{tr("connect")}</button>
      <button type="button" onClick={onCancel}>{tr("cancel")}</button>
    </form>
  );
}
