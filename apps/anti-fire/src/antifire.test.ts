import { beforeEach, describe, expect, it } from "vitest";
import { detectLanguage, splitBold, splitCitations } from "./citations";
import { complete, configLines, docs, help, parseAsk, parseConfig, parsePredict, tokenize, toCurl } from "./commands";
import { getLang, serviceText, setLang, tr } from "./lang";
import { canControl, controlService, localPort } from "./service";
import { AIR, airParameters, parseNumber, switchUnit, toParameters, warningText } from "./conditions";
import { csvRecords, parseCsv, toCsv } from "./csv";

beforeEach(() => setLang("ru", false));

describe("config в терминале", () => {
  it("тот же синтаксис, что у sfss config", () => {
    expect(parseConfig([])).toEqual({ action: "show" });
    expect(parseConfig(["models"])).toEqual({ action: "models" });
    expect(parseConfig(["reset"])).toEqual({ action: "reset" });
    expect(parseConfig(["runtime", "ollama", "--port", "11500", "--host", "10.0.0.5"])).toEqual({
      action: "patch",
      patch: { runtime: { kind: "ollama", host: "10.0.0.5", port: 11500 } },
    });
    expect(parseConfig(["model", "google/gemma-3-1b", "--context", "4096", "--max-tokens", "256"])).toEqual({
      action: "patch",
      patch: { model: { name: "google/gemma-3-1b", context_length: 4096, max_tokens: 256 } },
    });
  });

  it("порт без рантайма меняет только порт", () => {
    const request = parseConfig(["runtime", "--port", "1235"]);
    expect(JSON.parse(JSON.stringify(request))).toEqual({ action: "patch", patch: { runtime: { port: 1235 } } });
  });

  it("объясняет, что не так", () => {
    expect(() => parseConfig(["runtime"])).toThrow("config runtime ollama");
    expect(() => parseConfig(["runtime", "vllm"])).toThrow("lmstudio или ollama");
    expect(() => parseConfig(["runtime", "--port", "abc"])).toThrow("нужно число");
    expect(() => parseConfig(["runtime", "--port", "1.5"])).toThrow("нужно число");
    expect(() => parseConfig(["model"])).toThrow("config models");
    expect(() => parseConfig(["model", "a", "b"])).toThrow("b");
    expect(() => parseConfig(["model", "--port", "1"])).toThrow("--port");
    expect(() => parseConfig(["models", "x"])).toThrow("x");
    expect(() => parseConfig(["what"])).toThrow("help config");
  });

  it("показывает настройки", () => {
    const config = {
      runtime: { kind: "lmstudio" as const, name: "LM Studio", host: "localhost", port: 1234, controls_context: true, reachable: true },
      model: { name: "m", context_length: 8192, max_tokens: 512, available: true },
      embedding_model: "minilm",
    };
    const lines = configLines(config).join("\n");
    expect(lines).toContain("LM Studio, localhost:1234, отвечает");
    expect(lines).toContain("Контекст   8192");
    const ollama = configLines({
      ...config,
      runtime: { ...config.runtime, kind: "ollama", name: "Ollama", port: 11434, controls_context: false, reachable: false },
      model: { ...config.model, available: false },
    }).join("\n");
    expect(ollama).toContain("Ollama, localhost:11434, не отвечает");
    expect(ollama).toContain("OLLAMA_CONTEXT_LENGTH");
    expect(ollama).toContain("нет у рантайма");
  });

  it("Tab дополняет", () => {
    expect(complete("conf")).toBe("config ");
    expect(complete("config mod")).toBe("config mod");
    expect(complete("config re")).toBe("config reset ");
    expect(complete("config runtime oll")).toBe("config runtime ollama ");
    expect(complete("config runtime ollama --p")).toBe("config runtime ollama --port ");
    expect(complete("config model m --max")).toBe("config model m --max-tokens ");
  });

  it("причины от сервиса переведены", () => {
    expect(serviceText("Ollama is not responding at localhost:11434")).toBe("Ollama не отвечает на localhost:11434");
    expect(serviceText("Model m is not in Ollama: ollama pull m")).toBe("Модели m нет в Ollama: ollama pull m");
    expect(serviceText("Model qwen3 is banned by the Space Apps rules")).toBe("Модель qwen3 запрещена правилами Space Apps");
    expect(serviceText("oxygen_level: not a number: '0.3x'")).toBe("oxygen_level: не число: '0.3x'");
  });
});

