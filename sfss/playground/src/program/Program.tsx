import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Atmosphere, Dashboard, Health, Lang, PredictResponse } from "../shared/types";
import { BASELINE, HABITAT } from "../shared/data/habitat";
import type { MaterialKey } from "../shared/lib/bass";
import {
  fetchDashboard, fetchHealth, offlineDashboard, offlineHealth, predict, predictOffline, v1Client,
} from "../shared/api";
import { TopBar } from "../shared/TopBar";
import { LlmSettings } from "../shared/LlmSettings";
import { tr } from "../shared/i18n";
import { Finding } from "./Finding";
import { MirCase } from "./MirCase";
import { ModuleRank } from "./ModuleRank";
import { Conditions } from "./Conditions";
import { RoomMaterials } from "./RoomMaterials";
import { TimeToAct } from "./TimeToAct";
import { RoomView } from "./RoomView";
import { Explain } from "./Explain";
import { ModelQuality } from "./ModelQuality";
import "../shared/app.css";

/** Программа: рабочий стол по базе.
 *
 *  Отдельная сборка от лендинга, но код общий — компоненты и данные те же.
 *  Запускается без бэкенда: любая цифра берётся из снятых фикстур, а когда
 *  бэкенд поднят, предсказания и ответы ИИ становятся живыми.
 */
// Вопрос к AI не во вкладке: его искали и не находили, теперь он всегда на экране
const TABS = ["time", "mats", "trust"] as const;
type Tab = (typeof TABS)[number];

const initialAtmospheres = () =>
  Object.fromEntries(HABITAT.map((m) => [m.id, { ...m.atmosphere }])) as Record<string, Atmosphere>;

