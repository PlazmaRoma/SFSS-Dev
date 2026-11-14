import { useEffect, useRef } from "react";
import { P, easeInOut, easeOut, seg } from "./heroSequence";

/** Пламя капли в невесомости, которое гаснет в звёзды и разлетается к краям.
 *
 *  Одна система частиц. Пока горит, каждая частица — мягкое пятно света со
 *  сложением яркости: перекрываясь, они дают объём, а не кашу. Цвет берётся
 *  от расстояния до центра, как в настоящем пламени — белое ядро, золото,
 *  оранжевый край и синева по кромке, где горение беднее всего.
 *
 *  Потом пятна сжимаются в резкие холодные точки и расходятся двумя
 *  россыпями влево и вправо, оставляя проём под текст.
 *
 *  Положение на раскадровке даёт прокрутка. По времени живёт только
 *  кипение — иначе на остановке пламя замирало бы куском льда.
 *
 *  Холст один на всю страницу и прибит к окну. Разлетевшиеся частицы не
 *  исчезают вместе с главным экраном: они едут дальше с параллаксом и
 *  служат фоном до самого подвала. Вторая система звёзд здесь была бы
 *  видна стыком — на границе плотность не совпадает.
 */

const COUNT = 1750;
/** Во сколько раз буфер следа мельче экрана. */
const HALF = 0.42;
const SPRITE = 96;

interface Dot {
  bx: number; by: number; bz: number;   // внутри шара
  rad: number;                          // как далеко от центра: задаёт цвет
  sx: number; sy: number;               // куда разлетается, в долях экрана
  churn: number; speed: number;
  size: number;
  delay: number;
  twinkle: number;
  // Звёздные свойства замерены по эталону: медианный диаметр 2 px,
  // медианная яркость пика 55/255, цвета 44% холодных / 42% белых / 12% тёплых.
  starR: number;
  starA: number;
  starC: string;
  /** Три сорта частиц. Дымка — огромная и почти прозрачная, от неё мягкий
   *  край вместо обрубленного. Тело — средние пятна, из них складывается
   *  светящаяся масса. Искры — мелкие и яркие, деталь поверх.
   *  На одних искрах пламя выглядит крупой, на одном теле — ватой. */
  kind: 0 | 1 | 2;
  swirl: number;
}

/** Мягкие спрайты вместо градиента на каждый кадр: 1700 радиальных
 *  градиентов в кадре кладут даже быструю машину. */
