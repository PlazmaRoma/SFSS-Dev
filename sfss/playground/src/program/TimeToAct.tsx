import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";
import { useTween } from "../shared/lib/tween";
import data from "../shared/fixtures/burntime.json";

interface Run { o: number; t: number; id: string }
const RUNS = (data as unknown as { runs: Run[] }).runs;
const SPAN = 24;

export function TimeToAct({ oxygenPct, lang }: { oxygenPct: number; lang: Lang }) {
  const [run, setRun] = useState<{ o: number; s: number } | null>(null);
  const elapsed = run && run.o === oxygenPct ? run.s : null;
  const raf = useRef(0);

  const near = useMemo(() => {
    for (const band of [1.5, 3, 5, 8, 12]) {
      const hit = RUNS.filter((r) => Math.abs(r.o - oxygenPct) <= band);
      if (hit.length >= 10) return hit;
    }
    const widest = RUNS.filter((r) => Math.abs(r.o - oxygenPct) <= 12);
    return widest.length ? widest : RUNS;
  }, [oxygenPct]);

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
