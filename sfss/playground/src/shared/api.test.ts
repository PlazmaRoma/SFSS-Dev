import { afterEach, describe, expect, it, vi } from "vitest";
import { askStream, predictOffline, readEvents, toParams, type StreamEvent } from "./api";
import { BASELINE, HABITAT } from "./data/habitat";
import { PSI_TO_MMHG } from "./lib/risk";
import cubeFixture from "./fixtures/predict_cube.json";

/** Оффлайн-режим — не запасной: скачанная программа живёт только на нём.
 *  Если интерполяция поедет, цифры на экране разойдутся с моделью, и
 *  заметить это без бэкенда будет нечем. */

const cube = cubeFixture as unknown as {
  oxygen_level: number[];
  pressure_psi: number[];
  droplet_mm: number[];
  values: number[][][];
};

const at = (i: number, j: number, k: number) => ({
  oxygen_level: cube.oxygen_level[i],
  pressure_psi: cube.pressure_psi[j],
  droplet_mm: cube.droplet_mm[k],
});

describe("predictOffline", () => {
  it("в узлах сетки отдаёт снятое значение", () => {
    for (const [i, j, k] of [[0, 0, 0], [5, 11, 8], [24, 13, 16], [18, 4, 3]]) {
      expect(predictOffline(at(i, j, k)).predicted_value).toBeCloseTo(cube.values[i][j][k], 10);
    }
  });

  it("между двумя узлами по одной оси — ровно середина", () => {
    const [i, j, k] = [5, 11, 8];
    const a = at(i, j, k);
    const mid = { ...a, droplet_mm: (cube.droplet_mm[k] + cube.droplet_mm[k + 1]) / 2 };
    const expected = (cube.values[i][j][k] + cube.values[i][j][k + 1]) / 2;
    expect(predictOffline(mid).predicted_value).toBeCloseTo(expected, 10);
  });

  it("за краями сетки прижимается к крайнему узлу, а не экстраполирует", () => {
    const last = cube.oxygen_level.length - 1;
    const edge = predictOffline(at(last, 11, 8)).predicted_value;
    expect(predictOffline({ ...at(last, 11, 8), oxygen_level: 0.6 }).predicted_value).toBeCloseTo(edge, 10);
    const first = predictOffline(at(0, 11, 8)).predicted_value;
    expect(predictOffline({ ...at(0, 11, 8), oxygen_level: 0.05 }).predicted_value).toBeCloseTo(first, 10);
  });

  // Заголовочная цифра лендинга и вкладки Model: шлюз NASA горит в 1.40 раза
  // быстрее земного воздуха. Ради неё 8.2 и 14.7 psi сделаны узлами сетки.
  it("шлюз EVA даёт те же 1.40× к земному воздуху, что и живая модель", () => {
    const eva = HABITAT.find((m) => m.id === "eva")!;
    const ratio = predictOffline(eva.atmosphere).predicted_value / predictOffline(BASELINE).predicted_value;
    expect(ratio.toFixed(2)).toBe("1.40");
  });
});

describe("toParams", () => {
  it("переводит атмосферу в параметры /predict", () => {
    const p = toParams({ oxygen_level: 0.34, pressure_psi: 8.2, droplet_mm: 3 });
    expect(p.oxygen_level).toBe(0.34);
    // Остальное до единицы — азот: гелий и CO2 в модулях базы не используются
    expect(p.n2).toBe(0.66);
    expect(p.pressure_mmhg).toBeCloseTo(8.2 * PSI_TO_MMHG, 1);
    expect(p.d_initial_mm).toBe(3);
  });

  it("не тащит в запрос хвосты плавающей точки", () => {
    const p = toParams({ oxygen_level: 0.1 + 0.2, pressure_psi: 14.7, droplet_mm: 3 });
    expect(p.oxygen_level).toBe(0.3);
    expect(p.n2).toBe(0.7);
  });
});

/** Поток из готовых кусков байт — как его режет сеть, а не как удобно. */
function streamOf(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(ctl) {
      if (at >= bytes.length) return ctl.close();
      ctl.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

const NDJSON = [
  { type: "sources", sources: [{ doc_id: "NTRS-1", page: 5, excerpt: "x" }], search_query: "Why?" },
  { type: "stage", stage: "translating" },
  { type: "delta", text: "Гелий " },
  { type: "delta", text: "ускоряет горение." },
  { type: "done", answer: "Гелий ускоряет горение." },
].map((e) => JSON.stringify(e)).join("\n") + "\n";

describe("readEvents", () => {
  // Кириллица — два байта на букву: кусок в 3 байта рвёт букву пополам
  it("собирает события, как бы ни был порезан поток", async () => {
    for (const size of [1, 3, 7, 64, NDJSON.length * 2]) {
      const events: StreamEvent[] = [];
      await readEvents(streamOf(NDJSON, size), (e) => events.push(e));
      expect(events.map((e) => e.type)).toEqual(["sources", "stage", "delta", "delta", "done"]);
      expect(events[2]).toEqual({ type: "delta", text: "Гелий " });
    }
  });
});

describe("askStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("отдаёт текст по мере прихода и итоговый ответ", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(NDJSON, 5), { status: 200 })));
    const seen: string[] = [];
    const answer = await askStream("Почему?", "ru", (p) => seen.push(p.text));
    expect(answer.answer).toBe("Гелий ускоряет горение.");
    expect(answer.sources[0].doc_id).toBe("NTRS-1");
    expect(seen).toContain("Гелий ");
  });

  it("старый бэкенд без потока — обычный /query", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/query/stream")
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify({ answer: "ok", sources: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await askStream("Why?", "en", () => {})).answer).toBe("ok");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/\/query\/stream$/),
      expect.stringMatching(/\/query$/),
    ]);
  });

  it("ошибка посреди потока — это ошибка, а не обрезанный ответ", async () => {
    const broken = JSON.stringify({ type: "delta", text: "Начал" }) + "\n" + JSON.stringify({ type: "error", detail: "LM Studio down" }) + "\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(broken, 8), { status: 200 })));
    await expect(askStream("Why?", "en", () => {})).rejects.toThrow("LM Studio down");
  });
});
