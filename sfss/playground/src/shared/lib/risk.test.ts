import { describe, expect, it } from "vitest";
import { HIGH_ABOVE, SAFE_BELOW, band, flameColor } from "./risk";

const rgb = (css: string) => css.match(/\d+/g)!.map(Number);
const lightness = (css: string) => rgb(css).reduce((a, b) => a + b, 0);

describe("band", () => {
  it("пороги включаются ровно на своих значениях", () => {
    expect(band(SAFE_BELOW - 0.001)).toBe("safe");
    expect(band(SAFE_BELOW)).toBe("elevated");
    expect(band(HIGH_ABOVE - 0.001)).toBe("elevated");
    expect(band(HIGH_ABOVE)).toBe("high");
  });

  it("шлюз EVA (1.40×) уже в высоком риске", () => {
    expect(band(1.4)).toBe("high");
  });
});

describe("flameColor", () => {
  it("отдаёт валидный CSS rgb", () => {
    expect(flameColor(1)).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
  });

  it("за краями шкалы прижимается к крайнему цвету", () => {
    expect(flameColor(0.1)).toBe(flameColor(0.7));
    expect(flameColor(5)).toBe(flameColor(1.6));
  });

  // Внутри безопасной полосы синий обязан светлеть с ростом риска: однажды
  // шкала шла к серому, и «опаснее» выглядело бледнее, то есть наоборот.
  it("в безопасной полосе цвет светлеет вместе с риском", () => {
    let prev = lightness(flameColor(0.7));
    for (let r = 0.75; r < SAFE_BELOW; r += 0.05) {
      const cur = lightness(flameColor(r));
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it("на пороге безопасной полосы синий уступает тёплому тону", () => {
    const [r, , b] = rgb(flameColor(HIGH_ABOVE));
    expect(r).toBeGreaterThan(b);
    const [r0, , b0] = rgb(flameColor(1));
    expect(b0).toBeGreaterThan(r0);
  });
});
