import { PSI_TO_MMHG } from "@sfss/lib/risk";
import type { RequestRecord } from "@sfss/client";
import type { Lang, LlmConfig, LlmPatch } from "@sfss/types";
import { getLang, tr } from "./lang";

export const COMMANDS = ["predict", "ask", "import", "load", "unload", "config", "start", "stop", "status", "help", "docs", "clear"] as const;
const PREDICT_FLAGS = ["--o2", "--n2", "--co2", "--he", "--pressure", "--psi", "--droplet", "--fuel"];
const ASK_FLAGS = ["--lang"];
const CONFIG_ACTIONS = ["runtime", "model", "models", "reset"];
const CONFIG_RUNTIME_FLAGS = ["--host", "--port"];
const CONFIG_MODEL_FLAGS = ["--context", "--max-tokens"];
const RUNTIMES = ["lmstudio", "ollama"];

const HELP_TEXT: Record<Lang, Record<string, string>> = {
  ru: {
    predict: `predict [--o2 ДОЛЯ] [--pressure ММ_РТ_СТ | --psi PSI] [--n2 ДОЛЯ] [--co2 ДОЛЯ] [--he ДОЛЯ]
        [--droplet ММ] [--fuel methanol|heptane]
Скорость горения капли. Газы — доли от 0 до 1. Без --n2 азот дополняет смесь до единицы.
Пример: predict --o2 0.30 --psi 8.2`,
    ask: `ask "вопрос" [--lang ru|en]
Вопрос по отчётам NASA, ответ со ссылками на страницы. Занимает 30-60 с.
Пример: ask "Как гелий влияет на горение?"`,
    import: `import
Выбрать PDF и добавить его в корпус документов. В обычном терминале: sfss import файл.pdf`,
    load: "load\nЗагрузить модель в память, не открывая её рантайм. Занимает до минуты.\nПри первом вопросе модель загружается сама.",
    config: `config
config runtime [lmstudio|ollama] [--host АДРЕС] [--port ПОРТ]
config model [ИМЯ] [--context ТОКЕНЫ] [--max-tokens ТОКЕНЫ]
config models
config reset
Настройки AI: где работает нейросеть и какая она. Применяются сразу, без перезапуска.
Смена рантайма ставит его стандартный порт: LM Studio 1234, Ollama 11434.
reset возвращает значения из .env. То же в окне «Настройки AI» и в команде sfss config.
Пример: config runtime ollama`,
    unload: "unload\nВыгрузить модель из памяти. Следующий вопрос загрузит её снова.",
    start: "start\nЗапустить SFSS на этой машине, на порту из адреса подключения. Только в приложении.",
    stop: "stop\nВыгрузить модель и остановить SFSS. Только в приложении.",
    status: "status\nСостояние сервиса, индекса и модели.",
    help: "help [команда]\nСправка по команде.",
    docs: "docs [api|csv|access|limits]\nДокументация прямо здесь. Полная версия: sfss/docs/INTEGRATION.md",
    clear: "clear\nОчистить терминал.",
  },
  en: {
    predict: `predict [--o2 FRACTION] [--pressure MMHG | --psi PSI] [--n2 FRACTION] [--co2 FRACTION] [--he FRACTION]
        [--droplet MM] [--fuel methanol|heptane]
Burning rate of a droplet. Gases are fractions from 0 to 1. Without --n2, nitrogen fills the mix up to one.
Example: predict --o2 0.30 --psi 8.2`,
    ask: `ask "question" [--lang ru|en]
Ask the NASA reports, with links to pages in the answer. Takes 30-60 s.
Example: ask "How does helium affect burning?"`,
    import: `import
Pick a PDF and add it to the documents. In a regular terminal: sfss import file.pdf`,
    load: "load\nLoad the model into memory without opening its runtime. Takes up to a minute.\nThe first question also loads it.",
    config: `config
config runtime [lmstudio|ollama] [--host HOST] [--port PORT]
config model [NAME] [--context TOKENS] [--max-tokens TOKENS]
config models
config reset
AI settings: where the model runs and which one it is. Applied at once, no restart.
Changing the runtime sets its standard port: LM Studio 1234, Ollama 11434.
reset returns to the values in .env. The same is in the AI settings window and in sfss config.
Example: config runtime ollama`,
    unload: "unload\nUnload the model from memory. The next question loads it again.",
    start: "start\nStart SFSS on this machine, on the port from the connection address. App only.",
    stop: "stop\nUnload the model and stop SFSS. App only.",
    status: "status\nState of the service, the index and the model.",
    help: "help [command]\nHelp on a command.",
    docs: "docs [api|csv|access|limits]\nDocumentation right here. Full version: sfss/docs/INTEGRATION.md",
    clear: "clear\nClear the terminal.",
  },
};

