/** Раскадровка главного экрана в долях прокрутки, 0 → 1.
 *
 *  Сцена ведётся скроллом, а не таймером: вниз — огонь гаснет в звёзды
 *  и они разлетаются к краям, вверх — собираются обратно в пламя.
 */
export const P = {
  flameHold: 0.18,  // просто горит
  toStars: 0.46,    // угасает, угли становятся звёздами
  disperse: 0.92,   // звёзды расходятся влево и вправо
  content: 0.66,    // с этого момента проявляется центр
} as const;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Отрезок раскадровки → 0..1 */
export const seg = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
