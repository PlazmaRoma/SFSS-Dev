import { useMemo } from "react";
import type { Lang } from "../shared/types";
import type { Module } from "../shared/data/habitat";
import { band } from "../shared/lib/risk";
import { prettyUnits, tr } from "../shared/i18n";

/** Модули, отсортированные по риску, с номерами.
 *
 *  Задание требует не только обобщать и объяснять, но и ранжировать.
 *  Поэтому это не просто список для выбора: порядок здесь и есть ответ
 *  на вопрос «где опаснее всего», а номер читается с первого взгляда.
 */
export function ModuleRank({
  modules, ratios, values, units, selected, onSelect, lang,
}: {
  modules: Module[];
  ratios: Record<string, number>;
  values: Record<string, number>;
  units: string;
  selected: string;
  onSelect: (id: string) => void;
  lang: Lang;
}) {
  const ranked = useMemo(
    () => [...modules].sort((a, b) => (ratios[b.id] ?? 1) - (ratios[a.id] ?? 1)),
    [modules, ratios],
  );

  return (
    // Одна узкая полоса: две строки карточек отнимали высоту у комнаты.
    // Скорость горения модуля в подсказке, на полосе только порядок и разы.
    <div className="rank">
      <h3 className="rank-head">{tr("rankH", lang)}</h3>

      <div className="rank-strip" role="tablist" aria-label={tr("rankH", lang)}>
        {ranked.map((m, i) => {
          const ratio = ratios[m.id] ?? 1;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={selected === m.id}
              className={selected === m.id ? "rank-item on" : "rank-item"}
              onClick={() => onSelect(m.id)}
              title={values[m.id] !== undefined ? `${m.name[lang]}: ${values[m.id].toFixed(3)} ${prettyUnits(units)}` : m.name[lang]}
            >
              {/* Без иконки: на узкой полосе она отнимала место у названия, а
                  иконка модуля и так стоит в заголовке комнаты */}
              <span className="rank-no">{i + 1}</span>
              <span className="rank-name">{m.name[lang]}</span>
              <span className={`rank-ratio ${band(ratio)}`}>{ratio.toFixed(2)}×</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
