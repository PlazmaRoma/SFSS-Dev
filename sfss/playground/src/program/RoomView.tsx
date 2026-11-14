import type { Lang } from "../shared/types";
import type { Module } from "../shared/data/habitat";
import { MATERIAL_LABEL } from "../shared/data/habitat";
import type { MaterialKey } from "../shared/lib/bass";
import { evidenceFor } from "../shared/lib/bass";
import { flameColor } from "../shared/lib/risk";
import { tr } from "../shared/i18n";
import { useTween } from "../shared/lib/tween";
import { ModuleIcon } from "./ModuleIcon";
import { RoomDecor } from "./RoomDecor";

const W = 620;
const H = 300;

export function RoomView({
  module, materials, oxygenPct, ratio, lang,
}: {
  module: Module;
  materials: MaterialKey[];
  oxygenPct: number;
  ratio: number;
  lang: Lang;
}) {
  const shown = useTween(ratio);
  const color = flameColor(shown);
  const r = 20 * Math.pow(Math.max(shown, 0.4), 1.4);
  const rBase = 20;

  const rnd = (i: number, salt: number) => {
    const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const dots = Array.from({ length: Math.round(oxygenPct * 2.6) }, (_, i) => ({
    x: 44 + rnd(i, 1) * (W - 88),
    y: 62 + rnd(i, 2) * 168,
  })).filter((p) => Math.hypot(p.x - W / 2, (p.y - 148) * 1.8) > r * 1.7);

  return (
    <div className="panel room">
      <h3 className="room-title">
        <ModuleIcon id={module.id} size={18} />
        {module.name[lang]}
        <em>{module.role[lang]}</em>
      </h3>

      <svg className="room-plan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={module.name[lang]}>
        <rect x="18" y="40" width={W - 36} height="216" rx="42" className="hull" />
        <line x1="42" y1="236" x2={W - 42} y2="236" className="hull" />
        <line x1="70" y1="256" x2="58" y2="278" className="hull" />
        <line x1={W - 70} y1="256" x2={W - 58} y2="278" className="hull" />
        <line x1="20" y1="278" x2={W - 20} y2="278" className="regolith" />

        {dots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.4" className="air" />
        ))}

        <RoomDecor id={module.id} />

        <g className="crew">
          <circle cx="74" cy="196" r="6" />
          <line x1="74" y1="202" x2="74" y2="222" />
          <line x1="74" y1="208" x2="65" y2="215" />
          <line x1="74" y1="208" x2="83" y2="215" />
          <line x1="74" y1="222" x2="67" y2="236" />
          <line x1="74" y1="222" x2="81" y2="236" />
        </g>

        {materials.map((k, i) => {
          const ev = evidenceFor(k, oxygenPct);
          const kept = ev.near ? ev.burned / ev.near : 0;
          const x = W - 138;
          const y = 76 + i * 46;
          return (
            <g key={k}>
              <rect x={x} y={y} width="96" height="26" rx="3" className="mat" />
              <text x={x + 48} y={y + 17} className="mat-label">
                {MATERIAL_LABEL[k][lang].replace(/\s*\(.*\)/, "")}
              </text>
              {ev.near === 0 ? (
                <line x1={x} x2={x + 96} y1={y + 31.5} y2={y + 31.5} className="mat-none" />
              ) : (
                <>
                  <rect x={x} y={y + 30} width="96" height="3" rx="1.5" className="mat-track" />
                  <rect x={x} y={y + 30} width={96 * kept} height="3" rx="1.5" fill={flameColor(1 + kept * 0.5)} />
                </>
              )}
            </g>
          );
        })}

        <circle cx={W / 2} cy="148" r={r * 2.1} fill={color} opacity="0.1" />
        <circle cx={W / 2} cy="148" r={r} fill={color} opacity="0.85" />
        <circle cx={W / 2} cy="148" r={r * 0.4} fill="#fff" opacity="0.75" />
        <circle cx={W / 2} cy="148" r={rBase} className="ghost" />
      </svg>

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
      </div>
    </div>
  );
}
