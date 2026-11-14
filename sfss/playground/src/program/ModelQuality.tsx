import type { DashboardModel, Lang } from "../shared/types";
import { FEATURE_LABEL, prettyUnits, tr } from "../shared/i18n";

export function ModelQuality({ model, lang }: { model: DashboardModel; lang: Lang }) {
  const top = Object.entries(model.feature_importance)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const max = top[0]?.[1] ?? 1;

  return (
    <div className="panel" id="evidence">
      <h3>{tr("modelQuality", lang)}</h3>
      <div className="metrics">
        <div className="metric">
          <b>{model.metrics.mae.toFixed(3)}</b>
          <span>{lang === "en" ? "mean error" : "средняя ошибка"}</span>
        </div>
        <div className="metric">
          <b style={{ color: "var(--readout-faint)" }}>{model.metrics.mae_baseline.toFixed(3)}</b>
          <span>{lang === "en" ? "error of a constant guess" : "ошибка постоянного ответа"}</span>
        </div>
        <div className="metric">
          <b>{model.metrics.rows}</b>
          <span>{lang === "en" ? "NASA runs trained on" : "опытов в обучении"}</span>
        </div>
      </div>
      <p className="footnote">
        {tr("errorVsConst", lang, {
          mae: `${model.metrics.mae.toFixed(3)} ${prettyUnits(model.units)}`,
          base: `${model.metrics.mae_baseline.toFixed(3)}`,
        })}
      </p>

      <div className="drivers">
        <h3 style={{ marginBottom: "12px" }}>{tr("drives", lang)}</h3>
        {top.map(([feature, weight]) => (
          <div className="driver" key={feature}>
            <span className="driver-label">{FEATURE_LABEL[feature]?.[lang] ?? feature}</span>
            <span className="driver-pct">{Math.round(weight * 100)}%</span>
            <span className="driver-track">
              <i style={{ width: `${(weight / max) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
