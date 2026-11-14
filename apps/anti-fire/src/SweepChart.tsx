import { useState } from "react";
import { tr } from "./lang";

const WIDTH = 480;
const HEIGHT = 170;
const PAD = { left: 44, right: 12, top: 12, bottom: 30 };
// Выше этого кислорода опытов FLEX нет, модель выходит на плато
const TRAINING_MAX_O2 = 0.34;

/** Скорость горения по кислороду при остальных условиях неизменных.
 *  chart_data.y — риск от 0 до 1, в единицы он возвращается через диапазон цели. */
export function SweepChart({ x, risk, range, current, currentValue }: {
  x: number[];
  risk: number[];
  range: [number, number] | null;
  current: number;
  currentValue: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [low, high] = range ?? [0, 1];
  const y = risk.map((value) => low + value * (high - low));

  const minX = x[0];
  const maxX = x[x.length - 1];
  const rawMin = Math.min(...y, currentValue ?? Infinity);
  const rawMax = Math.max(...y, currentValue ?? -Infinity);
  const pad = Math.max((rawMax - rawMin) * 0.15, 0.02);
  const minY = rawMin - pad;
  const maxY = rawMax + pad;

  const px = (value: number) => PAD.left + ((value - minX) / (maxX - minX)) * (WIDTH - PAD.left - PAD.right);
  const py = (value: number) => PAD.top + (1 - (value - minY) / (maxY - minY)) * (HEIGHT - PAD.top - PAD.bottom);

  const path = x.map((value, i) => `${i ? "L" : "M"}${px(value).toFixed(1)} ${py(y[i]).toFixed(1)}`).join(" ");
  const yTicks = [minY + pad, (minY + maxY) / 2, maxY - pad];
  const xTicks = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4].filter((tick) => tick >= minX - 1e-9 && tick <= maxX + 1e-9);
  const showCurrent = currentValue !== null && current >= minX && current <= maxX;

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (event.clientX - box.left) / box.width;
    setHover(Math.min(x.length - 1, Math.max(0, Math.round(share * (x.length - 1)))));
  };

  const summary = tr("chartSummary", {
    low: Math.min(...y).toFixed(2),
    high: Math.max(...y).toFixed(2),
    from: (minX * 100).toFixed(0),
    to: (maxX * 100).toFixed(0),
  });

  return (
    <figure className="chart">
      <figcaption>{tr("chartCaption")}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={py(tick)} y2={py(tick)} />
            <text className="tick" x={PAD.left - 6} y={py(tick) + 3} textAnchor="end">{tick.toFixed(2)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={tick} className="tick" x={px(tick)} y={HEIGHT - PAD.bottom + 14} textAnchor="middle">{Math.round(tick * 100)}</text>
        ))}
        <text className="tick" x={WIDTH - PAD.right} y={HEIGHT - 3} textAnchor="end">O₂, %</text>
        {maxX > TRAINING_MAX_O2 && (
          <g>
            <rect className="beyond" x={px(TRAINING_MAX_O2)} y={PAD.top} width={px(maxX) - px(TRAINING_MAX_O2)} height={HEIGHT - PAD.top - PAD.bottom} />
            <text className="tick" x={px(TRAINING_MAX_O2) + 4} y={PAD.top + 11}>{tr("noExperiments")}</text>
          </g>
        )}
        <path className="line" d={path} />
        {showCurrent && <circle className="marker" cx={px(current)} cy={py(currentValue)} r={5} />}
        {hover !== null && (
          <g>
            <line className="crosshair" x1={px(x[hover])} x2={px(x[hover])} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            <circle className="hover-dot" cx={px(x[hover])} cy={py(y[hover])} r={4} />
            <text
              className="tooltip"
              x={px(x[hover]) + (px(x[hover]) > WIDTH * 0.7 ? -8 : 8)}
              y={PAD.top + 26}
              textAnchor={px(x[hover]) > WIDTH * 0.7 ? "end" : "start"}
            >
              {(x[hover] * 100).toFixed(1)} % → {y[hover].toFixed(3)} {tr("burnUnit")}
            </text>
          </g>
        )}
        <rect
          className="hit"
          x={PAD.left}
          y={PAD.top}
          width={WIDTH - PAD.left - PAD.right}
          height={HEIGHT - PAD.top - PAD.bottom}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
    </figure>
  );
}
