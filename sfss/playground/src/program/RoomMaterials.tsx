import type { Lang } from "../shared/types";
import { MATERIALS, TESTED_RANGE, evidenceFor, saferThan, type MaterialKey } from "../shared/lib/bass";
import { MATERIAL_LABEL } from "../shared/data/habitat";
import { tr } from "../shared/i18n";

/** Что лежит в модуле и что об этом говорят опыты NASA.
 *
 *  Материалы можно добавлять и убирать: в этом и была идея цифрового
 *  двойника. Вердикт под каждым материалом не предсказание модели, а
 *  пересчёт конкретных запусков BASS-II рядом с текущим кислородом.
 *  Поэтому рядом всегда стоит, сколько опытов за этим стоит.
 */
export function RoomMaterials({
  materials, oxygenPct, onChange, lang,
}: {
  materials: MaterialKey[];
  oxygenPct: number;
  onChange: (next: MaterialKey[]) => void;
  lang: Lang;
}) {
  const toggle = (k: MaterialKey) =>
    onChange(materials.includes(k) ? materials.filter((m) => m !== k) : [...materials, k]);

  return (
    <div className="panel">
      <h3>{tr("materials", lang)}</h3>

      <div className="mat-pick">
        {MATERIALS.map((k) => (
          <button
            key={k}
            className="chip"
            aria-pressed={materials.includes(k)}
            onClick={() => toggle(k)}
          >
            {MATERIAL_LABEL[k][lang]}
          </button>
        ))}
      </div>

      {materials.length === 0 && <p className="footnote">{tr("matEmpty", lang)}</p>}

      {materials.map((k) => {
        const ev = evidenceFor(k, oxygenPct);
        const better = saferThan(k, oxygenPct);
        const share = ev.near ? Math.round((ev.burned / ev.near) * 100) : 0;
        const lo = ev.range ? ev.range[0].toFixed(1) : "?";
        const hi = ev.range ? ev.range[1].toFixed(1) : "?";

        return (
          <div className="verdict" key={k}>
            <div className="verdict-top">
              <b>{MATERIAL_LABEL[k][lang]}</b>
              <span>
                {ev.near
                  ? tr("matRuns", lang, { n: String(ev.near) })
                  : tr("matTested", lang, { lo, hi })}
              </span>
            </div>

            {/* Пустое окно по кислороду это не «ничего не горело», а «никто
                не мерил». Полоса и доля здесь были бы враньём. */}
            {ev.near === 0 ? (
              <p className="verdict-none">{tr("matNoRuns", lang, { o2: oxygenPct.toFixed(0) })}</p>
            ) : (
              <>
                <div className="verdict-bar">
                  <i style={{ width: `${share}%` }} />
                </div>

                <p>
                  {tr("matKept", lang, {
                    burned: String(ev.burned),
                    near: String(ev.near),
                    o2: oxygenPct.toFixed(0),
                  })}
                  {ev.sample?.test && ` ${tr("matSample", lang, { test: ev.sample.test })}`}
                </p>

                {better && (
                  <p className="verdict-swap">
                    {tr("matSwap", lang, {
                      other: MATERIAL_LABEL[better.key][lang],
                      burned: String(better.ev.burned),
                      near: String(better.ev.near),
                    })}
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Объяснение пробела нужно один раз на панель, а не под каждым
          материалом: под двумя материалами оно повторялось дословно. */}
      {materials.some((k) => evidenceFor(k, oxygenPct).near === 0) && (
        <p className="footnote">
          {tr("matGap", lang, {
            lo: TESTED_RANGE[0].toFixed(1),
            hi: TESTED_RANGE[1].toFixed(1),
          })}
        </p>
      )}

      {/* Оговорка про исходы нужна только когда исходы показаны */}
      {materials.length > 0 && <p className="footnote">{tr("bassCaveat", lang)}</p>}
    </div>
  );
}