const HELP_INDEX: Record<Lang, string> = {
  ru: `predict   скорость горения при заданной атмосфере
ask       вопрос по отчётам NASA
import    добавить PDF в корпус
load      загрузить модель в память
unload    выгрузить модель из памяти
config    настройки AI: рантайм, порт, модель
start     запустить SFSS
stop      остановить SFSS
status    состояние сервиса
docs      документация
clear     очистить экран
Подробнее: help predict. Tab дополняет, стрелки листают историю.`,
  en: `predict   burning rate in a given atmosphere
ask       ask the NASA reports
import    add a PDF to the documents
load      load the model into memory
unload    unload the model from memory
config    AI settings: runtime, port, model
start     start SFSS
stop      stop SFSS
status    state of the service
docs      documentation
clear     clear the screen
More: help predict. Tab completes, arrows browse the history.`,
};

const DOCS_TEXT: Record<Lang, Record<string, string>> = {
  ru: {
    index: `Эта программа — всего лишь клиент SFSS. Всё, что она делает, может сделать и ваша.
Каждый запрос виден здесь, кнопка [curl] копирует его как команду.

docs api      все запросы
docs csv      пакетный расчёт
docs access   ключ и доступ с других машин
docs limits   чего модель не умеет`,
    api: `GET  /v1/health                         состояние сервиса
POST /v1/llm/load                       загрузить модель в память
POST /v1/llm/unload                     выгрузить модель из памяти
GET  /v1/llm/config                     настройки AI: рантайм и модель
PATCH /v1/llm/config                    изменить настройки, сразу и без перезапуска
DELETE /v1/llm/config                   вернуть значения из .env
GET  /v1/llm/models                     какие модели есть у рантайма
GET  /v1/dashboard                      опыты FLEX, качество модели
POST /v1/predict                        скорость горения
POST /v1/predict/batch                  много условий, JSON или CSV
POST /v1/query                          ответ по отчётам
POST /v1/query/stream                   то же, по мере генерации
GET  /v1/documents                      список отчётов
POST /v1/documents                      добавить PDF
GET  /v1/documents/{id}/pages/{n}       страница как PDF`,
    csv: `Колонки CSV: oxygen_level, n2, co2, he, pressure_mmhg, d_initial_mm, fuel_methanol, fuel_heptane.
Газы — доли от 0 до 1. Пустая ячейка значит «не задано», подставится воздух.
Азот сервис не досчитывает: задавайте n2 явно, иначе сумма газов выйдет не из единицы.
Плохая строка получает error, остальные считаются. Предел — 10 000 строк.`,
    access: `С этой машины ключ не нужен. С другого адреса: SFSS_API_KEY в .env,
sfss start --host 0.0.0.0 и заголовок X-API-Key.`,
    limits: `Модель считает скорость горения капель топлива по опытам FLEX. Материалов в ней нет.
Обучена на кислороде 12-34 %: выше выходит на плато, об этом предупреждает warnings.
Ответы AI пишет маленькая локальная модель: проверяйте их по ссылкам на страницы.`,
  },
  en: {
    index: `This program is only a client of SFSS. Anything it does, yours can do too.
Every request shows up here, and the [curl] button copies it as a command.

docs api      all requests
docs csv      batch calculation
docs access   key and access from other machines
docs limits   what the model cannot do`,
    api: `GET  /v1/health                         state of the service
POST /v1/llm/load                       load the model into memory
POST /v1/llm/unload                     unload the model from memory
GET  /v1/llm/config                     AI settings: runtime and model
PATCH /v1/llm/config                    change the settings, at once and without a restart
DELETE /v1/llm/config                   return to the values in .env
GET  /v1/llm/models                     which models the runtime has
GET  /v1/dashboard                      FLEX experiments, model quality
POST /v1/predict                        burning rate
POST /v1/predict/batch                  many conditions, JSON or CSV
POST /v1/query                          answer from the reports
POST /v1/query/stream                   the same, as it is generated
GET  /v1/documents                      list of reports
POST /v1/documents                      add a PDF
GET  /v1/documents/{id}/pages/{n}       a page as PDF`,
    csv: `CSV columns: oxygen_level, n2, co2, he, pressure_mmhg, d_initial_mm, fuel_methanol, fuel_heptane.
Gases are fractions from 0 to 1. An empty cell means "not set", air is used.
The service does not work out nitrogen: set n2 explicitly, or the gases will not add up to one.
A bad row gets an error, the rest are calculated. The limit is 10,000 rows.`,
    access: `No key is needed from this machine. From another address: SFSS_API_KEY in .env,
sfss start --host 0.0.0.0 and the X-API-Key header.`,
    limits: `The model calculates the burning rate of fuel droplets from FLEX experiments. Materials are not in it.
Trained on 12-34 % oxygen: above that it plateaus, and warnings says so.
AI answers come from a small local model: check them against the page links.`,
  },
};

