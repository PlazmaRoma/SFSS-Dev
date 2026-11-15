import { useMemo } from "react";
import type { Lang } from "../shared/types";
import type { Module } from "../shared/data/habitat";
import { MATERIAL_LABEL } from "../shared/data/habitat";
import type { MaterialKey } from "../shared/lib/bass";
import { evidenceFor } from "../shared/lib/bass";
import { flameColor } from "../shared/lib/risk";
import { tr } from "../shared/i18n";
import { useTween } from "../shared/lib/tween";
import { ModuleIcon } from "./ModuleIcon";
import { Room3D } from "./Room3D";

export function RoomView({
  module, materials, oxygenPct, pressurePsi, dropletMm, value, ratio, lang,
}: {
  module: Module;
  materials: MaterialKey[];
  oxygenPct: number;
  pressurePsi: number;
  dropletMm: number;
  value: number | null;
  ratio: number;
  lang: Lang;
}) {
  const shown = useTween(ratio);
  const color = flameColor(shown);
  const radius = 20 * Math.pow(Math.max(shown, 0.4), 1.4);
  const burnout = value && value > 0 ? (dropletMm * dropletMm) / value : null;

  const flame = {
    color,
    radius,
    baseRadius: 20,
    soot: Math.min(Math.max((shown - 0.95) / 0.5, 0.12), 0.9),
    droplet: dropletMm,
    o2Share: oxygenPct / 100,
    density: Math.min(Math.max(pressurePsi / 14.7, 0.35), 1.1) / 1.1,
    intensity: Math.max(shown - 0.6, 0.2),
  };

  const mats = useMemo(
    () =>
      materials.map((k) => {
        const ev = evidenceFor(k, oxygenPct);
        const kept = ev.near ? ev.burned / ev.near : 0;
        return {
          key: k,
          label: MATERIAL_LABEL[k][lang].replace(/\s*\(.*\)/, ""),
          kept,
          none: ev.near === 0,
          color: flameColor(1 + kept * 0.5),
        };
      }),
    [materials, oxygenPct, lang],
  );

  return (
    <div className="panel room">
      <h3 className="room-title">
        <ModuleIcon id={module.id} size={18} />
        {module.name[lang]}
        <em>{module.role[lang]}</em>
      </h3>

      <div className="room-3d" role="img" aria-label={module.name[lang]}>
        <Room3D
          moduleId={module.id}
          fallback={tr("room3dOff", lang)}
          flame={flame}
          materials={mats.map(({ label, kept, color: c }) => ({ label, kept, color: c }))}
        />

        <div className="room-hud">
          <b>O₂ {oxygenPct.toFixed(0)}%</b>
          <span>{pressurePsi.toFixed(1)} psi</span>
          <span>{tr("roomDroplet", lang, { d: dropletMm.toFixed(1) })}</span>
          <i><em style={{ width: `${Math.min(oxygenPct / 40, 1) * 100}%`, background: color }} /></i>
        </div>

        {mats.length > 0 && (
          <ul className="room-mats">
            {mats.map((m) => (
              <li key={m.key}>
                <span>{m.label}</span>
                {m.none ? (
                  <i className="none" />
                ) : (
                  <i><em style={{ width: `${m.kept * 100}%`, background: m.color }} /></i>
                )}
              </li>
            ))}
          </ul>
        )}

        {value !== null && (
          <div className="room-readout">
            <b style={{ color }}>K {value.toFixed(3)}</b> mm²/s
            {burnout !== null && <span> · {tr("roomBurnout", lang, { t: burnout.toFixed(1) })}</span>}
          </div>
        )}

        <div className="room-hint">{tr("roomDrag", lang)}</div>
      </div>

      <div className="room-key">
        <span><i className="k-ghost" />{tr("roomBase", lang)}</span>
        <span>
          <i style={{ background: color }} />
          {ratio > 1.005
            ? tr("roomNow", lang, { r: ratio.toFixed(2) })
            : ratio < 0.995
              ? tr("roomSlower", lang, { r: ratio.toFixed(2) })
              : tr("roomSame", lang)}
        </span>
        <span><i className="k-o2" />{tr("roomO2", lang)}</span>
        <span><i className="k-n2" />{tr("roomN2", lang)}</span>
        <span><i className="k-soot" />{tr("roomSoot", lang)}</span>
      </div>
    </div>
  );
}