describe("язык программы", () => {
  it("тексты и ошибки следуют выбранному языку", () => {
    setLang("en", false);
    expect(getLang()).toBe("en");
    expect(tr("tabWork")).toBe("Work");
    expect(tr("modelNotLoaded", { model: "m" })).toBe("m is not in memory");
    expect(toParameters({ ...AIR, o2: "x" }).errors.o2).toBe("enter a number");
    expect(() => parseAsk([])).toThrow("question");
    expect(warningText("gas fractions sum to 1.09, not 1")).toBe("Gases add up to 109 %, not 100 %.");
    expect(help().load).toContain("Load the model");
    expect(docs().api).toContain("/v1/llm/load");
    expect(docs().api).toContain("/v1/llm/unload");
    expect(help().unload).toContain("Unload the model");
    expect(help().stop).toContain("stop SFSS");
  });

  it("в обоих языках одни и те же команды и разделы", () => {
    setLang("ru", false);
    const ruHelp = Object.keys(help()).sort();
    const ruDocs = Object.keys(docs()).sort();
    setLang("en", false);
    expect(Object.keys(help()).sort()).toEqual(ruHelp);
    expect(Object.keys(docs()).sort()).toEqual(ruDocs);
  });

  it("ошибка сервиса переводится, незнакомая остаётся как есть", () => {
    expect(serviceText("Not enough memory for the model: close heavy programs and retry")).toContain("памяти");
    expect(serviceText("LM Studio runs on 10.0.0.5: load the model there")).toBe("LM Studio работает на 10.0.0.5: загрузите модель там");
    expect(serviceText("Something new")).toBe("Something new");
    setLang("en", false);
    expect(serviceText("Not enough memory for the model: close heavy programs and retry")).toContain("memory");
  });
});

describe("управление сервисом", () => {
  it("порт берётся из адреса, только на этой машине", () => {
    expect(localPort("http://127.0.0.1:8000")).toBe(8000);
    expect(localPort("http://localhost:9000/")).toBe(9000);
    expect(localPort("http://[::1]:8010")).toBe(8010);
    expect(localPort("http://localhost")).toBe(80);
    expect(localPort("http://10.0.0.5:8000")).toBeNull();
    expect(localPort("http://station.example:8000")).toBeNull();
    expect(localPort("не адрес")).toBeNull();
  });

  it("без окна приложения управлять нечем", async () => {
    expect(canControl("http://127.0.0.1:8000")).toBe(false);
    await expect(controlService("start", "http://127.0.0.1:8000")).rejects.toThrow();
  });
});

