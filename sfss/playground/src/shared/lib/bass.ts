import type { BassExperiment } from "../types";
import raw from "../fixtures/bass_experiments.json";

const ALL = (raw as unknown as { experiments: BassExperiment[] }).experiments.filter(
  (e) => e.outcome !== "unknown" && e.oxygen_pct != null,
);

export const TESTED_RANGE: [number, number] = [
  Math.min(...ALL.map((e) => e.oxygen_pct as number)),
  Math.max(...ALL.map((e) => e.oxygen_pct as number)),
];

export type MaterialKey = "pmma" | "sibal" | "nomex";
export const MATERIALS: MaterialKey[] = ["pmma", "sibal", "nomex"];

const KEPT = new Set(["sustained_burn", "blowoff"]);

export interface Evidence {
  material: MaterialKey;
  near: number;
  burned: number;
  band: number;
  range: [number, number] | null;
  total: number;
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
    sample: near.find((e) => KEPT.has(e.outcome)) ?? near[0] ?? null,
  };
}

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
