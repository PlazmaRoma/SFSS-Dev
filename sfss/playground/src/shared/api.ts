import type { Atmosphere, CacheEntry, Dashboard, Health, PredictResponse } from "../shared/types";
import { PSI_TO_MMHG } from "../shared/lib/risk";
import { createClient } from "./client";

export { readEvents } from "./client";
export type { Progress, StreamEvent } from "./client";

import dashboardFixture from "../shared/fixtures/dashboard.json";
import healthFixture from "../shared/fixtures/health.json";
import queryCache from "../shared/fixtures/query_cache.json";
import cubeFixture from "../shared/fixtures/predict_cube.json";

const BASE = import.meta.env.VITE_API ?? "http://localhost:8000";

/** Бэкенд может быть не поднят — тогда всё берётся из снятых фикстур.
 *  Это не заглушка: файлы сняты с этого же бэкенда, цифры настоящие. */
export const cache = queryCache as unknown as Record<string, CacheEntry>;

const client = createClient({ base: BASE });
/** Настройки AI есть только на /v1. Старые пути Площадки остаются как есть. */
export const v1Client = createClient({ base: BASE, prefix: "/v1" });

export const fetchHealth = () => client.get<Health>("/health", 4000);
export const fetchDashboard = () => client.get<Dashboard>("/dashboard", 15_000);

export const offlineHealth = healthFixture as Health;
export const offlineDashboard = dashboardFixture as unknown as Dashboard;

export const toParams = (a: Atmosphere) => ({
  oxygen_level: Number(a.oxygen_level.toFixed(3)),
  n2: Number((1 - a.oxygen_level).toFixed(3)),
  pressure_mmhg: Number((a.pressure_psi * PSI_TO_MMHG).toFixed(1)),
  d_initial_mm: a.droplet_mm,
});

/** Пять секунд, а не пятнадцать: живой ответ приходит за десяток
 *  миллисекунд, и если бэкенд пропал, честнее быстро упасть на снятый
 *  куб, чем держать на экране старое число как будто оно новое. */
export const predict = (a: Atmosphere) =>
  client.post<PredictResponse>("/predict", { parameters: toParams(a) }, 5000);

/** Нужен бэкенд с полем language (PlazmaRoma/Anti-Fire_backend_MVP#4): старый его
 *  молча игнорирует, и на английский вопрос ответ придёт по-русски. Русский вопрос
 *  бэкенд сам ищет по английскому переводу (#5), фронту этот перевод не нужен. */
export const askLive = client.askLive;
export const askStream = client.askStream;

/** Оффлайн-предсказание: снятый куб модели по трём осям и линейная
 *  интерполяция между узлами.
 *
 *  Куб снят с этого же бэкенда (tools/build_predict_cube.py): 25 шагов по
 *  кислороду, 14 по давлению, 17 по размеру капли. В сетку специально
 *  включены 14.7 и 8.2 psi: на них стоят все модули базы, и отношение
 *  1.40x должно совпадать с живой моделью до третьего знака. Ползунки
 *  идут мельче узлов, поэтому между ними считаем трилинейно: медиана
 *  расхождения 0.03 %, худший случай около 6 % у мелких капель.
 *
 *  Раньше здесь подбиралась ближайшая точка только по кислороду, и два
 *  ползунка из трёх цифру не двигали. По живой модели размер капли меняет
 *  скорость горения в 1.43 раза, так что это была не мелочь. */
type Cube = {
  oxygen_level: number[];
  pressure_psi: number[];
  droplet_mm: number[];
  values: number[][][];
  target: string;
  defaults_applied: string[];
  heuristic: number[] | null;
};
const cube = cubeFixture as unknown as Cube;

/** Номер нижнего узла и доля до следующего. За краями сетки прижимаем. */
function locate(axis: number[], v: number): [number, number] {
  if (v <= axis[0]) return [0, 0];
  const last = axis.length - 1;
  if (v >= axis[last]) return [last - 1, 1];
  let i = 0;
  while (i < last - 1 && axis[i + 1] <= v) i += 1;
  return [i, (v - axis[i]) / (axis[i + 1] - axis[i])];
}

export function predictOffline(a: Atmosphere): PredictResponse {
  const [io, fo] = locate(cube.oxygen_level, a.oxygen_level);
  const [ip, fp] = locate(cube.pressure_psi, a.pressure_psi);
  const [id, fd] = locate(cube.droplet_mm, a.droplet_mm);

  const at = (x: number, y: number, z: number) => cube.values[x][y][z];
  const mix = (lo: number, hi: number, f: number) => lo + (hi - lo) * f;

  const d00 = mix(at(io, ip, id), at(io, ip, id + 1), fd);
  const d01 = mix(at(io, ip + 1, id), at(io, ip + 1, id + 1), fd);
  const d10 = mix(at(io + 1, ip, id), at(io + 1, ip, id + 1), fd);
  const d11 = mix(at(io + 1, ip + 1, id), at(io + 1, ip + 1, id + 1), fd);
  const value = mix(mix(d00, d01, fp), mix(d10, d11, fp), fo);

  const nz = cube.pressure_psi.length * cube.droplet_mm.length;
  const flat = (io + (fo > 0.5 ? 1 : 0)) * nz
    + (ip + (fp > 0.5 ? 1 : 0)) * cube.droplet_mm.length
    + (id + (fd > 0.5 ? 1 : 0));

  return {
    predicted_value: value,
    risk_score: value,
    target: cube.target,
    defaults_applied: cube.defaults_applied,
    is_heuristic: cube.heuristic ? cube.heuristic[flat] === 1 : false,
  };
}
