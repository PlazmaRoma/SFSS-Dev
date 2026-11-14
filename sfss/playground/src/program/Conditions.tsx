import { useMemo } from "react";
import type { Atmosphere, Lang, PredictResponse } from "../shared/types";
import type { Module } from "../shared/data/habitat";
import { predictOffline } from "../shared/api";
import { prettyUnits, tr } from "../shared/i18n";
import { band } from "../shared/lib/risk";
import { useTween } from "../shared/lib/tween";

const BAND_WORD: Record<string, Record<Lang, string>> = {
  safe: { en: "comparable to Earth", ru: "как на Земле" },
  elevated: { en: "burns noticeably faster", ru: "горит заметно быстрее" },
  high: { en: "burns much faster", ru: "горит намного быстрее" },
};

export function Conditions({
  module,
  atmosphere,
  onChange,
  onReset,
  result,
  ratio,
  units,
  lang,
  offline,
}: {
  module: Module;
  atmosphere: Atmosphere;
  onChange: (next: Atmosphere) => void;
  onReset: () => void;
  result: PredictResponse | null;
  ratio: number;
  units: string;
  lang: Lang;
  offline: boolean;
}) {
  const set = (patch: Partial<Atmosphere>) => onChange({ ...atmosphere, ...patch });

  // Сколько значит каждая ручка здесь и сейчас.
  //
  // Давление по всему диапазону 5…16 psi меняет скорость горения на два
  // процента: в данных FLEX его почти не варьировали, и у модели его вклад
  // 8 %. Без подписи ползунок выглядит нарисованным для галочки, хотя он
  // честно показывает, что здесь ничего не решает. Считаем по снятому кубу,
  // а не по бэкенду: восемнадцать выборок мгновенны и не шлют запросов.
  const sens = useMemo(() => {
    const span = (axis: (v: number) => Atmosphere, points: number[]) => {
      const vs = points.map((v) => predictOffline(axis(v)).predicted_value);
      const lo = Math.min(...vs);
      const hi = Math.max(...vs);
      return lo > 0 ? Math.round(((hi - lo) / lo) * 100) : 0;
    };
    return {
      oxygen: span((v) => ({ ...atmosphere, oxygen_level: v }), [0.16, 0.2, 0.24, 0.28, 0.34, 0.4]),
      pressure: span((v) => ({ ...atmosphere, pressure_psi: v }), [5, 8.2, 11, 13, 14.7, 16]),
      droplet: span((v) => ({ ...atmosphere, droplet_mm: v }), [1, 2, 3, 4, 5]),
    };
  }, [atmosphere]);

  // На виду коротко и тихо, в строке с названием: отдельной строкой подписи
  // удваивали высоту колонки. Полная фраза в подсказке.
  const hint = (p: number) => (
    <small className="control-sens" title={p < 3 ? tr("sensFlat", lang) : tr("sens", lang, { p: String(p) })}>
      {p < 3 ? tr("sensFlatShort", lang) : tr("sensShort", lang, { p: String(p) })}
    </small>
  );
  // Крупные цифры доезжают до нового значения, а не подменяются скачком
  const shownValue = useTween(result?.predicted_value ?? 0);
  const shownRatio = useTween(ratio);
  const dirty =
    atmosphere.oxygen_level !== module.atmosphere.oxygen_level ||
    atmosphere.pressure_psi !== module.atmosphere.pressure_psi ||
    atmosphere.droplet_mm !== module.atmosphere.droplet_mm;

  return (
    <div className="panel">
      <h3>{tr("conditions", lang)}</h3>

      <div className="control">
        <div className="control-top">
          <span>{tr("oxygen", lang)} {hint(sens.oxygen)}</span>
          <output>{(atmosphere.oxygen_level * 100).toFixed(0)}<small>%</small></output>
        </div>
        {/* Выше 40% обучающих данных FLEX нет — дальше модель просто повторяет
            последнее значение, поэтому ползунок здесь и заканчивается. */}
        <input
          type="range" min={16} max={40} step={1}
          value={Math.round(atmosphere.oxygen_level * 100)}
          onChange={(e) => set({ oxygen_level: Number(e.target.value) / 100 })}
          aria-label={tr("oxygen", lang)}
        />
      </div>

      <div className="control">
        <div className="control-top">
          <span>{tr("pressure", lang)} {hint(sens.pressure)}</span>
          <output>{atmosphere.pressure_psi.toFixed(1)}<small>psi</small></output>
        </div>
        <input
          type="range" min={5} max={16} step={0.1}
          value={atmosphere.pressure_psi}
          onChange={(e) => set({ pressure_psi: Number(e.target.value) })}
          aria-label={tr("pressure", lang)}
        />
      </div>

      <div className="control">
        <div className="control-top">
          <span>{tr("droplet", lang)} {hint(sens.droplet)}</span>
          <output>{atmosphere.droplet_mm.toFixed(1)}<small>mm</small></output>
        </div>
        <input
          type="range" min={1} max={5} step={0.1}
          value={atmosphere.droplet_mm}
          onChange={(e) => set({ droplet_mm: Number(e.target.value) })}
          aria-label={tr("droplet", lang)}
        />
      </div>

      <div className="readout-big">
        <b>{result ? shownValue.toFixed(3) : "·"}</b>
        <em>
          {prettyUnits(units)}
          <br />
          {shownRatio.toFixed(2)}× {tr("vsEarth", lang)}, {BAND_WORD[band(ratio)][lang]}
        </em>
      </div>

      {result?.is_heuristic && <p className="footnote warn">{tr("heuristic", lang)}</p>}

      {offline && <p className="footnote">{tr("offlinePredictNote", lang)}</p>}

      {result && result.defaults_applied.length > 0 && (
        <p className="footnote">{tr("defaultsNote", lang)}</p>
      )}

      {module.note && <p className="note-box">{module.note[lang]}</p>}

      {dirty && (
        <p style={{ marginTop: "16px" }}>
          <button className="linkish" onClick={onReset}>{tr("reset", lang)}</button>
        </p>
      )}
    </div>
  );
}