export const help = () => HELP_TEXT[getLang()];
export const helpIndex = () => HELP_INDEX[getLang()];
export const docs = () => DOCS_TEXT[getLang()];

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of line.matchAll(pattern)) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

function flags(tokens: string[], known: string[]): { values: Record<string, string>; rest: string[] } {
  const values: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) { rest.push(token); continue; }
    if (!known.includes(token)) throw new Error(tr("cmdUnknownFlag", { flag: token }));
    const value = tokens[i + 1];
    if (value === undefined) throw new Error(tr("cmdNeedValue", { flag: token }));
    values[token] = value;
    i += 1;
  }
  return { values, rest };
}

function number(values: Record<string, string>, flag: string): number | null {
  const raw = values[flag];
  if (raw === undefined) return null;
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) throw new Error(tr("cmdNeedNumber", { flag, raw }));
  return value;
}

export function parsePredict(tokens: string[]): Record<string, number> {
  const { values, rest } = flags(tokens, PREDICT_FLAGS);
  if (rest.length) throw new Error(tr("cmdExtra", { rest: rest.join(" ") }));
  if (values["--pressure"] !== undefined && values["--psi"] !== undefined) {
    throw new Error(tr("cmdTwoPressures"));
  }
  const fraction = (flag: string) => {
    const value = number(values, flag);
    if (value !== null && (value < 0 || value > 1)) {
      throw new Error(tr("cmdFraction", { flag, value }));
    }
    return value;
  };
  const o2 = fraction("--o2");
  const co2 = fraction("--co2");
  const he = fraction("--he");
  const n2 = fraction("--n2");

  const params: Record<string, number> = {};
  const pressure = number(values, "--pressure");
  const psi = number(values, "--psi");
  if (pressure !== null) params.pressure_mmhg = pressure;
  else if (psi !== null) params.pressure_mmhg = Number((psi * PSI_TO_MMHG).toFixed(1));
  if (o2 !== null) params.oxygen_level = o2;
  if (co2 !== null) params.co2 = co2;
  if (he !== null) params.he = he;
  if (n2 !== null) params.n2 = n2;
  else if (o2 !== null || co2 !== null || he !== null) {
    const rest = Number((1 - (o2 ?? 0.21) - (co2 ?? 0) - (he ?? 0)).toFixed(4));
    if (rest < 0) throw new Error(tr("cmdGasSum"));
    params.n2 = rest;
  }
  const droplet = number(values, "--droplet");
  if (droplet !== null) params.d_initial_mm = droplet;
  const fuel = values["--fuel"];
  if (fuel !== undefined) {
    if (fuel !== "methanol" && fuel !== "heptane") throw new Error(tr("cmdFuel"));
    params.fuel_methanol = fuel === "methanol" ? 1 : 0;
    params.fuel_heptane = fuel === "heptane" ? 1 : 0;
  }
  return params;
}

export function parseAsk(tokens: string[]): { question: string; lang: "ru" | "en" | null } {
  const { values, rest } = flags(tokens, ASK_FLAGS);
  const question = rest.join(" ").trim();
  if (!question) throw new Error(tr("cmdNeedQuestion"));
  const lang = values["--lang"] ?? null;
  if (lang !== null && lang !== "ru" && lang !== "en") throw new Error(tr("cmdLang"));
  return { question, lang };
}

export type ConfigRequest =
  | { action: "show" | "models" | "reset" }
  | { action: "patch"; patch: LlmPatch };

function wholeNumber(values: Record<string, string>, flag: string): number | undefined {
  const value = number(values, flag);
  if (value === null) return undefined;
  if (!Number.isInteger(value)) throw new Error(tr("cmdNeedNumber", { flag, raw: values[flag] }));
  return value;
}

