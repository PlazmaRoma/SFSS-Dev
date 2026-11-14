import { useEffect, useRef } from "react";

const N = 460;
const SPRITE = 64;

interface P {
  seed: number; speed: number; size: number; band: number;
  ang: number; shell: number;
  sx: number; sy: number; sz: number;
}

function sprite(rgb: string) {
  const c = document.createElement("canvas");
  c.width = c.height = SPRITE;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
  grad.addColorStop(0, `rgba(${rgb},0.95)`);
  grad.addColorStop(0.25, `rgba(${rgb},0.4)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE, SPRITE);
  return c;
}

export function FlameComparison() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const warm = ["150,190,255", "255,240,200", "255,198,92", "255,138,46", "206,66,24"].map(sprite);
    const cool = ["226,242,255", "150,205,255", "86,150,235"].map(sprite);

    let w = 0;
    let h = 0;

    const ps: P[] = Array.from({ length: N }, () => ({
      seed: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.9,
      size: 0.4 + Math.random() * Math.random() * 1.7,
      band: Math.random(),
      ang: Math.random() * Math.PI * 2,
      shell: 0.86 + Math.random() * 0.16,
      ...(() => {
        const phi = Math.acos(2 * Math.random() - 1);
        const th = Math.random() * Math.PI * 2;
        return {
          sx: Math.sin(phi) * Math.cos(th),
          sy: Math.cos(phi),
          sz: Math.sin(phi) * Math.sin(th),
        };
      })(),
    }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(2, Math.round(rect.width));
      h = Math.max(2, Math.round(rect.height));
      canvas.width = w;
      canvas.height = h;
    };

    let raf = 0;

    const draw = (now: number) => {
      const t = still ? 0 : now * 0.001;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      const scale = Math.min(h * 0.46, w * 0.2);
      const ex = w * 0.27;
      const ey = h * 0.8;
      const mx = w * 0.66;
      const my = h * 0.5;

      const jit = still ? 0 : Math.sin(t * 3.1) * 0.5 + Math.sin(t * 5.3 + 1.1) * 0.28;

      for (const p of ps) {
        const rise = still ? p.band : (p.band + t * 0.22 * p.speed) % 1;
        const width = Math.sin(Math.pow(rise, 0.75) * Math.PI * 0.92) * scale * 0.34 + scale * 0.03;
        const sway = Math.sin(rise * 5 + p.seed + t * 2) * width * 0.5 + jit * scale * 0.05 * rise;
        const exx = ex + sway;
        const eyy = ey - rise * scale * 1.25;
        const heat = 1 - rise;
        const wi =
          rise < 0.08
            ? 0
            : Math.max(1, Math.min(warm.length - 1, Math.floor(1 + (1 - heat) * (warm.length - 1))));
        const es = p.size * (2.4 + heat * 2.6);
        ctx.globalAlpha = 0.3 * (1 - rise * 0.7);
        ctx.drawImage(warm[wi], exx - es * 3.5, eyy - es * 3.5, es * 7, es * 7);

        const r = scale * 0.5 * p.shell;
        const a = still ? 0 : t * 0.08;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const rx = p.sx * ca - p.sz * sa;
        const rz = p.sx * sa + p.sz * ca;
        const mxx = mx + rx * r;
        const myy = my + p.sy * r;
        const depth = (rz + 1) / 2;
        const ci = Math.min(cool.length - 1, Math.floor(p.band * cool.length));
        const ms = p.size * (1.7 + depth * 1.5);
        ctx.globalAlpha = 0.1 + depth * 0.26;
        ctx.drawImage(cool[ci], mxx - ms * 3.5, myy - ms * 3.5, ms * 7, ms * 7);
      }

      const ball = scale * 1.1;
      ctx.globalAlpha = 0.18;
      ctx.drawImage(cool[2], mx - ball / 2, my - ball / 2, ball, ball);

      ctx.globalAlpha = 0.75;
      ctx.drawImage(cool[0], mx - scale * 0.09, my - scale * 0.09, scale * 0.18, scale * 0.18);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (!still) raf = requestAnimationFrame(draw);
    };

    resize();
    const onResize = () => {
      resize();
      if (still) draw(performance.now());
    };
    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} className="flames" aria-hidden="true" />;
}