describe("условия → параметры", () => {
  it("азот дополняет смесь до единицы", () => {
    const { params, nitrogenAuto } = toParameters({ ...AIR, o2: "30" });
    expect(params?.oxygen_level).toBe(0.3);
    expect(params?.n2).toBe(0.7);
    expect(nitrogenAuto).toBe(70);
  });

  it("введённый азот не трогается", () => {
    const { params, nitrogenAuto } = toParameters({ ...AIR, o2: "30", n2: "60" });
    expect(params?.n2).toBe(0.6);
    expect(nitrogenAuto).toBeNull();
  });

  it("запятая как десятичный знак", () => {
    expect(parseNumber("8,2")).toBe(8.2);
    expect(toParameters({ ...AIR, droplet: "2,5" }).params?.d_initial_mm).toBe(2.5);
  });

  it("psi переводится в мм рт. ст.", () => {
    expect(toParameters({ ...AIR, unit: "psi", pressure: "8.2" }).params?.pressure_mmhg).toBe(424.1);
  });

  it("смена единицы пересчитывает давление", () => {
    const psi = switchUnit(AIR, "psi");
    expect(psi.pressure).toBe("14.7");
    expect(switchUnit(psi, "mmHg").pressure).toBe("760");
  });

  it.each([
    ["o2", "abc"], ["o2", ""], ["o2", "120"], ["he", "-1"], ["pressure", "0"], ["droplet", "abc"],
  ] as const)("ошибка в поле %s при значении %s", (field, value) => {
    const { params, errors } = toParameters({ ...AIR, [field]: value });
    expect(params).toBeNull();
    expect(errors[field]).toBeTruthy();
  });

  it("сумма газов больше 100 %", () => {
    const { params, errors } = toParameters({ ...AIR, o2: "70", he: "50" });
    expect(params).toBeNull();
    expect(errors.mix).toBeTruthy();
  });

  it("воздух для сравнения берёт топливо и каплю из условий", () => {
    const { params } = toParameters({ ...AIR, o2: "30", droplet: "2", fuel: "heptane" });
    const air = airParameters(params!);
    expect(air.oxygen_level).toBe(0.21);
    expect(air.d_initial_mm).toBe(2);
    expect(air.fuel_heptane).toBe(1);
  });
});

describe("предупреждения для человека", () => {
  it("вне диапазона: проценты и плато", () => {
    expect(warningText("oxygen_level=0.4 is outside the training range 0.12..0.34")).toBe(
      "O₂ 40 % вне диапазона опытов: 12–34 %. Здесь модель выходит на плато.",
    );
    expect(warningText("d_initial_mm=9 is outside the training range 1.1..4.67")).toBe(
      "Капля 9 мм вне диапазона опытов: 1.1–4.67 мм.",
    );
  });

  it("сумма газов", () => {
    expect(warningText("gas fractions sum to 1.090, not 1")).toBe("Сумма газов 109 %, а не 100 %.");
  });

  it("незнакомое предупреждение не теряется", () => {
    expect(warningText("something new")).toBe("something new");
  });
});

