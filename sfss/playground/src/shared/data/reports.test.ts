import { describe, expect, it } from "vitest";
import { ntrsId, reportTitle } from "./reports";
import queryCache from "../fixtures/query_cache.json";

describe("reportTitle", () => {
  it("узнаёт отчёт по номеру NTRS при любом хвосте имени файла", () => {
    const title = "Burning and Suppression of Solids II (BASS-II) Summary Report";
    expect(reportTitle("NTRS-20210011385-Burning-and-Suppression-of-Solids-II-BASS-II-")).toBe(title);
    expect(reportTitle("NTRS-20210011385-BASS-II-Summary-Report")).toBe(title);
    expect(reportTitle("NTRS-20150023456")).toMatch(/^Detailed Results From the Flame Extinguishment/);
  });

  it("для документа не из корпуса показывает имя файла без дефисов", () => {
    expect(reportTitle("NTRS-20140006750-Cool-flame-Extinction")).toBe("20140006750 Cool flame Extinction");
    expect(reportTitle("some-file")).toBe("some file");
  });

  it("ntrsId вытаскивает одиннадцать цифр", () => {
    expect(ntrsId("NTRS-19950017584-Microgravity")).toBe("19950017584");
    expect(ntrsId("no-number")).toBeNull();
  });

  it("у всех источников в готовых ответах есть настоящее название", () => {
    const cache = queryCache as unknown as Record<string, Record<string, { sources?: { doc_id: string }[] }>>;
    const ids = Object.values(cache).flatMap((entry) =>
      ["en", "ru"].flatMap((lang) => entry[lang]?.sources?.map((s) => s.doc_id) ?? []),
    );
    expect(ids.length).toBeGreaterThan(0);
    const unnamed = ids.filter((id) => reportTitle(id) === id.replace(/^NTRS-/, "").replace(/-/g, " "));
    expect(unnamed).toEqual([]);
  });
});
