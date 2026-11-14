import type { BassExperiment } from "../types";
import raw from "../fixtures/bass_experiments.json";

/** Запросы к опытам BASS-II. Здесь нет модели и нет предсказаний:
 *  только пересчёт того, что NASA уже измерила. */

const ALL = (raw as unknown as { experiments: BassExperiment[] }).experiments.filter(
  (e) => e.outcome !== "unknown" && e.oxygen_pct != null,
);

/** Кислород, при котором BASS-II вообще жгла твёрдые материалы. Выше этого
 *  исход материала неизвестен, и это наша же находка про пробел в данных. */
export const TESTED_RANGE: [number, number] = [
  Math.min(...ALL.map((e) => e.oxygen_pct as number)),
  Math.max(...ALL.map((e) => e.oxygen_pct as number)),
];

export type MaterialKey = "pmma" | "sibal" | "nomex";
export const MATERIALS: MaterialKey[] = ["pmma", "sibal", "nomex"];

/** Огонь удержался: либо горел устойчиво, либо его сорвало потоком.
 *  И то и другое означает, что материал загорелся и горел. */
const KEPT = new Set(["sustained_burn", "blowoff"]);

export interface Evidence {
  material: MaterialKey;
  /** Опыты в окне ±band процентов кислорода от заданного.
   *
   *  Ноль здесь означает ноль. Раньше при пустом окне сюда подставлялся
   *  весь диапазон материала, и в шлюзе на 34% кислорода интерфейс писал
   *  «84 опыта примерно при 34%», хотя те опыты шли при 13.6…22.2%. Это
   *  ещё и спорило с нашей же находкой о пробеле в данных выше 24%. */
  near: number;
  burned: number;
  /** Ширина окна: интерфейс о ней честно пишет */
  band: number;
  /** Весь диапазон, в котором материал вообще испытывали */
  range: [number, number] | null;
  total: number;
  /** Пример опыта, на который можно сослаться */
  sample: BassExperiment | null;
}

export function evidenceFor(material: MaterialKey, oxygenPct: number, band = 2.5): Evidence {
  const mine = ALL.filter((e) => e.material === material);
  const near = mine.filter((e) => Math.abs((e.oxygen_pct as number) - oxygenPct) <= band);
  const burned = near.filter((e) => KEPT.has(e.outcome)).length;
  const ox = mine.map((e) => e.oxygen_pct as number);
  return {
    material,
    near: near.length,
    burned,
    band,
    range: ox.length ? [Math.min(...ox), Math.max(...ox)] : null,
    total: mine.length,
    // Для ссылки берём опыт, где материал горел: он и есть предупреждение
    sample: near.find((e) => KEPT.has(e.outcome)) ?? near[0] ?? null,
  };
}

/** Есть ли материал, который в тех же условиях держался лучше.
 *  Возвращаем только при заметной разнице, иначе совет был бы шумом. */
export function saferThan(
  material: MaterialKey,
  oxygenPct: number,
): { key: MaterialKey; ev: Evidence } | null {
  const mine = evidenceFor(material, oxygenPct);
  if (!mine.near) return null;
  const mineRate = mine.burned / mine.near;

  let best: { key: MaterialKey; ev: Evidence; rate: number } | null = null;
  for (const k of MATERIALS) {
    if (k === material) continue;
    const ev = evidenceFor(k, oxygenPct);
    if (!ev.near) continue;
    const rate = ev.burned / ev.near;
    if (rate < mineRate - 0.15 && (!best || rate < best.rate)) best = { key: k, ev, rate };
  }
  return best ? { key: best.key, ev: best.ev } : null;
}
