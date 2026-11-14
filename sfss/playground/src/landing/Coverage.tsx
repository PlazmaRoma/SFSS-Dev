import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";
import data from "../shared/fixtures/coverage.json";

/** Где NASA мерила, а где нет.
 *
 *  Самая полезная клетка здесь — пустая. Обитаемые базы планируют на 34%
 *  кислорода, а твёрдые материалы выше 24% на орбите не жгли ни разу.
 *  Значит любое утверждение про ткань или пластик в этом диапазоне это
 *  экстраполяция, включая наше собственное. Об этом честнее сказать самим.
 */
interface Cell { lo: number; hi: number; n: number }
interface Row { key: string; source: string; cells: Cell[] }

const D = data as unknown as {
  bins: { lo: number; hi: number }[];
  rows: Row[];
  materials: { key: string; n: number; lo: number; hi: number }[];
  habitatO2: number;
  maxCell: number;
};

/** Плотность одним тоном, светлее к большему: так читается количество,
 *  а не категория. Пустые клетки не красим вовсе. */
function shade(n: number, max: number) {
  if (n === 0) return "transparent";
  const t = Math.sqrt(n / max);
  return `rgba(120, 178, 232, ${(0.12 + t * 0.72).toFixed(3)})`;
}

export function Coverage({ lang }: { lang: Lang }) {
  const gaps = D.rows.flatMap((r) => r.cells.filter((c) => c.n === 0).map((c) => ({ r, c })));

  return (
    <section className="cover" id="coverage">
      <h2>{tr("covH", lang)}</h2>

      <div className="cover-card">
        <div className="cover-grid" style={{ gridTemplateColumns: `140px repeat(${D.bins.length}, 1fr)` }}>
          <span />
          {D.bins.map((b) => (
            <span
              key={b.lo}
              className={D.habitatO2 >= b.lo && D.habitatO2 < b.hi ? "cover-head marked" : "cover-head"}
            >
              {b.lo}–{b.hi}%
            </span>
          ))}

          {D.rows.map((r) => (
            <div className="cover-line" key={r.key} style={{ display: "contents" }}>
              <span className="cover-name">
                {tr(r.key === "droplets" ? "covDroplets" : "covSolids", lang)}
                <em>{r.source}</em>
              </span>
              {r.cells.map((c) => (
                <span
                  key={c.lo}
                  className={c.n === 0 ? "cover-cell empty" : "cover-cell"}
                  style={{ background: shade(c.n, D.maxCell) }}
                  title={`${c.lo}–${c.hi}% O₂ · ${c.n}`}
                >
                  {c.n === 0 ? "—" : c.n}
                </span>
              ))}
            </div>
          ))}
        </div>

        <p className="cover-flag">
          <b>{gaps.length}</b> {tr("covGaps", lang, { o2: String(D.habitatO2) })}
        </p>

        <p className="cover-note">{tr("covNote", lang)}</p>
      </div>
    </section>
  );
}
