import { PSI_TO_MMHG } from "@sfss/lib/risk";
import { tr } from "./lang";

/** Условия опыта, как их вводит человек: проценты и выбранная единица давления.
 *  Значения — строки: пока человек печатает «0,», это ещё не число. */
export interface Conditions {
  o2: string;
  n2: string;
  co2: string;
  he: string;
  pressure: string;
  unit: "mmHg" | "psi";
  droplet: string;
  fuel: "methanol" | "heptane";
}

export const AIR: Conditions = {
  o2: "21", n2: "", co2: "0", he: "0", pressure: "760", unit: "mmHg", droplet: "3", fuel: "methanol",
};

export type Field = "o2" | "n2" | "co2" | "he" | "pressure" | "droplet" | "mix";

export interface Parsed {
  params: Record<string, number> | null;
  nitrogenAuto: number | null;
  errors: Partial<Record<Field, string>>;
}

/** Десятичная запятая на русской раскладке — обычное дело, а не ошибка. */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export const fuelParams = (fuel: Conditions["fuel"]) => ({
  fuel_methanol: fuel === "methanol" ? 1 : 0,
  fuel_heptane: fuel === "heptane" ? 1 : 0,
});

/** Проценты → parameters для /v1/predict.
 *
 *  Азот без значения дополняет смесь до 100 %. Сервис подставил бы воздушные 79 %,
 *  и при 30 % кислорода считалась бы смесь на 109 %. */
export function toParameters(c: Conditions): Parsed {
  const errors: Parsed["errors"] = {};

  const percent = (field: "o2" | "co2" | "he" | "n2", required: boolean): number | null => {
    const raw = c[field];
    const value = parseNumber(raw);
    if (value === null) {
      if (raw.trim() || required) errors[field] = tr("needNumber");
      return null;
    }
    if (value < 0 || value > 100) errors[field] = tr("range0to100");
    return value;
  };

  const o2 = percent("o2", true);
  const co2 = percent("co2", true);
  const he = percent("he", true);
  const n2Typed = percent("n2", false);

  const pressure = parseNumber(c.pressure);
  if (pressure === null) errors.pressure = tr("needNumber");
  else if (pressure <= 0) errors.pressure = tr("aboveZero");

  const droplet = parseNumber(c.droplet);
  if (droplet === null) errors.droplet = tr("needNumber");
  else if (droplet <= 0) errors.droplet = tr("aboveZero");

  let nitrogenAuto: number | null = null;
  let n2 = n2Typed;
  if (o2 !== null && co2 !== null && he !== null && !c.n2.trim()) {
    nitrogenAuto = round(100 - o2 - co2 - he, 2);
    n2 = nitrogenAuto;
    if (nitrogenAuto < 0) errors.mix = tr("mixOver");
  }

  if (Object.keys(errors).length || o2 === null || co2 === null || he === null || n2 === null) {
    return { params: null, nitrogenAuto, errors };
  }
  const mmhg = c.unit === "psi" ? round(pressure! * PSI_TO_MMHG, 1) : pressure!;
  return {
    params: {
      oxygen_level: round(o2 / 100, 4),
      n2: round(n2 / 100, 4),
      co2: round(co2 / 100, 4),
      he: round(he / 100, 4),
      pressure_mmhg: mmhg,
      d_initial_mm: droplet!,
      ...fuelParams(c.fuel),
    },
    nitrogenAuto,
    errors,
  };
}

/** Давление при смене единицы пересчитывается, а не остаётся тем же числом. */
export function switchUnit(c: Conditions, unit: Conditions["unit"]): Conditions {
  if (unit === c.unit) return c;
  const value = parseNumber(c.pressure);
  if (value === null) return { ...c, unit };
  const converted = unit === "psi" ? value / PSI_TO_MMHG : value * PSI_TO_MMHG;
  return { ...c, unit, pressure: String(round(converted, unit === "psi" ? 2 : 0)) };
}

/** Обычный воздух при том же топливе и той же капле: сравнивать надо только атмосферу. */
export function airParameters(params: Record<string, number>): Record<string, number> {
  return {
    oxygen_level: 0.21, n2: 0.79, co2: 0, he: 0, pressure_mmhg: 760,
    d_initial_mm: params.d_initial_mm,
    fuel_methanol: params.fuel_methanol,
    fuel_heptane: params.fuel_heptane,
  };
}

export const COLUMNS = [
  "oxygen_level", "n2", "co2", "he", "pressure_mmhg", "d_initial_mm", "fuel_methanol", "fuel_heptane",
] as const;

const FEATURE_LABELS: Record<string, () => [string, number, string]> = {
  oxygen_level: () => ["O₂", 100, " %"],
  n2: () => ["N₂", 100, " %"],
  co2: () => ["CO₂", 100, " %"],
  he: () => ["He", 100, " %"],
  pressure_mmhg: () => [tr("pressure"), 1, ` ${tr("mmHg")}`],
  d_initial_mm: () => [tr("droplet"), 1, ` ${tr("mm")}`],
};

/** warnings приходят из API как данные, на ASCII. Человеку показываем на языке
 *  программы; незнакомый текст показываем как есть, чтобы предупреждение не потерялось. */
export function warningText(warning: string): string {
  const range = warning.match(/^(\w+)=(\S+) is outside the training range (\S+?)\.\.(\S+)$/);
  if (range && FEATURE_LABELS[range[1]]) {
    const [label, scale, unit] = FEATURE_LABELS[range[1]]();
    const show = (text: string) => String(Number((Number(text) * scale).toFixed(2)));
    const plateau = range[1] === "oxygen_level" ? tr("plateau") : "";
    const value = `${label} ${show(range[2])}${unit}`;
    return tr("outOfRange", { value, range: `${show(range[3])}–${show(range[4])}${unit}` }) + plateau;
  }
  const gases = warning.match(/^gas fractions sum to (\S+), not 1$/);
  if (gases) return tr("gasSum", { sum: (Number(gases[1]) * 100).toFixed(0) });
  return warning;
}
