import { useState } from "react";
import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";
import data from "../shared/fixtures/gaps.json";

type Fuel = "methanol" | "heptane";

interface Run { o2: number; psi: number; n: number }
interface Suggestion {
  o2: number; psi: number; value: number; spread: number; score: number;
  nearest: string; nearest_o2: number; nearest_psi: number;
}
interface FuelGaps { score: number[][]; runs: Run[]; runs_total: number; suggestions: Suggestion[] }

const D = data as unknown as {
  oxygen_level: number[];
  pressure_psi: number[];
  droplet_mm: number;
  fuels: Record<Fuel, FuelGaps>;
  holdout: { o2_above: number; hidden_rows: number; mae_seen: number; mae_hidden: number };
};

const FUELS: Fuel[] = ["methanol", "heptane"];
const MARKS = [
  { key: "ISS", o2: 0.21, psi: 14.7 },
  { key: "Artemis", o2: 0.34, psi: 8.2 },
];

const nearestIndex = (axis: number[], v: number) =>
  axis.reduce((best, a, i) => (Math.abs(a - v) < Math.abs(axis[best] - v) ? i : best), 0);

const cellKey = (o2: number, psi: number) =>
  `${nearestIndex(D.oxygen_level, o2)}:${nearestIndex(D.pressure_psi, psi)}`;

function shade(score: number) {
  const t = 1 - Math.sqrt(score);
  return `rgba(120, 178, 232, ${(0.06 + t * 0.78).toFixed(3)})`;
}

const pct = (v: number) => Math.round(v * 100);

export function NextExperiment({ lang }: { lang: Lang }) {
  const [fuel, setFuel] = useState<Fuel>("methanol");
  const gaps = D.fuels[fuel];

  const runs = new Map<string, number>();
  for (const r of gaps.runs) {
    const k = cellKey(r.o2, r.psi);
    runs.set(k, (runs.get(k) ?? 0) + r.n);
  }
  const stars = new Map(gaps.suggestions.map((s, i) => [cellKey(s.o2, s.psi), i + 1]));
  const marks = new Map(MARKS.map((m) => [cellKey(m.o2, m.psi), m.key]));

  const rows = D.pressure_psi.map((_, i) => i).reverse();
  const ratio = (D.holdout.mae_hidden / D.holdout.mae_seen).toFixed(1);

  return (
    <section className="gaps">
      <div className="gaps-top">
        <h3>{tr("gapsH", lang)}</h3>
        <div className="gaps-fuel">
          {FUELS.map((f) => (
            <button key={f} className={fuel === f ? "on" : undefined} onClick={() => setFuel(f)}>
              {tr(`gapsFuel_${f}`, lang)}
            </button>
          ))}
        </div>
      </div>
      <p className="gaps-lead">{tr("gapsLead", lang, { d: String(D.droplet_mm), n: String(gaps.runs_total) })}</p>

      <div className="gaps-map" style={{ gridTemplateColumns: `34px repeat(${D.oxygen_level.length}, 1fr)` }}>
        {rows.map((ip) => (
          <div key={ip} style={{ display: "contents" }}>
            <span className="gaps-axis">{D.pressure_psi[ip]}</span>
            {D.oxygen_level.map((o2, io) => {
              const k = `${io}:${ip}`;
              const star = stars.get(k);
              const mark = marks.get(k);
              const n = runs.get(k);
              const title = [
                `${pct(o2)}% O₂ · ${D.pressure_psi[ip]} psi`,
                mark,
                n ? tr("gapsRuns", lang, { n: String(n) }) : "",
                star ? tr("gapsStar", lang, { i: String(star) }) : "",
              ].filter(Boolean).join(" · ");
              return (
                <span
                  key={k}
                  className={mark ? "gaps-cell marked" : "gaps-cell"}
                  style={{ background: shade(gaps.score[io][ip]) }}
                  title={title}
                >
                  {star ? <b className="gaps-star">★</b> : n ? <i className="gaps-dot" /> : null}
                  {mark && <em>{mark}</em>}
                </span>
              );
            })}
          </div>
        ))}
        <span className="gaps-axis unit">psi</span>
        {D.oxygen_level.map((o2, io) => (
          <span key={o2} className="gaps-axis x">{io % 5 === 0 ? `${pct(o2)}%` : ""}</span>
        ))}
      </div>

      <div className="gaps-legend">
        <span><i className="gaps-swatch sure" />{tr("gapsSure", lang)}</span>
        <span><i className="gaps-swatch unsure" />{tr("gapsUnsure", lang)}</span>
        <span><i className="gaps-dot" />{tr("gapsLegendRun", lang)}</span>
        <span><b className="gaps-star">★</b>{tr("gapsLegendStar", lang)}</span>
      </div>

      <ol className="gaps-list">
        {gaps.suggestions.map((s) => (
          <li key={`${s.o2}:${s.psi}`}>
            <strong>{pct(s.o2)}% O₂ · {s.psi} psi</strong>
            <span>
              {tr("gapsWhy", lang, {
                test: s.nearest,
                o2: String(pct(s.nearest_o2)),
                psi: String(s.nearest_psi),
                value: s.value.toFixed(2),
                spread: s.spread.toFixed(2),
              })}
            </span>
          </li>
        ))}
      </ol>

      <p className="gaps-note">
        {tr("gapsCheck", lang, {
          o2: String(pct(D.holdout.o2_above)),
          n: String(D.holdout.hidden_rows),
          ratio,
        })}
      </p>
    </section>
  );
}
