import { useEffect, useRef } from "react";
import { P, easeInOut, easeOut, seg } from "./heroSequence";

const COUNT = 1750;
const HALF = 0.42;
const SPRITE = 96;

interface Dot {
  bx: number; by: number; bz: number;
  rad: number;
  sx: number; sy: number;
  churn: number; speed: number;
  size: number;
  delay: number;
  twinkle: number;
  starR: number;
  starA: number;
  starC: string;
  kind: 0 | 1 | 2;
  swirl: number;
}

function makeSprites(): HTMLCanvasElement[] {
  const ramp = [
    "255,247,230",
    "255,224,160",
    "255,186,92",
    "255,140,52",
    "226,88,30",
    "150,52,26",
    "96,150,235",
  ];
  return ramp.map((rgb) => {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    grad.addColorStop(0, `rgba(${rgb},0.95)`);
    grad.addColorStop(0.18, `rgba(${rgb},0.55)`);
    grad.addColorStop(0.45, `rgba(${rgb},0.18)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE, SPRITE);
    return c;
  });
}

export function HeroCanvas({
  progress,
  stageBottom,
}: {
  progress: { current: number };
  stageBottom: { current: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sprites = makeSprites();
    const trail = document.createElement("canvas");
    const tctx = trail.getContext("2d")!;
    let w = 0;
    let h = 0;

    const dots: Dot[] = Array.from({ length: COUNT }, () => {
      const rad = Math.cbrt(Math.random());
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const side = Math.random() < 0.5 ? -1 : 1;
      const roll = Math.random();
      const kind: 0 | 1 | 2 = roll < 0.09 ? 0 : roll < 0.44 ? 1 : 2;
      return {
        kind,
        swirl: (1.25 - rad) * (0.5 + Math.random() * 0.8),
        bx: rad * Math.sin(phi) * Math.cos(theta),
        by: rad * Math.cos(phi),
        bz: rad * Math.sin(phi) * Math.sin(theta),
        rad,
        sx: side * (0.07 + Math.pow(Math.random(), 0.62) * 0.92),
        sy: (Math.random() - 0.5) * 1.9,
        churn: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 0.8,
        size: 0.5 + Math.random() * Math.random() * 1.8,
        delay: Math.random() * 0.1,
        twinkle: Math.random() * Math.PI * 2,
        starR: 0.42 + Math.pow(Math.random(), 2.6) * 1.55,
        starA: 0.1 + Math.pow(Math.random(), 2.2) * 0.72,
        starC: (() => {
          const v = Math.random();
          if (v < 0.44) return "175,205,255";
          if (v < 0.86) return "228,236,248";
          return "236,178,126";
        })(),
      };
    });

    const resize = () => {
      const dpr = 1;
      const rect = canvas.getBoundingClientRect();
      const cw = Math.round(rect.width);
      const ch = Math.round(rect.height);

      if (cw < 2 || ch < 2) return;
      if (canvas.width === cw * dpr && canvas.height === ch * dpr) return;

      w = cw;
      h = ch;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      plateGrad = null;
      trail.width = Math.max(2, Math.round(w * HALF));
      trail.height = Math.max(2, Math.round(h * HALF));
    };

    const makeBlob = (size: number, stops: [number, string][]) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const [at, col] of stops) grad.addColorStop(at, col);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return c;
    };

    const glowBlob = makeBlob(256, [
      [0, "rgba(255, 220, 170, 1)"],
      [0.4, "rgba(226, 104, 44, 0.45)"],
      [1, "rgba(180, 70, 30, 0)"],
    ]);
    const heartBlob = makeBlob(192, [
      [0, "rgba(255, 250, 235, 1)"],
      [0.5, "rgba(255, 196, 96, 0.47)"],
      [1, "rgba(255, 150, 60, 0)"],
    ]);
    const nebulaBlob = makeBlob(256, [
      [0, "rgba(18, 26, 38, 1)"],
      [1, "rgba(18, 26, 38, 0)"],
    ]);

    let plateGrad: CanvasGradient | null = null;
    let raf = 0;

    let budget = 1;
    let prev = 0;
    let slow = 0;
    let fast = 0;

    const draw = (now: number) => {
      const frame = prev ? now - prev : 16;
      prev = now;
      if (frame > 24) {
        slow++;
        fast = 0;
        if (slow > 8) { budget = Math.max(0.3, budget - 0.12); slow = 0; }
      } else if (frame < 18) {
        fast++;
        slow = 0;
        if (fast > 90) { budget = Math.min(1, budget + 0.08); fast = 0; }
      }

      const t = still ? 1 : progress.current;
      const cx = w / 2;
      const cy = h / 2;
      const portrait = h > w;
      const R = Math.min(w, h) * (portrait ? 0.23 : 0.2);

      const fire = 1 - easeInOut(seg(t, P.flameHold, P.toStars));
      const away = easeInOut(seg(t, P.toStars, P.disperse));

      const space = 1 - fire;
      ctx.fillStyle = `rgb(${Math.round(7 * space)}, ${Math.round(11 * space)}, ${Math.round(16 * space)})`;
      ctx.fillRect(0, 0, w, h);
      if (space > 0.01) {
        const nb = Math.max(w, h) * 1.7;
        ctx.globalAlpha = 0.5 * space;
        ctx.drawImage(nebulaBlob, w * 0.72 - nb / 2, h * 0.22 - nb / 2, nb, nb);
        ctx.globalAlpha = 1;
      }

      const burning = fire > 0.02;

      if (burning) {
        tctx.globalCompositeOperation = "copy";
        tctx.globalAlpha = 0.8;
        tctx.drawImage(trail, -trail.width * 0.005, -trail.height * 0.005, trail.width * 1.01, trail.height * 1.01);
        tctx.globalAlpha = 1;
        tctx.globalCompositeOperation = "lighter";
      } else {
        tctx.clearRect(0, 0, w, h);
      }

      ctx.globalCompositeOperation = "lighter";

      if (fire > 0.01) {
        const gb = R * 6.8;
        ctx.globalAlpha = 0.2 * fire;
        ctx.drawImage(glowBlob, cx - gb / 2, cy - gb / 2, gb, gb);

        const hb = R * 1.24;
        ctx.globalAlpha = 0.34 * fire;
        ctx.drawImage(heartBlob, cx - hb / 2, cy - hb / 2, hb, hb);
        ctx.globalAlpha = 1;
      }

      const churn = now * 0.00055;
      const breathe = 1 + Math.sin(now * 0.0011) * 0.035 * fire;

      const active = burning ? Math.round(dots.length * budget) : dots.length;
      for (let di = 0; di < active; di++) {
        const d = dots[di];
        const wob = fire * 0.17;
        const slow = fire * 0.13;
        const a = churn * d.swirl * 1.6 * fire;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const rx = d.bx * ca - d.bz * sa;
        const rz = d.bx * sa + d.bz * ca;
        const bx =
          rx +
          Math.sin(churn * d.speed + d.churn) * wob +
          Math.sin(churn * 0.31 + d.churn * 0.5) * slow;
        const by =
          d.by +
          Math.sin(churn * d.speed * 1.41 + d.churn * 2.3) * wob +
          Math.cos(churn * 0.27 + d.churn * 0.7) * slow;
        const bz =
          rz +
          Math.cos(churn * d.speed * 0.87 + d.churn) * wob +
          Math.sin(churn * 0.23 + d.churn) * slow;

        const ballX = cx + bx * R * breathe;
        const ballY = cy + by * R * breathe;
        const restX = cx + d.sx * w * 0.5;
        const past = Math.max(0, window.scrollY - stageBottom.current);
        const drift = past * (0.05 + (1 - d.rad) * 0.1);
        const span = h * 2;
        let restY = cy + d.sy * h * 0.5 - drift;
        if (past > 0) restY = cy - h * 0.5 + (((restY - cy + h * 0.5) % span) + span) % span;

        const go = easeOut(seg(t - d.delay, P.toStars, P.disperse));
        const x = ballX + (restX - ballX) * go;
        const y = ballY + (restY - ballY) * go;

        const depth = (bz + 1) / 2;

        const hot =
          d.kind === 0
            ? 4
            : d.kind === 1
              ? 2 + Math.min(2, Math.floor(d.rad * 2.6))
              : Math.min(sprites.length - 2, Math.floor(d.rad * 5.4));
        const idx = fire > 0.02 ? hot : sprites.length - 1;

        const size = d.size * (fire * (d.kind === 0 ? 10 : d.kind === 1 ? 3.7 : 1.9) + 0.92) * (0.55 + depth * 0.8);
        const twinkle = fire > 0.02 ? 1 : 0.55 + 0.45 * Math.sin(now * 0.0016 + d.twinkle);
        const alpha =
          (0.30 + depth * 0.42) *
          (fire * (d.kind === 0 ? 0.022 : d.kind === 1 ? 0.075 : 1.25) + (1 - fire) * (1.05 + away * 0.35)) *
          twinkle;

        if (burning) {
          tctx.globalAlpha = Math.max(alpha, 0);
          const sp = size * 7 * HALF;
          tctx.drawImage(sprites[idx], x * HALF - sp / 2, y * HALF - sp / 2, sp, sp);
        } else {
          ctx.globalAlpha = Math.max(d.starA * twinkle, 0);
          ctx.fillStyle = `rgb(${d.starC})`;
          ctx.beginPath();
          ctx.arc(x, y, d.starR, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (burning) {
        tctx.globalAlpha = 1;
        ctx.globalAlpha = Math.min(1, fire * 1.25);
        ctx.drawImage(trail, 0, 0, w, h);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      if (fire > 0.01) {
        ctx.textBaseline = "middle";
        ctx.fillStyle = `rgba(255, 255, 255, ${fire})`;
        const stacked = w < 900;

        if (stacked) {
          let fs = R * 0.44;
          ctx.font = `500 ${fs}px Archivo, system-ui, sans-serif`;
          const room = w * 0.88;
          const widest = ctx.measureText("Security Software").width;
          if (widest > room) fs *= room / widest;

          ctx.textAlign = "center";
          ctx.font = `500 ${fs * 1.45}px Archivo, system-ui, sans-serif`;
          ctx.fillText("Space", cx, cy - R * 1.9);
          ctx.font = `500 ${fs}px Archivo, system-ui, sans-serif`;
          ctx.fillText("Security Software", cx, cy + R * 1.95);
        } else {
          const gap = R * 1.78;
          const room = Math.max(40, cx - gap - w * 0.03);
          let fs = R * 0.5;
          ctx.font = `500 ${fs}px Archivo, system-ui, sans-serif`;
          const widest = Math.max(ctx.measureText("Security").width, ctx.measureText("Software").width);
          if (widest > room) fs *= room / widest;

          ctx.font = `500 ${fs}px Archivo, system-ui, sans-serif`;
          const lw = ctx.measureText("Space").width;
          const rw = Math.max(ctx.measureText("Security").width, ctx.measureText("Software").width);
          const shift = (rw - lw) / 2;

          ctx.textAlign = "right";
          ctx.fillText("Space", cx - gap - shift, cy);

          const rightEdge = cx + gap - shift + rw;
          const lead = fs * 0.94;
          ctx.fillText("Security", rightEdge, cy - lead / 2);
          ctx.fillText("Software", rightEdge, cy + lead / 2);
        }
      }

      if (space > 0.01) {
        if (!plateGrad) {
          plateGrad = ctx.createLinearGradient(0, 0, w, 0);
          plateGrad.addColorStop(0, "rgba(0,0,0,0)");
          plateGrad.addColorStop(0.16, "rgba(0,0,0,0)");
          plateGrad.addColorStop(0.36, "rgba(0,0,0,1)");
          plateGrad.addColorStop(0.64, "rgba(0,0,0,1)");
          plateGrad.addColorStop(0.84, "rgba(0,0,0,0)");
          plateGrad.addColorStop(1, "rgba(0,0,0,0)");
        }
        ctx.globalAlpha = 0.62 * space;
        ctx.fillStyle = plateGrad;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }

      if (!still) raf = requestAnimationFrame(draw);
    };

    resize();
    const onResize = () => {
      resize();
      if (still) draw(performance.now());
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);
    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [progress, stageBottom]);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}