export function parseConfig(tokens: string[]): ConfigRequest {
  const [action, ...rest] = tokens;
  if (action === undefined) return { action: "show" };
  if (action === "models" || action === "reset") {
    if (rest.length) throw new Error(tr("cmdExtra", { rest: rest.join(" ") }));
    return { action };
  }
  if (action === "runtime") {
    const { values, rest: free } = flags(rest, CONFIG_RUNTIME_FLAGS);
    if (free.length > 1) throw new Error(tr("cmdExtra", { rest: free.slice(1).join(" ") }));
    const kind = free[0];
    if (kind !== undefined && kind !== "lmstudio" && kind !== "ollama") throw new Error(tr("cmdConfigKind"));
    const port = wholeNumber(values, "--port");
    const host = values["--host"];
    if (kind === undefined && host === undefined && port === undefined) throw new Error(tr("cmdConfigRuntime"));
    return { action: "patch", patch: { runtime: { kind, host, port } } };
  }
  if (action === "model") {
    const { values, rest: free } = flags(rest, CONFIG_MODEL_FLAGS);
    if (free.length > 1) throw new Error(tr("cmdExtra", { rest: free.slice(1).join(" ") }));
    const name = free[0];
    const contextLength = wholeNumber(values, "--context");
    const maxTokens = wholeNumber(values, "--max-tokens");
    if (name === undefined && contextLength === undefined && maxTokens === undefined) throw new Error(tr("cmdConfigModel"));
    return { action: "patch", patch: { model: { name, context_length: contextLength, max_tokens: maxTokens } } };
  }
  throw new Error(tr("cmdConfig"));
}

export function configLines(config: LlmConfig): string[] {
  const { runtime, model } = config;
  return [
    tr("termConfigRuntime", {
      name: runtime.name,
      address: `${runtime.host}:${runtime.port}`,
      state: tr(runtime.reachable ? "termConfigUp" : "termConfigDown"),
    }),
    tr(model.available === false ? "termConfigMissing" : "termConfigModel", { name: model.name }),
    runtime.controls_context
      ? tr("termConfigContext", { value: model.context_length })
      : tr("termConfigContextOwn", { name: runtime.name }),
    tr("termConfigTokens", { value: model.max_tokens }),
    tr("termConfigEmbedding", { name: config.embedding_model }),
  ];
}

function configOptions(parts: string[]): readonly string[] {
  if (parts.length === 2) return CONFIG_ACTIONS;
  if (parts[1] === "runtime") return [...(parts.length === 3 ? RUNTIMES : []), ...CONFIG_RUNTIME_FLAGS];
  return parts[1] === "model" ? CONFIG_MODEL_FLAGS : [];
}

export function complete(line: string): string {
  const parts = line.split(/\s+/);
  const word = parts[parts.length - 1];
  const options =
    parts.length === 1
      ? COMMANDS
      : parts[0] === "predict"
        ? PREDICT_FLAGS
        : parts[0] === "ask"
          ? ASK_FLAGS
          : parts[0] === "config"
            ? configOptions(parts)
            : parts[0] === "help"
              ? COMMANDS
              : parts[0] === "docs"
                ? Object.keys(docs()).filter((topic) => topic !== "index")
                : [];
  const matches = options.filter((option) => option.startsWith(word));
  if (matches.length !== 1 || !word) return line;
  parts[parts.length - 1] = matches[0];
  return parts.join(" ") + " ";
}

const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

export function toCurl(record: RequestRecord, hasKey: boolean): string {
  const parts = ["curl"];
  if (record.path.endsWith("/stream")) parts.push("-N");
  if (record.method !== "GET") parts.push("-X", record.method);
  parts.push(shellQuote(record.url));
  if (hasKey) parts.push("-H", `"X-API-Key: $SFSS_API_KEY"`);
  if (record.contentType === "text/csv") {
    parts.push("-H", shellQuote("Content-Type: text/csv"), "--data-binary", "@runs.csv");
  } else if (record.path.endsWith("/documents") && record.method === "POST") {
    parts.push("-F", "file=@report.pdf");
  } else if (record.body !== undefined) {
    parts.push("-H", shellQuote(`Content-Type: ${record.contentType ?? "application/json"}`));
    parts.push("-d", shellQuote(record.body));
  }
  return parts.join(" ");
}