export default function Program() {
  const [lang, setLang] = useState<Lang>("en");
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<Health>(offlineHealth);
  const [dashboard, setDashboard] = useState<Dashboard>(offlineDashboard);
  const [atmos, setAtmos] = useState<Record<string, Atmosphere>>(initialAtmospheres);
  const [mats, setMats] = useState<Record<string, MaterialKey[]>>(() =>
    Object.fromEntries(HABITAT.map((m) => [m.id, [...m.materials]])),
  );
  const [results, setResults] = useState<Record<string, PredictResponse>>({});
  const [baseline, setBaseline] = useState<number | null>(null);
  const [selected, setSelected] = useState(HABITAT[0].id);
  const [tab, setTab] = useState<Tab>("time");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [h, d] = await Promise.all([fetchHealth(), fetchDashboard()]);
        if (!alive) return;
        setHealth(h);
        setDashboard(d);
        setOnline(true);
      } catch {
        if (alive) setOnline(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Бэкенд могли поднять уже после запуска программы, а health мы читали
  // только при старте: обещание «поднимите бэкенд и программа подхватит»
  // не выполнялось до перезагрузки.
  //
  // Пауза живёт в ref, а не в эффекте. Иначе получалось мигание: бэкенд
  // отвечает на health, но не успевает с предсказанием, predict падает по
  // таймауту, режим снова оффлайн, эффект перезапускается с начальной
  // паузой и всё повторяется по кругу. Теперь попытки редеют, а быстрый
  // путь остаётся один: вернуть фокус в окно.
  const probe = useRef({ wait: 8000, tries: 0 });
  useEffect(() => {
    if (online) return;
    // Каждое возвращение в оффлайн удлиняет следующую попытку, даже если
    // health отвечал: значит упало предсказание, и долбиться чаще незачем.
    if (probe.current.tries > 0) {
      probe.current.wait = Math.min(probe.current.wait * 2, 60_000);
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stop) return;
      probe.current.tries += 1;
      try {
        const [h, d] = await Promise.all([fetchHealth(), fetchDashboard()]);
        if (stop) return;
        setHealth(h);
        setDashboard(d);
        setOnline(true);
        return;
      } catch {
        probe.current.wait = Math.min(probe.current.wait * 2, 60_000);
      }
      // Три попытки закрывают главный случай: бэкенд ещё загружался, когда
      // программу открыли. Дальше ждём возврата фокуса, чтобы у того, кто
      // бэкенд не поднимает вообще, не копились отказы в консоли.
      if (!stop && probe.current.tries < 3) timer = setTimeout(tick, probe.current.wait);
    };

    timer = setTimeout(tick, probe.current.wait);
    // Возврат в окно это явное действие: пробуем сразу и снимаем счётчик
    const onFocus = () => {
      probe.current = { wait: 8000, tries: 0 };
      clearTimeout(timer);
      timer = setTimeout(tick, 200);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      stop = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [online]);

  // LM Studio поднимают и гасят отдельно от бэкенда, поэтому его состояние,
  // прочитанное при старте, быстро устаревает. Перечитываем, когда человек
  // открывает вкладку с ответами ИИ и когда живой ответ не пришёл. При
  // переходе в онлайн health и так читается заново.
  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await fetchHealth());
    } catch {
      // Бэкенд пропал целиком — это заметит predict и переведёт в оффлайн
    }
  }, []);

  const runPredict = useCallback(
    async (a: Atmosphere): Promise<PredictResponse> => {
      if (!online) return predictOffline(a);
      try {
        return await predict(a);
      } catch {
        setOnline(false);
        return predictOffline(a);
      }
    },
    [online],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const b = await runPredict(BASELINE);
      if (alive) setBaseline(b.predicted_value);
    })();
    return () => { alive = false; };
  }, [runPredict]);

  // Предсказания кешируются по самой атмосфере, а не по модулю.
  //
  // Иначе каждый шаг ползунка пересчитывал все шесть модулей, хотя менялся
  // один: с поднятым бэкендом это шесть POST на шаг, и они выстраивались в
  // очередь. Плюс четыре модуля стоят на одной и той же атмосфере, так что
  // при запуске хватает трёх запросов вместо семи. Режим в ключе, чтобы
  // живые ответы не смешивались с оффлайновыми.
  const seen = useRef(new Map<string, Promise<PredictResponse>>());
  const keyOf = useCallback(
    (a: Atmosphere) =>
      `${online ? "live" : "off"}|${a.oxygen_level}|${a.pressure_psi}|${a.droplet_mm}`,
    [online],
  );

  // Каждый модуль обновляется сам по себе.
  //
  // Раньше здесь был Promise.all: пока не ответят все шесть, не менялся
  // ни один. Стоило бэкенду задуматься, и на экране оставались прежние
  // цифры, хотя ползунок уже сдвинут. Выглядело так, будто показатель
  // нарисован для галочки. Флаг alive гасит ответы отменённого прохода,
  // поэтому опоздавший ответ не перезапишет свежий.
  useEffect(() => {
    let alive = true;
    for (const m of HABITAT) {
      const a = atmos[m.id];
      const key = keyOf(a);
      // В кеше лежит обещание, а не значение: пока ответ в пути, второй
      // такой же запрос не нужен. Сдвиг ползунка при неотвеченном старте
      // иначе поднимал все шесть запросов заново.
      let pending = seen.current.get(key);
      if (!pending) {
        pending = runPredict(a);
        seen.current.set(key, pending);
        pending.catch(() => seen.current.delete(key));
      }
      void pending.then((fresh) => {
        if (alive) setResults((prev) => (prev[m.id] === fresh ? prev : { ...prev, [m.id]: fresh }));
      });
    }
    return () => { alive = false; };
  }, [atmos, runPredict, keyOf]);

  const model = dashboard.model;
  const ratios = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of HABITAT) {
      const v = results[m.id]?.predicted_value;
      out[m.id] = v && baseline ? v / baseline : 1;
    }
    return out;
  }, [results, baseline]);

  const values = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of HABITAT) {
      const v = results[m.id]?.predicted_value;
      if (v !== undefined) out[m.id] = v;
    }
    return out;
  }, [results]);

  const current = HABITAT.find((m) => m.id === selected)!;

  return (
    <>
      <TopBar
        lang={lang}
        setLang={setLang}
        variant="program"
        actions={<button className="topbar-action" onClick={() => setShowSettings(true)}>{tr("aiSettings", lang)}</button>}
      />
      {showSettings && (
        <LlmSettings
          client={v1Client}
          lang={lang}
          onClose={() => setShowSettings(false)}
          onChanged={() => void refreshHealth()}
        />
      )}

      <main className="desk" id="habitat">
        {/* Полоса модулей и есть ранжирование: порядок по риску, номера видны */}
        <ModuleRank
          modules={HABITAT}
          ratios={ratios}
          values={values}
          units={model.units}
          selected={selected}
          onSelect={setSelected}
          lang={lang}
        />

        {/* Условия, комната с вкладками под ней и AI справа. На большом экране всё
            помещается без прокрутки страницы, на меньшем страница прокручивается. */}
        <div className="bench">
          <div className="bench-cond scrolly">
            <Conditions
              module={current}
              atmosphere={atmos[selected]}
              onChange={(next) => setAtmos((prev) => ({ ...prev, [selected]: next }))}
              onReset={() =>
                setAtmos((prev) => ({ ...prev, [selected]: { ...current.atmosphere } }))
              }
              result={results[selected] ?? null}
              ratio={ratios[selected] ?? 1}
              units={model.units}
              lang={lang}
              offline={!online}
            />
          </div>

          <div className="bench-room">
            <RoomView
              module={current}
              materials={mats[selected] ?? []}
              oxygenPct={atmos[selected].oxygen_level * 100}
              ratio={ratios[selected] ?? 1}
              lang={lang}
            />
          </div>

          <aside className="bench-ai scrolly" aria-label={tr("askNasa", lang)}>
            <Explain lang={lang} online={online} llm={health.lm_studio} onCheck={refreshHealth} />
          </aside>

          <div className="bench-tabs">
            <div className="tabs">
              {TABS.map((t) => (
                <button key={t} className={tab === t ? "on" : undefined} onClick={() => setTab(t)}>
                  {tr(`tab_${t}`, lang)}
                </button>
              ))}
            </div>

            <div className="tab-body scrolly">
              {tab === "time" && (
                <TimeToAct oxygenPct={atmos[selected].oxygen_level * 100} lang={lang} />
              )}
              {tab === "mats" && (
                <RoomMaterials
                  materials={mats[selected] ?? []}
                  oxygenPct={atmos[selected].oxygen_level * 100}
                  onChange={(next) => setMats((prev) => ({ ...prev, [selected]: next }))}
                  lang={lang}
                />
              )}
              {tab === "trust" && (
                <>
                  <Finding lang={lang} onJump={() => setSelected("eva")} />
                  <ModelQuality model={model} lang={lang} />
                  <MirCase lang={lang} />
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