describe("CSV", () => {
  it("кавычки, запятые и BOM", () => {
    expect(parseCsv('﻿a,b\n"1,5","x ""y"""\n')).toEqual([["a", "b"], ["1,5", 'x "y"']]);
  });

  it("запись и чтение сходятся", () => {
    const rows = [["warnings", "n"], ['gas fractions sum to 1.090, not "1"', "2"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("короткая строка получает пустые ячейки", () => {
    expect(csvRecords("oxygen_level,n2\n0.3\n")).toEqual([{ oxygen_level: "0.3", n2: "" }]);
  });

  it("пустые строки не считаются", () => {
    expect(csvRecords("a\n1\n\n")).toEqual([{ a: "1" }]);
  });
});

describe("ссылки в ответе", () => {
  it("английская и русская подпись страницы", () => {
    const parts = splitCitations("Горит [NTRS-20000030678, p. 97]. Гаснет [NTRS-1, стр. 5].");
    expect(parts.filter((p) => p.kind === "cite")).toMatchObject([
      { docId: "NTRS-20000030678", page: 97 },
      { docId: "NTRS-1", page: 5 },
    ]);
  });

  it("несколько ссылок в одних скобках", () => {
    const parts = splitCitations("[NTRS-1, p. 16; NTRS-2, p. 5]");
    expect(parts).toMatchObject([{ docId: "NTRS-1", page: 16 }, { docId: "NTRS-2", page: 5 }]);
  });

  it("номер кириллицей, круглые скобки и жирный шрифт не ломают ссылку", () => {
    const cites = (text: string) => splitCitations(text).filter((p) => p.kind === "cite");
    expect(cites("Горит [НТРС-123, с. 7].")).toMatchObject([{ docId: "NTRS-123", page: 7 }]);
    expect(cites("Горит (NTRS-123, с. 7).")).toMatchObject([{ docId: "NTRS-123", page: 7 }]);
    expect(splitCitations("**[NTRS-123, p. 7]**")).toMatchObject([{ kind: "cite", docId: "NTRS-123" }]);
  });

  it("жирный текст отделяется от обычного", () => {
    expect(splitBold("про **плотность газа** и **топливо**")).toEqual(["про ", "плотность газа", " и ", "топливо", ""]);
    expect(splitBold("про **плотн")).toEqual(["про **плотн"]);
  });

  it("ссылка из текста отчёта остаётся текстом", () => {
    expect(splitCitations("как в [Olson 1988].")).toEqual([{ kind: "text", text: "как в [Olson 1988]." }]);
  });

  it("текст собирается без потерь", () => {
    const answer = "A [NTRS-1, p. 2] B";
    const parts = splitCitations(answer);
    expect(parts.map((p) => (p.kind === "text" ? p.text : "[NTRS-1, p. 2]")).join("")).toBe(answer);
  });

  it("язык определяется по вопросу", () => {
    expect(detectLanguage("Why?")).toBe("en");
    expect(detectLanguage("Что такое BASS-II?")).toBe("ru");
  });
});

describe("команды терминала", () => {
  it("кавычки объединяют слова", () => {
    expect(tokenize(`ask "как горит" --lang ru`)).toEqual(["ask", "как горит", "--lang", "ru"]);
  });

  it("predict разбирается как у sfss", () => {
    expect(parsePredict(tokenize("--o2 0.30 --psi 8.2"))).toEqual({
      oxygen_level: 0.3, n2: 0.7, pressure_mmhg: 424.1,
    });
    expect(parsePredict([])).toEqual({});
  });

  it.each([
    ["--o2 30", "0.30"],
    ["--o2", "значение"],
    ["--oxygen 0.3", "Нет такого параметра"],
    ["--o2 abc", "число"],
    ["--pressure 760 --psi 14", "либо"],
    ["--fuel kerosene", "methanol"],
    ["--o2 0.7 --he 0.5", "больше единицы"],
    ["0.3", "Лишнее"],
  ])("ошибка для %s", (line, message) => {
    expect(() => parsePredict(tokenize(line))).toThrow(message);
  });

  it("ask требует вопрос", () => {
    expect(() => parseAsk([])).toThrow("вопрос");
    expect(parseAsk(tokenize(`"как горит?" --lang en`))).toEqual({ question: "как горит?", lang: "en" });
    expect(() => parseAsk(tokenize("q --lang de"))).toThrow("ru или en");
  });

  it("Tab дополняет единственный вариант", () => {
    expect(complete("pre")).toBe("predict ");
    expect(complete("predict --ps")).toBe("predict --psi ");
    expect(complete("help as")).toBe("help ask ");
    expect(complete("docs ac")).toBe("docs access ");
    expect(complete("predict --")).toBe("predict --");
    expect(complete("xyz")).toBe("xyz");
  });

  it("curl: JSON, CSV, поток и ключ без значения", () => {
    const record = {
      method: "POST", path: "/v1/predict", url: "http://x/v1/predict", status: 200, ms: 1,
      body: `{"a":"it's"}`, contentType: "application/json",
    };
    expect(toCurl(record, false)).toBe(
      `curl -X POST 'http://x/v1/predict' -H 'Content-Type: application/json' -d '{"a":"it'\\''s"}'`,
    );
    expect(toCurl(record, true)).toContain(`"X-API-Key: $SFSS_API_KEY"`);
    expect(toCurl({ ...record, contentType: "text/csv", body: "a" }, false)).toContain("--data-binary @runs.csv");
    expect(toCurl({ ...record, path: "/v1/query/stream" }, false)).toContain("-N");
    expect(toCurl({ ...record, method: "GET", body: undefined, contentType: undefined }, false)).toBe(
      "curl 'http://x/v1/predict'",
    );
  });
});
