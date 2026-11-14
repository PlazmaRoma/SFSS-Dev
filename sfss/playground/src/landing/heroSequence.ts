export const P = {
  flameHold: 0.18,
  toStars: 0.46,
  disperse: 0.92,
  content: 0.66,
} as const;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const seg = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