function makeSprites(): HTMLCanvasElement[] {
  const ramp = [
    "255,247,230",  // ядро
    "255,224,160",
    "255,186,92",
    "255,140,52",
    "226,88,30",
    "150,52,26",    // тёмная кромка
    "96,150,235",   // синева у основания
  ];
  return ramp.map((rgb) => {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    // Длинный мягкий хвост — от него зависит, читается пламя как свет или как крупа.
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
    // Накопительный буфер: прошлый кадр не стирается, а гасится и чуть
    // раздувается. Частицы оставляют след, и масса читается как текущее
    // пламя, а не как россыпь точек.
    //
    // Держим его в половинном разрешении: содержимое всё равно размытое,
    // а заливка пикселей — самое дорогое здесь. В полном размере кадр
    // проседал до 20 в секунду.
    const trail = document.createElement("canvas");
    const tctx = trail.getContext("2d")!;
    let w = 0;
    let h = 0;

    const dots: Dot[] = Array.from({ length: COUNT }, () => {
      // Кубический корень — равномерно по объёму, иначе всё слипнется в центр.
      const rad = Math.cbrt(Math.random());
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const side = Math.random() < 0.5 ? -1 : 1;
      const roll = Math.random();
      const kind: 0 | 1 | 2 = roll < 0.09 ? 0 : roll < 0.44 ? 1 : 2;
      return {
        kind,
        // Внутренние слои закручиваются быстрее внешних — масса течёт,
        // а не дрожит на месте. Это и отличает огонь от россыпи искр.
        swirl: (1.25 - rad) * (0.5 + Math.random() * 0.8),
        bx: rad * Math.sin(phi) * Math.cos(theta),
        by: rad * Math.cos(phi),
        bz: rad * Math.sin(phi) * Math.sin(theta),
        rad,
        // Россыпь, а не кольцо: случайная точка в боковой полосе, центр свободен.
        sx: side * (0.07 + Math.pow(Math.random(), 0.62) * 0.92),
        sy: (Math.random() - 0.5) * 1.9,
        churn: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 0.8,
        size: 0.5 + Math.random() * Math.random() * 1.8,
        delay: Math.random() * 0.1,
        twinkle: Math.random() * Math.PI * 2,
        // Степень 2.6 даёт много мелких и редкие крупные — как в замере
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
      // Плотность держим на единице: содержимое размытое, retina не видна,
      // а заливка пикселей растёт вчетверо. Это была главная причина тормозов.
      const dpr = 1;
      const rect = canvas.getBoundingClientRect();
      const cw = Math.round(rect.width);
      const ch = Math.round(rect.height);

      // Нулевой замер не годится: в буфер нечего рисовать, а дальше кадр
      // растянется на весь экран. Ждём следующего вызова наблюдателя.
      if (cw < 2 || ch < 2) return;
      // Размер не изменился — не трогаем буферы: иначе каждый лишний вызов
      // наблюдателя стирает холст и сбрасывает шлейф.
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

    /** Радиальные пятна (ореол, ядро) рисуем один раз в спрайт и дальше
     *  только выводим с нужной прозрачностью. createRadialGradient плюс
     *  полноэкранный fillRect в каждом кадре — дорогая операция, а этих
     *  пятен было три. */
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

    /** Страховка под слабые машины: держим долю частиц, которую реально
     *  успеваем рисовать. Проседает кадр — урезаем, разгрузились — плавно
     *  возвращаем. Лучше пламя пожиже, чем подвисший сайт. */
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

      // База непрозрачная: этот холст и есть фон всей страницы.
      // Пока горит — чистый чёрный, чтобы огонь был единственным светом.
      // Гаснет — проступает космос. Замерено пипеткой по эталону: это почти
      // чёрный с едва холодным оттенком, #070b10, а не синь. Любая заметная
      // синева сразу читается как дешёвый градиент.
      const space = 1 - fire;
      ctx.fillStyle = `rgb(${Math.round(7 * space)}, ${Math.round(11 * space)}, ${Math.round(16 * space)})`;
      ctx.fillRect(0, 0, w, h);
      if (space > 0.01) {
        // Одна почти невидимая неровность, чтобы фон не был мёртво плоским
        const nb = Math.max(w, h) * 1.7;
        ctx.globalAlpha = 0.5 * space;
        ctx.drawImage(nebulaBlob, w * 0.72 - nb / 2, h * 0.22 - nb / 2, nb, nb);
        ctx.globalAlpha = 1;
      }

      const burning = fire > 0.02;

      if (burning) {
        // Прошлый кадр переносим с затуханием и лёгким раздуванием — получается
        // след. Режим copy обязателен: со сложением яркости буфер складывался
        // бы сам с собой и за пару секунд выбеливал экран.
        tctx.globalCompositeOperation = "copy";
        tctx.globalAlpha = 0.8;
        tctx.drawImage(trail, -trail.width * 0.005, -trail.height * 0.005, trail.width * 1.01, trail.height * 1.01);
        tctx.globalAlpha = 1;
        tctx.globalCompositeOperation = "lighter";
      } else {
        tctx.clearRect(0, 0, w, h);
      }

      ctx.globalCompositeOperation = "lighter";

      // Ореол вокруг пламени — свет, который оно отдаёт в пустоту
      if (fire > 0.01) {
        const gb = R * 6.8;
        ctx.globalAlpha = 0.2 * fire;
        ctx.drawImage(glowBlob, cx - gb / 2, cy - gb / 2, gb, gb);

        // Плотное ядро: центр должен быть тяжёлым, иначе шар выглядит рыхлым
        const hb = R * 1.24;
        ctx.globalAlpha = 0.34 * fire;
        ctx.drawImage(heartBlob, cx - hb / 2, cy - hb / 2, hb, hb);
        ctx.globalAlpha = 1;
      }

      const churn = now * 0.00055;
      // Медленное дыхание: настоящий шар пламени слегка ходит в объёме
      const breathe = 1 + Math.sin(now * 0.0011) * 0.035 * fire;

      // Урезаем с конца массива: порядок частиц случайный, так что
      // отбрасывается равномерный срез, а не какая-то одна часть шара.
      const active = burning ? Math.round(dots.length * budget) : dots.length;
      for (let di = 0; di < active; di++) {
        const d = dots[di];
        // Три несинхронных синуса дают живое кипение без генератора шума
        // Две октавы: крупные медленные завихрения задают силуэт,
        // мелкая рябь — деталь. На одной частоте масса выглядит однородной.
        const wob = fire * 0.17;
        const slow = fire * 0.13;
        // Вихрь: слои проворачиваются с разной скоростью, и масса перемешивается
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
        // Ниже главного экрана звёзды продолжают ехать: дальние медленно,
        // ближние быстрее. Поле замкнуто, ушедшее вверх приходит снизу.
        const past = Math.max(0, window.scrollY - stageBottom.current);
        const drift = past * (0.05 + (1 - d.rad) * 0.1);
        const span = h * 2;
        let restY = cy + d.sy * h * 0.5 - drift;
        if (past > 0) restY = cy - h * 0.5 + (((restY - cy + h * 0.5) % span) + span) % span;

        const go = easeOut(seg(t - d.delay, P.toStars, P.disperse));
        const x = ballX + (restX - ballX) * go;
        const y = ballY + (restY - ballY) * go;

        const depth = (bz + 1) / 2;

        // Цвет от радиуса: ядро белое, край тёмно-оранжевый, кромка синеет.
        // Когда огонь погас, все уходят в холодный конец шкалы.
        // Дымка уходит в тёмно-красный, тело держит середину,
        // искры разбегаются от белого ядра до кромки.
        const hot =
          d.kind === 0
            ? 4
            : d.kind === 1
              ? 2 + Math.min(2, Math.floor(d.rad * 2.6))
              : Math.min(sprites.length - 2, Math.floor(d.rad * 5.4));
        const idx = fire > 0.02 ? hot : sprites.length - 1;

        const size = d.size * (fire * (d.kind === 0 ? 10 : d.kind === 1 ? 3.7 : 1.9) + 0.92) * (0.55 + depth * 0.8);
        const twinkle = fire > 0.02 ? 1 : 0.55 + 0.45 * Math.sin(now * 0.0016 + d.twinkle);
        // Разлетевшись, звёзды не гаснут: они и есть фон второй половины
        // экрана, поэтому яркость к концу не падает, а слегка растёт.
        const alpha =
          (0.30 + depth * 0.42) *
          (fire * (d.kind === 0 ? 0.022 : d.kind === 1 ? 0.075 : 1.25) + (1 - fire) * (1.05 + away * 0.35)) *
          twinkle;

        if (burning) {
          // Пока горит — мягкие пятна со сложением яркости, и не на экран,
          // а в буфер следа: там они накапливаются в текущую массу
          tctx.globalAlpha = Math.max(alpha, 0);
          const sp = size * 7 * HALF;
          tctx.drawImage(sprites[idx], x * HALF - sp / 2, y * HALF - sp / 2, sp, sp);
        } else {
          // Погас — резкая точка. Размытый спрайт здесь читается как грязь,
          // а у эталона звёзды именно чёткие и мелкие.
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

      // Название: SPACE, пламя на месте слова FIRE, SECURITY SOFTWARE.
      //
      // На широком экране всё стоит в строку. На узком по бокам места нет,
      // слова сжимались до нечитаемых и обрезались, поэтому там раскладка
      // вертикальная: SPACE над огнём, SECURITY SOFTWARE под ним.
      //
      // Рисуем здесь, а не в разметке, намеренно: огонь отмеряется от
      // min(ширина, высота), а вёрстка от ширины окна. Это разные системы
      // координат, и при смене размера надписи уезжали от пламени.
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
          // Слева одно короткое слово, справа два длинных, поэтому вся надпись
          // кренилась вправо. Сдвигаем её на половину разницы: пламя остаётся
          // в середине окна, а внешние края становятся равноудалёнными.
          const shift = (rw - lw) / 2;

          ctx.textAlign = "right";
          ctx.fillText("Space", cx - gap - shift, cy);

          // Обе строки справа выключены по правому краю: «Security» короче
          // «Software», и при выключке влево правый край выходил рваным.
          const rightEdge = cx + gap - shift + rw;
          const lead = fs * 0.94;
          ctx.fillText("Security", rightEdge, cy - lead / 2);
          ctx.fillText("Software", rightEdge, cy + lead / 2);
        }
      }

      // Центральная плашка: гасит звёзды под текстом и растворяется к краям.
      // Замер эталона: яркость фона падает с ~10.5 по краям до ~4.6 в середине,
      // спад начинается около 16% ширины и добирает к 36%.
      if (space > 0.01) {
        // Градиент строится один раз на размер окна, а его сила задаётся
        // globalAlpha: иначе кеш заморозил бы прозрачность на первом кадре.
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

    // Наблюдатель, а не только событие окна.
    //
    // У холста position: fixed и inset: 0, то есть его коробка это и есть
    // окно. Событие resize до нас доходит не всегда: размер окна успевает
    // поменяться, пока вкладка неактивна, страница возвращается из кеша
    // истории, меняется масштаб браузера или экран, на котором окно живёт.
    // Тогда буфер остаётся прежним, а css растягивает его на новый размер,
    // и шар выходит на пол-экрана, звёзды в размытые кляксы, а название
    // складывается в два этажа, потому что ширина всё ещё считается малой.
    // Тот же случай, когда стили ещё не применились: у canvas свой размер
    // по умолчанию 300x150.
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
