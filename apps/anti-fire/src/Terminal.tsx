import { useEffect, useRef, useState } from "react";
import type { Client } from "@sfss/client";
import type { LlmConfig, LlmModels } from "@sfss/types";
import { warningText } from "./conditions";
import { errorText } from "./errors";
import { detectLanguage } from "./citations";
import { complete, configLines, docs, help, helpIndex, parseAsk, parseConfig, parsePredict, tokenize } from "./commands";
import { tr } from "./lang";
import { load, save } from "./storage";
import type { DocumentInfo, HealthInfo, Line, LoadResult, PredictResult } from "./types";
import { LOAD_TIMEOUT_MS } from "./types";

const MAX_HISTORY = 100;
const ASK_STAGES = {
  loading: "termStageLoading",
  searching: "termStageSearching",
  answering: "termStageAnswering",
  translating: "termStageTranslating",
} as const;

/** Те же команды, что у sfss, и журнал всего, что программа отправляет в API. */
export function Terminal({ client, lines, print, replaceLine, clear, onModelChanged, onModelStarting, onService }: {
  client: Client;
  lines: Line[];
  print: (kind: "in" | "out" | "err", text: string) => number;
  replaceLine: (id: number, text: string) => void;
  clear: () => void;
  onModelChanged: () => void;
  onModelStarting: () => void;
  onService: (action: "start" | "stop") => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>(() => load("antifire.history", []));
  const [cursor, setCursor] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const output = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => {
    output.current?.scrollTo({ top: output.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    print("out", tr("termWelcome"));
  }, [print]);

  const copy = async (id: number, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const predict = async (tokens: string[]) => {
    const params = parsePredict(tokens);
    const result = await client.post<PredictResult>("/predict", { parameters: params }, 5000);
    if (result.predicted_value !== null) {
      print("out", tr("termBurn", { value: result.predicted_value.toFixed(3) }));
    } else {
      print("out", tr("termRisk", { value: result.risk_score.toFixed(3) }));
    }
    if (result.is_heuristic) print("out", tr("heuristic"));
    for (const warning of result.warnings) print("out", tr("termWarning", { text: warningText(warning) }));
    if (result.defaults_applied.length) print("out", tr("termDefaults", { names: result.defaults_applied.join(", ") }));
  };

  const ask = async (tokens: string[]) => {
    const { question, lang } = parseAsk(tokens);
    const line = print("out", tr("termStageSearching"));
    const answer = await client.askStream(
      question, lang ?? detectLanguage(question),
      (progress) => {
        if (progress.text) replaceLine(line, progress.text);
        else replaceLine(line, tr(ASK_STAGES[progress.stage]));
      },
      180_000,
    );
    replaceLine(line, answer.answer);
    answer.sources.forEach((source, i) => {
      print("out", `[${i + 1}] ${source.doc_id}${source.page === null ? "" : `, ${tr("page")} ${source.page}`}`);
    });
  };

  const status = async () => {
    const health = await client.get<HealthInfo>("/health", 4000);
    print("out", tr("termServiceUp", { base: client.base }));
    print("out", health.chroma ? tr("termIndexOk", { count: health.indexed_documents ?? 0 }) : tr("termIndexDown"));
    const runtime = { runtime: (health.runtime_name ?? "LM Studio").padEnd(11), address: health.runtime_address ?? "" };
    print("out", health.lm_studio ? tr("termLmOk", runtime) : tr("termLmDown", runtime));
    const state = health.model_loaded === null
      ? ""
      : health.model_loaded
        ? tr("termStateLoaded", { context: health.model_context_length ?? "" })
        : tr("termStateNotLoaded");
    print("out", tr("termModel", { model: health.model, state }));
  };

  const loadModel = async () => {
    print("out", tr("termLoading"));
    onModelStarting();
    const result = await client.post<LoadResult>("/llm/load", {}, LOAD_TIMEOUT_MS);
    print("out", tr("termModelLoaded", { model: result.model, context: result.model_context_length ?? "" }));
    onModelChanged();
  };

  const unloadModel = async () => {
    const result = await client.post<LoadResult>("/llm/unload", {}, LOAD_TIMEOUT_MS);
    print("out", tr("termUnloaded", { model: result.model }));
    onModelChanged();
  };

  const config = async (tokens: string[]) => {
    const request = parseConfig(tokens);
    if (request.action === "models") {
      const [{ models }, health] = await Promise.all([
        client.get<LlmModels>("/llm/models"),
        client.get<HealthInfo>("/health", 4000, true),
      ]);
      if (!models.length) print("out", tr("termConfigNoModels"));
      for (const model of models) {
        const marks = [model.id === health.model && tr("termConfigChosen"), model.loaded && tr("termConfigLoaded")].filter(Boolean);
        print("out", marks.length ? `${model.id}  (${marks.join(", ")})` : model.id);
      }
      return;
    }
    const view = request.action === "patch"
      ? await client.patch<LlmConfig>("/llm/config", request.patch, LOAD_TIMEOUT_MS)
      : request.action === "reset"
        ? await client.del<LlmConfig>("/llm/config", LOAD_TIMEOUT_MS)
        : await client.get<LlmConfig>("/llm/config");
    for (const text of configLines(view)) print("out", text);
    onModelChanged();
  };

  const run = async (line: string) => {
    const [command, ...tokens] = tokenize(line);
    print("in", `$ ${line}`);
    try {
      switch (command) {
        case "predict": await predict(tokens); break;
        case "ask": await ask(tokens); break;
        case "config": await config(tokens); break;
        case "load": await loadModel(); break;
        case "start": case "stop": await onService(command); break;
        case "unload": await unloadModel(); break;
        case "status": await status(); break;
        case "import": fileInput.current?.click(); break;
        case "clear": clear(); break;
        case "help": {
          const text = tokens[0] ? help()[tokens[0]] : helpIndex();
          print(text ? "out" : "err", text ?? tr("termNoCommand", { name: tokens[0] }));
          break;
        }
        case "docs": {
          const text = docs()[tokens[0] ?? "index"];
          print(text ? "out" : "err", text ?? tr("termNoDocs", { name: tokens[0] }));
          break;
        }
        default:
          print("err", tr("termNoCommandList", { name: command }));
      }
    } catch (error) {
      print("err", errorText(error));
    }
  };

  const importFile = async (file: File) => {
    print("out", tr("termIndexing", { name: file.name }));
    const form = new FormData();
    form.append("file", file);
    try {
      const document = await client.send<DocumentInfo>(
        "POST", "/documents", { body: form, ms: 900_000 }, (res) => res.json() as Promise<DocumentInfo>,
      );
      print("out", tr("added", { id: document.doc_id, chunks: document.chunks }));
    } catch (error) {
      print("err", `${file.name}: ${errorText(error)}`);
    }
  };

  const submit = () => {
    const line = value.trim();
    if (!line) return;
    setValue("");
    setCursor(null);
    setHistory((all) => {
      const next = [...all.filter((item) => item !== line), line].slice(-MAX_HISTORY);
      save("antifire.history", next);
      return next;
    });
    void run(line);
  };

  const step = (delta: number) => {
    if (!history.length) return;
    const from = cursor ?? history.length;
    const next = Math.min(history.length, Math.max(0, from + delta));
    setCursor(next === history.length ? null : next);
    setValue(next === history.length ? "" : history[next]);
  };

  return (
    <section className="terminal" aria-label={tr("terminal")}>
      <div className="output" ref={output} role="log">
        {lines.map((line) => (
          <div key={line.id} className={`line ${line.kind}`}>
            <span className="text">{line.text}</span>
            {line.kind === "req" && (
              <button className="curl" onClick={() => void copy(line.id, line.curl)} title={line.curl}>
                {copied === line.id ? tr("copiedLower") : "curl"}
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        className="prompt"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <span aria-hidden="true">$</span>
        <input
          value={value}
          aria-label={tr("command")}
          placeholder="help"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
            setCursor(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") { event.preventDefault(); step(-1); }
            else if (event.key === "ArrowDown") { event.preventDefault(); step(1); }
            else if (event.key === "Tab") { event.preventDefault(); setValue(complete(value)); }
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </form>
    </section>
  );
}
