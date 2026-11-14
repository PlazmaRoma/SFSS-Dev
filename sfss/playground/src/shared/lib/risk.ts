/** Цвет риска берём не из светофора, а из того, как выглядит само пламя:
 *  бессажевое синее горит медленно, сажистое жёлто-белое — быстро.
 *  Шкала непрерывная, пороги отдельно: видно и точное значение, и класс. */

export const SAFE_BELOW = 1.15;
export const HIGH_ABOVE = 1.4;
export const PSI_TO_MMHG = 51.715;

type Stop = { at: number; rgb: [number, number, number] };

const RAMP: Stop[] = [
  // Безопасное — тёмно-синий: цвет бессажевого пламени. Опасное уходит
  // в янтарь и оранжевый. Фон при этом чёрный, поэтому тёмная синева
  // читается спокойно и не спорит с предупреждающими тонами.
  //
  // Внутри безопасной полосы синий обязан заметно светлеть. Раньше он шёл
  // к серому (96,124,156), и на всём диапазоне 1.00…1.14 цвет менялся на
  // 57 единиц при пороге заметности около 25: шар выглядел застывшим,
  // хотя цифра росла на десять процентов. Вдобавок «опаснее» выходило
  // бледнее, то есть ровно наоборот.
  { at: 0.7, rgb: [18, 38, 74] },     // глубокий тёмно-синий, горит медленнее Земли
  { at: 1.0, rgb: [46, 96, 158] },    // тёмно-синий: земная норма
  { at: 1.15, rgb: [104, 178, 245] }, // яркий синий у самого порога
  { at: 1.22, rgb: [214, 170, 74] },  // янтарный: пошла сажа
  { at: 1.4, rgb: [240, 132, 62] },   // оранжевый
  { at: 1.6, rgb: [255, 231, 199] },  // добела
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function flameColor(ratio: number): string {
  const lo0 = RAMP[0].at;
  const hi0 = RAMP[RAMP.length - 1].at;
  const r = Math.min(Math.max(ratio, lo0), hi0);
  for (let i = 0; i < RAMP.length - 1; i++) {
    const lo = RAMP[i];
    const hi = RAMP[i + 1];
    if (r <= hi.at) {
      const t = (r - lo.at) / (hi.at - lo.at);
      const c = lo.rgb.map((v, k) => Math.round(lerp(v, hi.rgb[k], t)));
      return `rgb(${c[0]} ${c[1]} ${c[2]})`;
    }
  }
  return `rgb(${RAMP[RAMP.length - 1].rgb.join(" ")})`;
}

export type Band = "safe" | "elevated" | "high";

export const band = (ratio: number): Band =>
  ratio < SAFE_BELOW ? "safe" : ratio < HIGH_ABOVE ? "elevated" : "high";
