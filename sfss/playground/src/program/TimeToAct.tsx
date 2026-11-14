import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";
import { useTween } from "../shared/lib/tween";
import data from "../shared/fixtures/burntime.json";

/** Сколько длится пожар в этой атмосфере.
 *
 *  Шесть секунд на бумаге ничего не значат. Поэтому здесь не график, а
 *  часы: бегунок проходит шкалу ровно за столько, сколько горел настоящий
 *  огонь в опытах NASA при этом кислороде. Засечки на линии — сами опыты.
 */
interface Run { o: number; t: number; id: string }
const RUNS = (data as unknown as { runs: Run[] }).runs;
const SPAN = 24; // секунд на шкале: дальше хвост из редких долгих опытов

export function TimeToAct({ oxygenPct, lang }: { oxygenPct: number; lang: Lang }) {
  // Прогон помнит, при каком кислороде его запустили. Сдвинули ползунок —
  // прогон к новой атмосфере не относится, и часы возвращаются к медиане.
  // Раньше сброс делал эффект, но анимация продолжала писать время, и
  // старый прогон доигрывал поверх новой атмосферы.
  const [run, setRun] = useState<{ o: number; s: number } | null>(null);
  const elapsed = run && run.o === oxygenPct ? run.s : null;
  const raf = useRef(0);

  // Опыты рядом с текущим кислородом: окно расширяется, пока не наберётся
  // хотя бы десяток, иначе медиана скачет по одной-двум точкам.
  //
  // Опыты FLEX заканчиваются на 34% кислорода, а ползунок идёт до 40%.
  // Раньше на 39% не набиралось десятка даже в окне ±8, и медиана падала
  // на все 268 опытов сразу: 15.3 с превращались в 9.6 с, посчитанные по
  // низким кислородам. Поэтому окно доходит до ±12 и остаётся у ближайших
  // настоящих опытов, а интерфейс пишет, при каком кислороде они шли.
  const near = useMemo(() => {
    for (const band of [1.5, 3, 5, 8, 12]) {
      const hit = RUNS.filter((r) => Math.abs(r.o - oxygenPct) <= band);
      if (hit.length >= 10) return hit;
    }
    const widest = RUNS.filter((r) => Math.abs(r.o - oxygenPct) <= 12);
    return widest.length ? widest : RUNS;
  }, [oxygenPct]);

  // Насколько далеко пришлось уйти за данными: если ближайшие опыты не
  // при этом кислороде, об этом надо сказать, а не прятать.
  const spread = useMemo(() => {
    const ox = near.map((r) => r.o);
    return { lo: Math.min(...ox), hi: Math.max(...ox) };
  }, [near]);
  const far = Math.abs(spread.lo - oxygenPct) > 5 || Math.abs(spread.hi - oxygenPct) > 5;

  const median = useMemo(() => {
    const v = near.map((r) => r.t).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 0;
  }, [near]);

  const play = () => {
    cancelAnimationFrame(raf.current);
    const o = oxygenPct;
    const t0 = performance.now();
    const step = (now: number) => {
      const s = (now - t0) / 1000;
      if (s >= median) {
        setRun({ o, s: median });
        return;
      }
      setRun({ o, s });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const eased = useTween(median);
  const shown = elapsed ?? eased;
  const done = elapsed !== null && elapsed >= median;
  const pct = (v: number) => Math.min(100, (v / SPAN) * 100);

  return (
    <div className="panel clock">
      <h3>{tr("clockH", lang)}</h3>

      <div className="clock-read">
        <b className={elapsed !== null && !done ? "running" : undefined}>{shown.toFixed(1)}</b>
        <span>{tr("clockSec", lang)}</span>
        <button className="linkish" onClick={play}>
          {tr(elapsed === null ? "clockPlay" : "clockAgain", lang)}
        </button>
      </div>

      <div className="clock-line">
        {/* Каждая засечка — один опыт NASA, а не сглаженная кривая */}
        {near.map((r, i) => (
          <i key={i} style={{ left: `${pct(r.t)}%` }} title={`${r.id} · ${r.t} s`} />
        ))}
        <u style={{ left: `${pct(median)}%` }} />
        {elapsed !== null && <s style={{ left: `${pct(elapsed)}%` }} />}
      </div>

      <div className="clock-axis">
        <span>0</span>
        <span>{SPAN} {tr("clockSec", lang)}</span>
      </div>

      <p className="footnote">
        {tr("clockNote", lang, { n: String(near.length), o2: oxygenPct.toFixed(0), med: median.toFixed(1) })}
        {far && ` ${tr("clockFar", lang, { lo: spread.lo.toFixed(0), hi: spread.hi.toFixed(0) })}`}
      </p>
    </div>
  );
}
